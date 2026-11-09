// Some county notices print a parcel twice on one statement: the regular
// tax and an "additional bill" for the same parcel and year (Lawrence
// County, AL did this across 2023). A parcel carries one line per tax
// year (the partial unique index on tax_statement_lines), so before
// saving, lines that matched the same parcel are combined into one line
// whose tax is the sum. Unmatched and personal property lines are never
// combined. Returns the merged rows renumbered 1..n and, for each new
// line number, the index of the first source line it came from (used to
// learn that line's printed identifiers onto the parcel).

export interface MergeableLine {
  parcel_id: string | null;
  tax_due: number;
  line_no: number;
}

function cents(n: number): number {
  return Math.round(n * 100) / 100;
}

export function mergeSameParcelLines<T extends MergeableLine>(rows: T[]): { rows: T[]; sourceIndex: Map<number, number>; merged: number } {
  const out: T[] = [];
  const sourceIndex = new Map<number, number>();
  const byParcel = new Map<string, number>(); // parcel id -> index in out
  let merged = 0;
  rows.forEach((row, i) => {
    const pid = row.parcel_id;
    if (pid && byParcel.has(pid)) {
      const at = byParcel.get(pid)!;
      out[at] = { ...out[at], tax_due: cents(out[at].tax_due + row.tax_due) };
      merged++;
      return;
    }
    if (pid) byParcel.set(pid, out.length);
    out.push({ ...row });
    sourceIndex.set(out.length, i);
  });
  out.forEach((r, i) => (r.line_no = i + 1));
  return { rows: out, sourceIndex, merged };
}
