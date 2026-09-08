// Matching tax statement lines to parcels and headers to entities, and
// the self-learning that makes the next year automatic. Pure; unit
// tested in taxMatch.test.ts (including the learn-once loop).

import { sameIdentifier, IDENTIFIER_KIND_LABELS, type IdentifierKind, type PrintedIdentifier, type StoredIdentifier } from "@/lib/taxIdentifiers";
import { normalizeOwnerName, ownerSimilarity, CLUSTER_THRESHOLD } from "@/lib/ownerNames";
import { parcelKey, parcelsEqual } from "@/lib/parcelNumber";

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
  // Parcel-specific kinds decide first. An account number names the
  // BILL, not the parcel (one account covers many parcels, and county
  // records carry it on every one), so it only decides when nothing
  // parcel-specific is printed or stored.
  // Four passes, each only when the one before found nothing: strong
  // kinds kind-aware, strong kinds kind-agnostic (never against a
  // stored account number, which every parcel on a bill carries), then
  // the account number kind-aware, then kind-agnostic.
  const isAccount = (k: string) => k === "account_number";
  for (const weak of [false, true]) {
    if (hits.size > 0) break;
    for (const printed of line.identifiers) {
      if (printed.kind === "other" || isAccount(printed.kind) !== weak) continue;
      for (const s of stored) {
        if (s.kind === printed.kind && sameIdentifier(printed, s)) consider(printed, s, true);
      }
    }
    if (hits.size > 0) break;
    for (const printed of line.identifiers) {
      if (isAccount(printed.kind) !== weak) continue;
      for (const s of stored) {
        if (!weak && isAccount(s.kind)) continue;
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

// ---------------------------------------------------------------- county lookup tier

// What the county's GIS service answered for one printed identifier
// (server-side /api/gis/identifier-lookup, registry mappings from
// migration 0042). overlaps is the share of the county feature's area
// inside each of the organization's parcels in that county, computed
// server-side; empty when the county returned no geometry.
export interface CountyLookupHit {
  kind: IdentifierKind;
  value: string; // the printed identifier that was looked up
  parcel_number: string; // as the county records it
  service_label: string; // "Colbert County GIS", for evidence
  service_display_name?: string; // the registry's display name, for attributes_source
  service_id: string;
  identifiers: PrintedIdentifier[]; // harvested from the county feature
  attributes: Record<string, unknown>;
  overlaps: Array<{ parcel_id: string; share: number }>;
}

export interface CountyLineMatch {
  parcelId: string | null;
  source: "identifier" | "spatial" | null;
  evidence: string | null;
  candidates: Array<{ parcelId: string; evidence: string }>;
  // The county resolved a printed number to a parcel the organization
  // has not mapped: offered as an import, never matched.
  notInAccount: Array<{ value: string; kind: IdentifierKind; parcel_number: string; service_id: string; service_label: string }>;
  // County identifiers and attributes worth storing on the matched
  // parcel when the line is confirmed.
  learn: PrintedIdentifier[];
  attributes: Record<string, unknown> | null;
  serviceId: string | null;
  serviceLabel: string | null; // the registry display name when known, else the evidence label
}

const OVERLAP_MIN = 0.5;

// parcelsEqual, plus the one case it misses: a run-together county
// spelling keeps a trailing zero sub-parcel ("1107260000001000") that
// the spaced spelling drops as a zero-only segment ("11 07 26 0 000
// 001.000" -> 1107260000001). Trailing zeros carry no identity, so a
// compact key that extends the other only by zeros is the same parcel.
export function sameParcelNumber(a: string | null | undefined, b: string | null | undefined): boolean {
  if (parcelsEqual(a, b)) return true;
  const ka = parcelKey(a);
  const kb = parcelKey(b);
  if (!ka || !kb || ka === kb) return false;
  const [short, long] = ka.length < kb.length ? [ka, kb] : [kb, ka];
  return long.startsWith(short) && /^0+$/.test(long.slice(short.length));
}

// After the local identifier store comes up empty: the county's own
// answer for the printed number, matched to the organization's parcels
// by normalized parcel number first, spatial overlap second. Several
// hits pointing at different parcels are listed, none chosen.
export function matchLineViaCounty(
  line: { line_type: "real_property" | "personal_property" | string },
  hits: CountyLookupHit[],
  parcels: MatchableParcelRef[]
): CountyLineMatch {
  const none: CountyLineMatch = {
    parcelId: null,
    source: null,
    evidence: null,
    candidates: [],
    notInAccount: [],
    learn: [],
    attributes: null,
    serviceId: null,
    serviceLabel: null,
  };
  if (line.line_type === "personal_property" || hits.length === 0) return none;
  const found = new Map<string, { evidence: string; source: "identifier" | "spatial"; hit: CountyLookupHit }>();
  const notInAccount: CountyLineMatch["notInAccount"] = [];
  // An account number names the bill, so its hits (every parcel on the
  // account) only count when no parcel-specific number resolved.
  const strong = hits.filter((h) => h.kind !== "account_number");
  const ordered = strong.length > 0 ? strong : hits;
  for (const hit of ordered) {
    const label = `${kindLabel(hit.kind)} ${hit.value} resolved via ${hit.service_label}`;
    const byNumber = hit.parcel_number
      ? parcels.find((p) => sameParcelNumber(p.parcel_number, hit.parcel_number) || hit.identifiers.some((i) => i.kind === "parcel_number" && sameParcelNumber(p.parcel_number, i.value)))
      : undefined;
    if (byNumber) {
      if (!found.has(byNumber.id)) {
        const where = byNumber.property_name ? ` on ${byNumber.property_name}` : "";
        found.set(byNumber.id, { evidence: `${label} to parcel ${byNumber.parcel_number}${where}`, source: "identifier", hit });
      }
      continue;
    }
    const best = [...hit.overlaps].filter((o) => o.share >= OVERLAP_MIN).sort((a, b) => b.share - a.share)[0];
    const spatial = best ? parcels.find((p) => p.id === best.parcel_id) : undefined;
    if (spatial && best) {
      if (!found.has(spatial.id)) {
        const where = spatial.property_name ? ` on ${spatial.property_name}` : "";
        found.set(spatial.id, {
          evidence: `${label} to county parcel ${hit.parcel_number}, ${Math.round(best.share * 100)}% inside parcel ${spatial.parcel_number}${where}`,
          source: "spatial",
          hit,
        });
      }
      continue;
    }
    if (hit.parcel_number) {
      notInAccount.push({ value: hit.value, kind: hit.kind, parcel_number: hit.parcel_number, service_id: hit.service_id, service_label: hit.service_label });
    }
  }
  const candidates = [...found].map(([parcelId, f]) => ({ parcelId, evidence: f.evidence }));
  if (found.size === 1) {
    const [parcelId, f] = [...found][0];
    return {
      parcelId,
      source: f.source,
      evidence: f.evidence,
      candidates,
      notInAccount,
      learn: f.hit.identifiers,
      attributes: f.hit.attributes,
      serviceId: f.hit.service_id,
      serviceLabel: f.hit.service_display_name ?? f.hit.service_label,
    };
  }
  return { ...none, candidates, notInAccount };
}
