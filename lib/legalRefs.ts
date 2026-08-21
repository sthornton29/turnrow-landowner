// Deterministic reading of PLSS references and stated acreage out of
// legal description text. The AI intake returns the same shape, but a
// regex pass over the verbatim description never forgets a tract and
// never swaps a direction letter, so the two are merged (AI first, text
// fills gaps). Pure; unit tested in legalRefs.test.ts.

export interface TextPlssRef {
  section: number;
  township_num: number;
  township_dir: "N" | "S";
  range_num: number;
  range_dir: "E" | "W";
  // The text immediately before "Section" (the aliquot chain when any).
  aliquot_text: string | null;
}

const DIR = "(north|south|n\\.?|s\\.?)";
const RDIR = "(east|west|e\\.?|w\\.?)";
// "Section 31, Township 4 South, Range 7 West" and the short forms
// "Sec. 31, T4S, R7W" / "S31 T4S R7W" / "Section 31-4S-7W".
const REF_RE = new RegExp(
  "\\b(?:section|sec\\.?)\\s*(\\d{1,2})\\b[\\s,;]*(?:of|in)?[\\s,;]*" +
    "(?:township|twp\\.?|t\\.?)\\s*-?\\s*(\\d{1,3})\\s*-?\\s*" + DIR + "\\b\\.?[\\s,;]*" +
    "(?:range|rge\\.?|r\\.?)\\s*-?\\s*(\\d{1,3})\\s*-?\\s*" + RDIR + "\\b\\.?",
  "gi"
);
// "Sections 29 and 32, T4S R7W": several sections sharing one T/R.
const MULTI_RE = new RegExp(
  "\\bsections?\\s+((?:\\d{1,2}\\s*(?:,|and|&)\\s*)+\\d{1,2})\\b[\\s,;]*(?:of|in)?[\\s,;]*" +
    "(?:township|twp\\.?|t\\.?)\\s*-?\\s*(\\d{1,3})\\s*-?\\s*" + DIR + "\\b\\.?[\\s,;]*" +
    "(?:range|rge\\.?|r\\.?)\\s*-?\\s*(\\d{1,3})\\s*-?\\s*" + RDIR + "\\b\\.?",
  "gi"
);

function dir(s: string): "N" | "S" {
  return s[0].toUpperCase() === "N" ? "N" : "S";
}
function rdir(s: string): "E" | "W" {
  return s[0].toUpperCase() === "E" ? "E" : "W";
}

// The clause before a match: from the previous sentence/clause break.
function precedingClause(text: string, index: number): string | null {
  const before = text.slice(Math.max(0, index - 160), index);
  const cut = before.split(/[;.]|\band also\b|\btogether with\b/i).pop() ?? before;
  const t = cut.replace(/\bof\s*$/i, "").replace(/[\s,]+$/, "").trim();
  return t || null;
}

export function extractPlssReferences(text: string | null | undefined): TextPlssRef[] {
  if (!text) return [];
  const out: TextPlssRef[] = [];
  const seen = new Set<string>();
  const push = (r: TextPlssRef) => {
    const k = `${r.section}|${r.township_num}${r.township_dir}|${r.range_num}${r.range_dir}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(r);
  };
  let m: RegExpExecArray | null;
  MULTI_RE.lastIndex = 0;
  while ((m = MULTI_RE.exec(text))) {
    const secs = (m[1].match(/\d{1,2}/g) ?? []).map(Number).filter((n) => n >= 1 && n <= 36);
    for (const s of secs) {
      push({
        section: s,
        township_num: Number(m[2]),
        township_dir: dir(m[3]),
        range_num: Number(m[4]),
        range_dir: rdir(m[5]),
        aliquot_text: precedingClause(text, m.index),
      });
    }
  }
  REF_RE.lastIndex = 0;
  while ((m = REF_RE.exec(text))) {
    const s = Number(m[1]);
    if (!(s >= 1 && s <= 36)) continue;
    push({
      section: s,
      township_num: Number(m[2]),
      township_dir: dir(m[3]),
      range_num: Number(m[4]),
      range_dir: rdir(m[5]),
      aliquot_text: precedingClause(text, m.index),
    });
  }
  return out;
}

// "containing 120 acres, more or less" / "120.5 acres" after the description.
export function statedAcresOf(text: string | null | undefined): number | null {
  if (!text) return null;
  const m =
    text.match(/containing\s+(?:about\s+|approximately\s+)?([\d,]+(?:\.\d+)?)\s+acres?/i) ??
    text.match(/([\d,]+(?:\.\d+)?)\s+acres?,?\s+more\s+or\s+less/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// "Lawrence County, Alabama" -> { county: "Lawrence", state: "AL" }.
const STATE_BY_NAME: Record<string, string> = {
  alabama: "AL", mississippi: "MS", tennessee: "TN", georgia: "GA", florida: "FL",
  louisiana: "LA", arkansas: "AR", missouri: "MO", kentucky: "KY",
};
export function countyStateOf(text: string | null | undefined): { county: string | null; state: string | null } {
  if (!text) return { county: null, state: null };
  const m = text.match(/\b([A-Z][a-zA-Z.' ]{2,30}?)\s+County,?\s+(?:State\s+of\s+)?([A-Z][a-z]+)/);
  if (!m) return { county: null, state: null };
  const state = STATE_BY_NAME[m[2].toLowerCase()] ?? null;
  return { county: m[1].trim(), state };
}
