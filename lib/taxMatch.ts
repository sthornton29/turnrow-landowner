// Matching tax statement lines to parcels and headers to entities, and
// the self-learning that makes the next year automatic. Pure; unit
// tested in taxMatch.test.ts (including the learn-once loop).

import { sameIdentifier, IDENTIFIER_KIND_LABELS, type IdentifierKind, type PrintedIdentifier, type StoredIdentifier } from "@/lib/taxIdentifiers";
import { normalizeOwnerName, ownerSimilarity, CLUSTER_THRESHOLD } from "@/lib/ownerNames";

export interface MatchableParcelRef {
  id: string;
  parcel_number: string;
  property_id: string;
  property_name?: string | null;
}

export interface LineMatch {
  parcelId: string | null;
  source: "identifier" | "none";
  evidence: string | null;
  // Several parcels matched different printed numbers: shown, not chosen.
  candidates: Array<{ parcelId: string; evidence: string }>;
}

function kindLabel(k: string): string {
  return IDENTIFIER_KIND_LABELS[k as IdentifierKind] ?? k;
}

// Kind-aware first (a printed PPIN against stored ppin rows), then
// kind-agnostic (counties relabel the same number). Personal property
// lines never match.
export function matchLine(
  line: { line_type: "real_property" | "personal_property" | string; identifiers: PrintedIdentifier[] },
  stored: StoredIdentifier[],
  parcels: MatchableParcelRef[]
): LineMatch {
  const none: LineMatch = { parcelId: null, source: "none", evidence: null, candidates: [] };
  if (line.line_type === "personal_property") return none;
  const parcelById = new Map(parcels.map((p) => [p.id, p]));
  const hits = new Map<string, string>();
  const consider = (printed: PrintedIdentifier, s: StoredIdentifier, kindAware: boolean) => {
    const p = parcelById.get(s.parcel_id);
    if (!p || hits.has(p.id)) return;
    const where = p.property_name ? ` on ${p.property_name}` : "";
    hits.set(
      p.id,
      kindAware
        ? `${kindLabel(printed.kind)} ${printed.value} matches parcel ${p.parcel_number}${where}`
        : `${printed.label ?? kindLabel(printed.kind)} ${printed.value} matches the ${kindLabel(s.kind)} on parcel ${p.parcel_number}${where}`
    );
  };
  for (const printed of line.identifiers) {
    if (printed.kind === "other") continue;
    for (const s of stored) {
      if (s.kind === printed.kind && sameIdentifier(printed, s)) consider(printed, s, true);
    }
  }
  if (hits.size === 0) {
    for (const printed of line.identifiers) {
      for (const s of stored) {
        if (sameIdentifier(printed, s)) consider(printed, s, false);
      }
    }
  }
  if (hits.size === 1) {
    const [parcelId, evidence] = [...hits][0];
    return { parcelId, source: "identifier", evidence, candidates: [{ parcelId, evidence }] };
  }
  if (hits.size > 1) {
    return { ...none, candidates: [...hits].map(([parcelId, evidence]) => ({ parcelId, evidence })) };
  }
  return none;
}

// ---------------------------------------------------------------- entity

export interface MatchableEntityRef {
  id: string;
  name: string;
  aliases: string[]; // as printed or normalized; both are normalized here
}

export interface EntityMatch {
  entityId: string | null;
  evidence: string | null;
  // The name actually compared (the C/O target when present).
  comparedName: string | null;
}

// "MARTIN L SYKES C/O ALBEMARLE CORP": the C/O target is the signal, the
// taxpayer stays as printed on the header.
export function careOfTarget(taxpayer: string | null | undefined, careOf: string | null | undefined): string | null {
  const co = (careOf ?? "").trim();
  if (co) return co;
  const t = (taxpayer ?? "").toUpperCase();
  const m = t.match(/(?:^|\s)C\/O\s+(.+)$/);
  return m ? m[1].trim() : null;
}

export function matchEntity(
  header: { taxpayer_name: string | null; care_of: string | null },
  entities: MatchableEntityRef[]
): EntityMatch {
  const target = careOfTarget(header.taxpayer_name, header.care_of) ?? (header.taxpayer_name ?? "").trim();
  if (!target) return { entityId: null, evidence: null, comparedName: null };
  const printedNorm = normalizeOwnerName(target).normalized;
  let best: { e: MatchableEntityRef; score: number; via: string } | null = null;
  for (const e of entities) {
    const names = [{ n: e.name, via: "name" }, ...e.aliases.map((a) => ({ n: a, via: `alias "${a}"` }))];
    for (const { n, via } of names) {
      const norm = normalizeOwnerName(n).normalized;
      if (!norm) continue;
      const score = norm === printedNorm ? 1 : ownerSimilarity(printedNorm, norm);
      if (score >= CLUSTER_THRESHOLD && (!best || score > best.score)) best = { e, score, via };
    }
  }
  if (!best) return { entityId: null, evidence: null, comparedName: target };
  const how = best.score === 1 ? "matches" : "is a close spelling of";
  return {
    entityId: best.e.id,
    evidence: `"${target}" ${how} ${best.via === "name" ? best.e.name : `${best.via} of ${best.e.name}`}`,
    comparedName: target,
  };
}

// ---------------------------------------------------------------- learning

export interface LearnedIdentifier {
  parcel_id: string;
  kind: IdentifierKind;
  label: string | null;
  value: string;
  normalized: string;
}

// On confirming a line's parcel (auto or manual), every identifier
// printed on it is worth remembering on that parcel. Skips 'other'
// identifiers with no label (nothing to remember them by) and anything
// already stored under the same kind and value.
export function identifiersToLearn(
  parcelId: string,
  printed: PrintedIdentifier[],
  stored: StoredIdentifier[]
): LearnedIdentifier[] {
  const out: LearnedIdentifier[] = [];
  for (const p of printed) {
    if (p.kind === "other" && !p.label) continue;
    const dup = stored.some((s) => s.parcel_id === parcelId && s.kind === p.kind && sameIdentifier(s, p));
    if (dup) continue;
    if (out.some((o) => o.kind === p.kind && o.normalized === p.normalized)) continue;
    out.push({ parcel_id: parcelId, kind: p.kind, label: p.label, value: p.value, normalized: p.normalized });
  }
  return out;
}

// The taxpayer spelling worth saving as an entity alias: only when it is
// not already the entity's name or a known alias, and not a bare C/O shell.
export function aliasToLearn(
  comparedName: string | null,
  entity: MatchableEntityRef | null
): string | null {
  if (!comparedName || !entity) return null;
  const n = normalizeOwnerName(comparedName).normalized;
  if (!n) return null;
  const known = [entity.name, ...entity.aliases].map((x) => normalizeOwnerName(x).normalized);
  return known.includes(n) ? null : comparedName.trim();
}
