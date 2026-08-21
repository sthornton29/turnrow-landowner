// Which properties does a freshly uploaded document belong to? The
// classifier returns plain HINTS it read off the page (counties, parcel
// numbers, owner and place names, FSA farm numbers, acres, a legal
// description snippet); this pure scorer turns them into ranked
// suggestions against the organization's own properties and parcels.
// Suggestions are pre-checked in the upload form only when confident;
// the user always confirms. Unit-tested in documentMatch.test.ts.

import { normalizeOwnerName, ownerSimilarity } from "./ownerNames";

export interface PropertyHints {
  counties?: string[] | null;
  states?: string[] | null;
  parcel_numbers?: string[] | null;
  owner_names?: string[] | null;
  place_names?: string[] | null;
  fsa_farm_numbers?: string[] | null;
  acres?: number | null;
  legal_description_snippet?: string | null;
}

export interface MatchableProperty {
  id: string;
  name: string;
  county: string | null;
  state: string | null;
  fsa_numbers: string[] | null;
  acres: number | null;
  // Historical tract names deeds use ("View Celeste"), migration 0029.
  aliases?: string[] | null;
}

export interface MatchableParcel {
  id: string;
  property_id: string;
  parcel_number: string;
  county?: string | null;
}

export interface PropertySuggestion {
  propertyId: string;
  score: number;
  reasons: string[];
  // The parcel the description fits (whole-section tract whose acreage
  // matches a parcel inside it), offered as the specific record.
  parcelId?: string | null;
}

export interface AiPropertyMatch {
  name: string;
  confidence: "high" | "medium" | "low" | string;
  reason?: string | null;
  // Intake claims cite the signal and the printed value that drove
  // them, so verifyMatches can check each one against the org's data.
  signal?: "parcel" | "fsa" | "name" | "alias" | "county" | string | null;
  value?: string | null;
}

export interface MatchableEntity {
  id: string;
  name: string;
  aliases: string[];
}

export interface AiEntityMatch {
  name: string;
  value?: string | null;
  reason?: string | null;
}

export const CONFIDENT_SCORE = 50;

// The classifier also names properties off the owner's list; its vote
// is weighted by its stated confidence and always comes with a reason.
const AI_SCORE: Record<string, number> = { high: 70, medium: 45, low: 20 };
const UNIQUE_COUNTY_SCORE = 40;

const SCORE = {
  parcel: 60,
  fsa: 50,
  name: 30,
  county: 10,
  state: 2,
  acres: 8,
};

