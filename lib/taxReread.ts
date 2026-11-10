// RE-READ BILLS: match lines read again from a stored bill file to the
// statement lines already on file, so only the new value columns
// (lib/taxLineValues.ts) are proposed. Tax amounts, identifiers, and
// parcel matches are never changed by a re-read.

import { identifiersEqual } from "./taxIdentifiers";
import { hasAnyValue, readLineValues, type LineValues } from "./taxLineValues";

const STRONG_KINDS = new Set(["parcel_number", "ppin", "pin", "key_number"]);

export interface ExistingLine {
  id: string;
  tax_year: number;
  tax_due: number;
  identifiers: Array<{ kind: string; value: string }>;
}

export interface ReadLine {
  identifiers: Array<{ kind?: string; label?: string; value?: string }>;
  tax_due: number | null;
  raw: Record<string, unknown>;
}

export interface Proposal {
  lineId: string;
  values: LineValues;
  matchedBy: string; // the identifier value that matched
}

function strongIds(ids: Array<{ kind?: string; value?: string }>): string[] {
  return ids.filter((i) => i.value && STRONG_KINDS.has(String(i.kind))).map((i) => String(i.value));
}

// Each existing line takes at most one read line: the one sharing a
// strong identifier, the closest tax amount breaking ties. Read lines
// with no values to offer are skipped.
export function matchReread(
  existing: ExistingLine[],
  read: ReadLine[]
): { proposals: Proposal[]; unmatched: number; empty: number } {
  const taken = new Set<string>();
  const proposals: Proposal[] = [];
  let unmatched = 0;
  let empty = 0;
  for (const r of read) {
    const values = readLineValues(r.raw);
    if (!hasAnyValue(values)) {
      empty++;
      continue;
    }
    const rIds = strongIds(r.identifiers);
    let best: { line: ExistingLine; id: string; gap: number } | null = null;
    for (const e of existing) {
      if (taken.has(e.id)) continue;
      const hit = strongIds(e.identifiers).find((a) => rIds.some((b) => identifiersEqual(a, b)));
      if (!hit) continue;
      const gap = r.tax_due === null ? 1e9 : Math.abs(Number(e.tax_due) - r.tax_due);
      if (!best || gap < best.gap) best = { line: e, id: hit, gap };
    }
    if (!best) {
      unmatched++;
      continue;
    }
    taken.add(best.line.id);
    proposals.push({ lineId: best.line.id, values, matchedBy: best.id });
  }
  return { proposals, unmatched, empty };
}

// Page chunks for a file of n pages: 6 pages per request keeps one
// request well inside the extract route's time limit.
export function pageChunks(n: number, size = 6): string[] {
  const out: string[] = [];
  for (let start = 1; start <= n; start += size) {
    const pages: number[] = [];
    for (let p = start; p < Math.min(n + 1, start + size); p++) pages.push(p);
    out.push(pages.join(","));
  }
  return out;
}
