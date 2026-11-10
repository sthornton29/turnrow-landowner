import { describe, expect, it } from "vitest";
import { matchReread, pageChunks } from "./taxReread";
import { readLineValues } from "./taxLineValues";

describe("line values", () => {
  it("reads values and normalizes ratio and millage", () => {
    expect(
      readLineValues({ market_value: "654,600", current_use_value: 96928, assessment_ratio: 0.1, millage: 0.03, tax_district: " 01 ", timber_acres: 9 })
    ).toEqual({
      market_value: 654600,
      current_use_value: 96928,
      land_value: null,
      improvement_value: null,
      assessment_ratio: 10,
      tax_district: "01",
      millage: 30,
      timber_acres: 9,
    });
  });
});

describe("matchReread", () => {
  const existing = [
    { id: "a", tax_year: 2024, tax_due: 291.3, identifiers: [{ kind: "parcel_number", value: "06-05-22-0-000-003.000" }, { kind: "ppin", value: "957412" }] },
    { id: "b", tax_year: 2024, tax_due: 100, identifiers: [{ kind: "parcel_number", value: "07-09-32-0-000-004.000" }] },
  ];

  it("matches by a strong identifier and proposes only the values", () => {
    const r = matchReread(existing, [
      { identifiers: [{ kind: "ppin", value: "957412" }], tax_due: 291.3, raw: { market_value: 720100, current_use_value: 96928 } },
      { identifiers: [{ kind: "parcel_number", value: "07 09 32 0 000 004.000" }], tax_due: 100, raw: { market_value: 1539700 } },
      { identifiers: [{ kind: "parcel_number", value: "99-99" }], tax_due: 5, raw: { market_value: 1 } },
      { identifiers: [{ kind: "ppin", value: "957412" }], tax_due: 1, raw: {} },
    ]);
    expect(r.proposals.map((p) => [p.lineId, p.values.market_value])).toEqual([
      ["a", 720100],
      ["b", 1539700],
    ]);
    expect(r.unmatched).toBe(1);
    expect(r.empty).toBe(1);
  });

  it("does not give one existing line two read lines", () => {
    const r = matchReread(existing, [
      { identifiers: [{ kind: "ppin", value: "957412" }], tax_due: 291.3, raw: { market_value: 1 } },
      { identifiers: [{ kind: "ppin", value: "957412" }], tax_due: 291.3, raw: { market_value: 2 } },
    ]);
    expect(r.proposals).toHaveLength(1);
    expect(r.unmatched).toBe(1);
  });
});

describe("pageChunks", () => {
  it("splits 14 pages into 6-page requests", () => {
    expect(pageChunks(14)).toEqual(["1,2,3,4,5,6", "7,8,9,10,11,12", "13,14"]);
    expect(pageChunks(1)).toEqual(["1"]);
  });
});