// Separator-insensitive parcel key: "12-03-07-0-000-004.000" and
// "120307 0 000 004.000" compare equal.
export function parcelKey(raw: string | null | undefined): string {
  return (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

function normCounty(s: string | null | undefined): string {
  return norm(s).replace(/\b(county|parish)\b/g, "").replace(/[^a-z]/g, "");
}

function normState(s: string | null | undefined): string {
  const v = norm(s).replace(/[^a-z]/g, "");
  return STATE_NAMES[v] ?? v;
}

const STATE_NAMES: Record<string, string> = {
  alabama: "al", mississippi: "ms", tennessee: "tn", georgia: "ga",
  florida: "fl", arkansas: "ar", louisiana: "la", texas: "tx",
  kentucky: "ky", missouri: "mo", northcarolina: "nc", southcarolina: "sc",
  oklahoma: "ok", kansas: "ks", nebraska: "ne", iowa: "ia", illinois: "il",
  indiana: "in", ohio: "oh", virginia: "va",
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Whole-word, case-insensitive containment of a property name in text.
export function nameMentioned(name: string, text: string): boolean {
  const n = name.trim();
  if (n.length < 3) return false;
  const re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(n.toLowerCase())}($|[^a-z0-9])`, "i");
  return re.test(text.toLowerCase());
}

// FSA farm numbers are numeric; "FSA 1234" and "Farm #1234" both key 1234.
function normFsa(s: string): string {
  return s.replace(/[^0-9]/g, "").replace(/^0+/, "");
}

export function suggestProperties(
  hints: PropertyHints | null | undefined,
  properties: MatchableProperty[],
  parcels: MatchableParcel[],
  aiMatches: AiPropertyMatch[] | null | undefined = null
): PropertySuggestion[] {
  const ai = (aiMatches ?? []).filter((m) => m && typeof m.name === "string");
  if (!hints && ai.length === 0) return [];
  hints = hints ?? {};
  const parcelHints = (hints.parcel_numbers ?? [])
    .map((p) => ({ raw: p, key: parcelKey(p) }))
    .filter((p) => p.key.length > 0);
  const fsaHints = (hints.fsa_farm_numbers ?? []).map(normFsa).filter(Boolean);
  const counties = new Set((hints.counties ?? []).map(normCounty).filter(Boolean));
  const states = new Set((hints.states ?? []).map(normState).filter(Boolean));
  const mentionText = [
    ...(hints.owner_names ?? []),
    ...(hints.place_names ?? []),
    hints.legal_description_snippet ?? "",
  ].join(" \n ");
  const acresHint =
    typeof hints.acres === "number" && hints.acres > 0 ? hints.acres : null;

  // Uniqueness: when the org has exactly one property in a hinted
  // county (and state, when the state is named too), that property is
  // the obvious home even without a parcel or farm number on the page.
  const uniqueInCounty = new Set<string>();
  for (const c of counties) {
    const inCounty = properties.filter((p) => {
      if (normCounty(p.county) !== c) return false;
      if (states.size === 0) return true;
      const ps = normState(p.state);
      return !ps || states.has(ps);
    });
    if (inCounty.length === 1) uniqueInCounty.add(inCounty[0].id);
  }

  const out: PropertySuggestion[] = [];
  for (const p of properties) {
    let score = 0;
    const reasons: string[] = [];

    // The classifier named this property from the owner's list.
    const vote = ai.find((m) => norm(m.name) === norm(p.name));
    if (vote) {
      score += AI_SCORE[norm(vote.confidence)] ?? AI_SCORE.low;
      reasons.push(
        vote.reason && vote.reason.trim()
          ? `AI: ${vote.reason.trim()}`
          : `AI named this property (${norm(vote.confidence) || "low"} confidence)`
      );
    }

    if (uniqueInCounty.has(p.id)) {
      score += UNIQUE_COUNTY_SCORE;
      reasons.push(`The only property in ${p.county} County`);
    }

    // Parcel numbers printed on the document that sit on this property.
    for (const ph of parcelHints) {
      const hit = parcels.find(
        (pc) => pc.property_id === p.id && parcelKey(pc.parcel_number) === ph.key
      );
      if (hit) {
        score += SCORE.parcel;
        reasons.push(`Parcel ${hit.parcel_number} is on this property`);
      }
    }

    // FSA farm numbers.
    const pFsa = (p.fsa_numbers ?? []).map(normFsa);
    for (const f of fsaHints) {
      if (pFsa.includes(f)) {
        score += SCORE.fsa;
        reasons.push(`FSA farm ${f} is recorded on this property`);
      }
    }

    // The property's own name appears in the names or description.
    if (mentionText.trim() && nameMentioned(p.name, mentionText)) {
      score += SCORE.name;
      reasons.push(`"${p.name}" is named in the document`);
    }

    // Same county (and state).
    const pc = normCounty(p.county);
    if (pc && counties.has(pc)) {
      score += SCORE.county;
      let reason = `Same county (${p.county})`;
      const ps = normState(p.state);
      if (ps && states.has(ps)) {
        score += SCORE.state;
        reason = `Same county and state (${p.county}, ${p.state})`;
      }
      reasons.push(reason);
    }

    // Acreage within 10 percent.
    if (acresHint !== null && p.acres !== null && p.acres > 0) {
      if (Math.abs(p.acres - acresHint) / acresHint <= 0.1) {
        score += SCORE.acres;
        reasons.push(`About the same acreage (${p.acres.toFixed(1)} vs ${acresHint.toFixed(1)})`);
      }
    }

    if (score > 0) out.push({ propertyId: p.id, score, reasons });
  }
  out.sort((a, b) => b.score - a.score || a.propertyId.localeCompare(b.propertyId));
  return out;
}

export function isConfident(s: PropertySuggestion): boolean {
  return s.score >= CONFIDENT_SCORE;
}

// The single best suggestion, when it stands clearly apart: at least 30
// and 15 ahead of the runner-up (or alone). Pre-checked on upload when
// nothing reached the confident bar, so one likely property is offered
// rather than none.
export function bestGuess(suggestions: PropertySuggestion[]): PropertySuggestion | null {
  if (suggestions.length === 0) return null;
  const sorted = [...suggestions].sort((a, b) => b.score - a.score);
  const top = sorted[0];
  if (top.score < 30) return null;
  const next = sorted[1];
  if (next && top.score - next.score < 15) return null;
  return top;
}


// ---------------------------------------------------------------------
// Deterministic verification of the intake pass's association claims.
// The model may SAY "parcel 12-03 matches River Place"; it is shown as
// found only when that parcel really sits on River Place in our data.
// A claim that fails verification is downgraded (reported, never
// shown as a match), so a wrong guess never wears real confidence.
// ---------------------------------------------------------------------

export interface VerifiedMatches {
  verified: PropertySuggestion[];
  downgraded: Array<{ name: string; signal: string; reason: string }>;
  entity: { entityId: string; why: string } | null;
  // Property ids to pre-check on the confirm screen (empty on conflict).
  preselect: string[];
  // Set when a parcel/FSA signal names one property and the described
  // land overlaps only another: both are shown, nothing preselected.
  conflict: boolean;
}

// What the intake's spatial tier computed (server side, under RLS).
export interface SpatialMatch {
  entity_type: "property" | "parcel" | string;
  id: string;
  name: string;
  overlap_acres: number;
  pct_of_described: number;
  pct_of_boundary: number | null;
}

export interface SpatialEvidence {
  reference_label?: string | null;
  described_acres?: number | null;
  county_check?: { deed: string | null; resolved: string | null; matches: boolean | null } | null;
  resolution?: { meridianName?: string | null; source?: string | null; cached?: boolean } | null;
  matches?: SpatialMatch[];
  polygon?: unknown;
  computed?: boolean;
  notes?: string[];
  // Why nothing computed (shown on the confirm screen with Retry):
  // no_reference | county_mismatch | lookup_failed | overlap_failed.
  reason?: string | null;
  // True when at least one tract was plotted as a whole section because
  // its text was not a quarter chain (creek, road, "portion of").
  whole_section?: boolean;
  // "containing N acres" from the description, when stated.
  stated_acres?: number | null;
  // Every reference that was resolved (AI and text), for the record.
  references?: Array<Record<string, unknown>>;
  tract_count?: number;
}

// How close a parcel's acreage must sit to the stated acreage to count
// as the tract itself (a 118-acre parcel against "120 acres").
export const PARCEL_FIT_TOLERANCE = 0.15;
const PARCEL_FIT_SCORE = 85;

// Spatial scoring: a described tract overlapping a property is the
// strongest evidence there is, but only once the intersection really
// computed (computed = true with a matches array).
export const SPATIAL_MIN_PCT = 5;
const SPATIAL_STRONG = 80; // >= 50% of the described area
const SPATIAL_PARTIAL = 60; // 5% to 50%

export function spatialSuggestions(
  spatial: SpatialEvidence | null | undefined,
  properties: MatchableProperty[],
  parcels: MatchableParcel[]
): PropertySuggestion[] {
  if (!spatial || !spatial.computed || !Array.isArray(spatial.matches)) return [];
  const label = spatial.reference_label ? `describes land in ${spatial.reference_label}` : "the described land";

  // Parcel fit: a whole-section tract whose stated acreage matches one
  // parcel sitting inside the section is that parcel. Strongest signal
  // of all, and it names the specific record.
  const stated = spatial.stated_acres ?? null;
  if (spatial.whole_section && stated && stated > 0) {
    const fits = spatial.matches
      .filter((m) => m.entity_type === "parcel" && (m.pct_of_boundary ?? 0) >= 90)
      .map((m) => {
        const pc = parcels.find((x) => x.id === m.id);
        const acres = Number(m.overlap_acres) || 0;
        return { m, pc, acres, err: Math.abs(acres - stated) / stated };
      })
      .filter((f) => f.pc && f.err <= PARCEL_FIT_TOLERANCE && properties.some((p) => p.id === f.pc!.property_id))
      .sort((a, b) => a.err - b.err);
    if (fits.length === 1 || (fits.length > 1 && fits[1].err - fits[0].err > 0.05)) {
      const f = fits[0];
      const prop = properties.find((p) => p.id === f.pc!.property_id)!;
      return [
        {
          propertyId: prop.id,
          parcelId: f.pc!.id,
          score: PARCEL_FIT_SCORE,
          reasons: [
            `parcel ${f.pc!.parcel_number} (${Math.round(f.acres * 10) / 10} acres) on ${prop.name} fits the ${stated} acres described in ${spatial.reference_label ?? "the section"}`,
          ],
        },
      ];
    }
  }

  const byProperty = new Map<string, { pct: number; name: string }>();
  for (const m of spatial.matches) {
    let propertyId: string | null = null;
    let propertyName = m.name;
    if (m.entity_type === "property") {
      propertyId = m.id;
    } else if (m.entity_type === "parcel") {
      const pc = parcels.find((x) => x.id === m.id);
      if (!pc) continue;
      propertyId = pc.property_id;
      propertyName = properties.find((p) => p.id === pc.property_id)?.name ?? m.name;
    }
    if (!propertyId || !properties.some((p) => p.id === propertyId)) continue;
    const pct = Number(m.pct_of_described) || 0;
    const cur = byProperty.get(propertyId);
    // Parcels sit inside their property: keep the larger share, never add.
    if (!cur || pct > cur.pct) byProperty.set(propertyId, { pct, name: propertyName });
  }
  const out: PropertySuggestion[] = [];
  for (const [propertyId, { pct, name }] of byProperty) {
    if (pct < SPATIAL_MIN_PCT) continue;
    const score = pct >= 50 ? SPATIAL_STRONG : SPATIAL_PARTIAL;
    out.push({
      propertyId,
      score,
      reasons: [
        `${label}, overlapping ${name} (${Math.round(pct)}% of described area${spatial.whole_section ? ", whole section" : ""})`,
      ],
    });
  }
  out.sort((a, b) => b.score - a.score);
  // A whole section is a search window, not the tract: when several
  // properties sit in it, only the largest share is strong; the rest are
  // shown as partial so they are listed but not pre-checked.
  if (spatial.whole_section && out.length > 1) {
    for (let i = 1; i < out.length; i++) out[i].score = Math.min(out[i].score, SPATIAL_PARTIAL);
  }
  return out;
}

const NAME_SIMILARITY = 0.75;

function normName(s: string | null | undefined): string {
  return normalizeOwnerName(s ?? "").normalized;
}

// Does a party name as printed match a property/entity name or alias?
function partyMatches(printed: string, candidates: string[]): string | null {
  const a = normName(printed);
  if (!a) return null;
  for (const c of candidates) {
    const b = normName(c);
    if (!b) continue;
    if (a === b || ownerSimilarity(a, b) >= NAME_SIMILARITY) return c;
  }
  return null;
}

export function verifyMatches(
  claims: AiPropertyMatch[] | null | undefined,
  hints: PropertyHints | null | undefined,
  properties: MatchableProperty[],
  parcels: MatchableParcel[],
  entities: MatchableEntity[] = [],
  entityClaim: AiEntityMatch | null | undefined = null,
  propertyEntity: Record<string, string | null> = {},
  spatial: SpatialEvidence | null | undefined = null
): VerifiedMatches {
  const verified = new Map<string, PropertySuggestion>();
  const downgraded: VerifiedMatches["downgraded"] = [];
  const counties = new Set((hints?.counties ?? []).map(normCounty).filter(Boolean));
  const states = new Set((hints?.states ?? []).map(normState).filter(Boolean));
  const pageNames = [
    ...(hints?.owner_names ?? []),
    ...(hints?.place_names ?? []),
  ];
  const pageParcels = new Set((hints?.parcel_numbers ?? []).map(parcelKey).filter(Boolean));
  const pageFsa = new Set((hints?.fsa_farm_numbers ?? []).map(normFsa).filter(Boolean));

  const uniqueInCounty = (p: MatchableProperty): boolean => {
    const pc = normCounty(p.county);
    if (!pc || !counties.has(pc)) return false;
    const inCounty = properties.filter((q) => {
      if (normCounty(q.county) !== pc) return false;
      if (states.size === 0) return true;
      const qs = normState(q.state);
      return !qs || states.has(qs);
    });
    return inCounty.length === 1 && inCounty[0].id === p.id;
  };

  const add = (p: MatchableProperty, score: number, why: string) => {
    const cur = verified.get(p.id);
    if (cur) {
      cur.score += score;
      if (!cur.reasons.includes(why)) cur.reasons.push(why);
    } else {
      verified.set(p.id, { propertyId: p.id, score, reasons: [why] });
    }
  };

  for (const claim of claims ?? []) {
    if (!claim || typeof claim.name !== "string") continue;
    const p = properties.find((x) => norm(x.name) === norm(claim.name));
    const signal = String(claim.signal ?? "").toLowerCase();
    const value = String(claim.value ?? "").trim();
    const reason = (claim.reason ?? "").trim();
    if (!p) {
      downgraded.push({ name: claim.name, signal, reason: "Not one of your properties" });
      continue;
    }
    if (signal === "parcel") {
      const key = parcelKey(value);
      const hit = key ? parcels.find((pc) => pc.property_id === p.id && parcelKey(pc.parcel_number) === key) : undefined;
      // Fallback: any parcel number read off the page that sits on this property.
      const hit2 = hit ?? parcels.find((pc) => pc.property_id === p.id && pageParcels.has(parcelKey(pc.parcel_number)));
      if (hit2) add(p, SCORE.parcel + 20, `parcel ${hit2.parcel_number} matches ${p.name}`);
      else downgraded.push({ name: p.name, signal, reason: `Parcel "${value || "?"}" is not recorded on ${p.name}` });
      continue;
    }
    if (signal === "fsa") {
      const f = normFsa(value);
      const pFsa = (p.fsa_numbers ?? []).map(normFsa);
      const hit = (f && pFsa.includes(f)) ? f : pFsa.find((x) => pageFsa.has(x));
      if (hit) add(p, SCORE.fsa + 20, `FSA farm ${hit} is recorded on ${p.name}`);
      else downgraded.push({ name: p.name, signal, reason: `FSA farm "${value || "?"}" is not recorded on ${p.name}` });
      continue;
    }
    if (signal === "name") {
      const text = [value, ...pageNames, hints?.legal_description_snippet ?? ""].join(" \n ");
      const alias = (p.aliases ?? []).find((a) => nameMentioned(a, text));
      if (nameMentioned(p.name, text)) add(p, CONFIDENT_SCORE + 5, `"${p.name}" is named in the document`);
      else if (alias) add(p, CONFIDENT_SCORE + 5, `"${alias}" (a name you recorded for ${p.name}) is in the document`);
      else downgraded.push({ name: p.name, signal, reason: `"${p.name}" does not appear on the page` });
      continue;
    }
    if (signal === "alias") {
      const entId = propertyEntity[p.id] ?? null;
      const ent = entId ? entities.find((e) => e.id === entId) : undefined;
      const candidates = ent ? [ent.name, ...ent.aliases] : [];
      const printed = value || "";
      const hit = printed ? partyMatches(printed, candidates) : null;
      const hit2 = hit ?? pageNames.map((n) => partyMatches(n, candidates)).find(Boolean) ?? null;
      if (hit2 && ent) add(p, CONFIDENT_SCORE + 5, `${printed || "a party"} matches ${ent.name}, which holds ${p.name}`);
      else downgraded.push({ name: p.name, signal, reason: `"${printed || "?"}" does not match the entity that holds ${p.name}` });
      continue;
    }
    // county (or unknown signal): only the unique-in-county rule counts.
    if (uniqueInCounty(p)) add(p, CONFIDENT_SCORE, `The only property in ${p.county} County`);
    else downgraded.push({ name: p.name, signal: signal || "county", reason: reason || "County alone is not enough" });
  }

  // Entity: verified by entity name or alias against the printed party.
  let entity: VerifiedMatches["entity"] = null;
  if (entityClaim && typeof entityClaim.name === "string") {
    const ent = entities.find((e) => norm(e.name) === norm(entityClaim.name));
    if (ent) {
      const printed = (entityClaim.value ?? "").trim();
      const hit =
        (printed ? partyMatches(printed, [ent.name, ...ent.aliases]) : null) ??
        pageNames.map((n) => partyMatches(n, [ent.name, ...ent.aliases])).find(Boolean) ??
        null;
      if (hit) entity = { entityId: ent.id, why: `${printed || "A party"} matches ${hit === ent.name ? ent.name : `alias "${hit}" of ${ent.name}`}` };
    }
  }

  // Number signals (parcel, FSA) carry their own identity for the
  // conflict rule below.
  const numberSignalIds = new Set(
    [...verified.values()]
      .filter((v) => v.reasons.some((r) => /^parcel |^FSA farm /.test(r)))
      .map((v) => v.propertyId)
  );

  // Spatial tier: merged in as the strongest evidence when computed.
  const spatialHits = spatialSuggestions(spatial, properties, parcels);
  const spatialIds = new Set(spatialHits.map((h) => h.propertyId));
  for (const h of spatialHits) {
    const p = properties.find((x) => x.id === h.propertyId);
    if (!p) continue;
    add(p, h.score, h.reasons[0]);
    if (h.parcelId) verified.get(p.id)!.parcelId = h.parcelId;
  }
  // Aliases on the page with no AI claim still count (the reader may
  // not have known the name; the owner taught it later).
  const pageText = [...pageNames, hints?.legal_description_snippet ?? ""].join(" \n ");
  for (const p of properties) {
    if (verified.has(p.id)) continue;
    const alias = (p.aliases ?? []).find((a) => nameMentioned(a, pageText));
    if (alias) add(p, CONFIDENT_SCORE + 5, `"${alias}" (a name you recorded for ${p.name}) is in the document`);
  }

  // Conflict: a parcel/FSA number names property A, the described land
  // overlaps only other properties (none of it touches A). Show both
  // sides with their evidence and preselect nothing.
  let conflict = false;
  if (spatialHits.length > 0 && numberSignalIds.size > 0) {
    const numberOnly = [...numberSignalIds].filter((id) => !spatialIds.has(id));
    const spatialOnly = [...spatialIds].filter((id) => !numberSignalIds.has(id));
    if (numberOnly.length > 0 && spatialOnly.length > 0) conflict = true;
  }

  const out = [...verified.values()].sort((a, b) => b.score - a.score || a.propertyId.localeCompare(b.propertyId));
  // Pre-check: with a quarter-chain tract, every property it overlaps
  // (>= 5%) plus other confident signals; with a whole-section window,
  // only the strong hit (largest share or the parcel fit), since the
  // neighbors in the same section are usually not the tract.
  const strongSpatial = spatialHits.filter((h) => h.score >= SPATIAL_STRONG).map((h) => h.propertyId);
  const spatialPre = spatial?.whole_section ? strongSpatial : spatialHits.map((h) => h.propertyId);
  const preselect = conflict
    ? []
    : spatialHits.length > 0
      ? [...new Set([...spatialPre, ...out.filter((v) => v.score >= CONFIDENT_SCORE && !spatialIds.has(v.propertyId)).map((v) => v.propertyId)])]
      : out.filter((v) => v.score >= CONFIDENT_SCORE).map((v) => v.propertyId);
  return { verified: out, downgraded, entity, preselect, conflict };
}
