// Which properties does a freshly uploaded document belong to? The
// classifier returns plain HINTS it read off the page (counties, parcel
// numbers, owner and place names, FSA farm numbers, acres, a legal
// description snippet); this pure scorer turns them into ranked
// suggestions against the organization's own properties and parcels.
// Suggestions are pre-checked in the upload form only when confident;
// the user always confirms. Unit-tested in documentMatch.test.ts.


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
}

export interface AiPropertyMatch {
  name: string;
  confidence: "high" | "medium" | "low" | string;
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
