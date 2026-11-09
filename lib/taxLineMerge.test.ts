import { describe, expect, it } from "vitest";
import { mergeSameParcelLines } from "./taxLineMerge";

const line = (line_no: number, parcel_id: string | null, tax_due: number, extra = "") => ({ line_no, parcel_id, tax_due, extra });

describe("mergeSameParcelLines", () => {
  it("combines a regular and an additional bill on the same parcel into one line", () => {
    // Lawrence 2023 account 856490: $55.95 + $0.75 additional = $56.70.
    const { rows, merged } = mergeSameParcelLines([line(1, "p1", 55.95, "regular"), line(2, "p1", 0.75, "additional")]);
    expect(merged).toBe(1);
    expect(rows).toEqual([{ line_no: 1, parcel_id: "p1", tax_due: 56.7, extra: "regular" }]);
  });

  it("keeps different parcels and renumbers, mapping each new line to its first source", () => {
    const { rows, sourceIndex } = mergeSameParcelLines([
      line(1, "a", 10),
      line(2, "b", 20),
      line(3, "a", 1.1),
      line(4, "c", 30),
    ]);
    expect(rows.map((r) => [r.line_no, r.parcel_id, r.tax_due])).toEqual([
      [1, "a", 11.1],
      [2, "b", 20],
      [3, "c", 30],
    ]);
    expect([...sourceIndex.entries()]).toEqual([
      [1, 0],
      [2, 1],
      [3, 3],
    ]);
  });

  it("never combines unmatched lines", () => {
    const { rows, merged } = mergeSameParcelLines([line(1, null, 5), line(2, null, 6)]);
    expect(merged).toBe(0);
    expect(rows).toHaveLength(2);
  });

  it("keeps the total unchanged", () => {
    const input = [line(1, "a", 291.75), line(2, "a", 1.35), line(3, "b", 443.7), line(4, "b", 8.1), line(5, null, 4.44)];
    const { rows } = mergeSameParcelLines(input);
    const sum = (xs: { tax_due: number }[]) => Math.round(xs.reduce((s, x) => s + x.tax_due, 0) * 100) / 100;
    expect(sum(rows)).toBe(sum(input));
  });
});
