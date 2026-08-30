import { describe, expect, it } from "vitest";
import { buildTaxChangeReport, decompositionSentence } from "./taxChange";
import type { TaxStatementLineRow } from "./tax";

// Fixture helpers: one line per parcel per year, the shape the unique
// (parcel_id, tax_year) index guarantees.
const line = (over: Partial<TaxStatementLineRow>): TaxStatementLineRow => ({
  id: crypto.randomUUID(),
  tax_statement_id: "s",
  line_no: 1,
  tax_year: 2025,
  line_type: "real_property",
  identifiers: [],
  appraised_value: null,
  assessed_value: null,
  tax_due: 0,
  exemptions: null,
  legal_description: null,
  property_address: null,
  acres: null,
  parcel_id: null,
  match_source: null,
  match_evidence: null,
  confirmed: false,
  ...over,
});

const parcels = [
  { id: "p1", parcel_number: "07 09 31 0 000 003.000", county: "Lawrence", property_id: "propA" },
  { id: "p2", parcel_number: "11 07 26 0 000 001.000", county: "Colbert", property_id: "propB" },
];

const report = (lines: TaxStatementLineRow[], over: Partial<Parameters<typeof buildTaxChangeReport>[2]> = {}) =>
  buildTaxChangeReport(lines, parcels, { y0: 2024, y1: 2025, ...over });

describe("decomposition", () => {
  it("splits a mixed change exactly: valuation at the prior rate, rates at the current value", () => {
    // 2024: value 100,000, tax 500 (rate 0.5%). 2025: value 160,000,
    // tax 912 (rate 0.57%). deltaTax = 412. Valuation effect =
    // 0.005 * 60,000 = 300. Rate effect = the remaining 112.
    const r = report([
      line({ parcel_id: "p1", tax_year: 2024, appraised_value: 100000, tax_due: 500 }),
      line({ parcel_id: "p1", tax_year: 2025, appraised_value: 160000, tax_due: 912 }),
    ]);
    const c = r.movers[0];
    expect(c.deltaTax).toBe(412);
    expect(c.valuationEffect).toBe(300);
    expect(c.rateEffect).toBe(112);
    expect(c.valuationEffect! + c.rateEffect!).toBe(c.deltaTax!);
    expect(c.sentence).toBe("Up $412.00: $300.00 from higher appraisal, $112.00 from rates.");
  });

  it("value-only year: the whole change is the valuation effect", () => {
    // Rate constant at 1%: 100,000 -> 120,000 moves tax 1,000 -> 1,200.
    const r = report([
      line({ parcel_id: "p1", tax_year: 2024, appraised_value: 100000, tax_due: 1000 }),
      line({ parcel_id: "p1", tax_year: 2025, appraised_value: 120000, tax_due: 1200 }),
    ]);
    const c = r.movers[0];
    expect(c.deltaTax).toBe(200);
    expect(c.valuationEffect).toBe(200);
    expect(c.rateEffect).toBe(0);
    expect(c.sentence).toBe("Up $200.00: $200.00 from higher appraisal.");
  });

  it("rate-only year: the whole change is the rate effect", () => {
    // Value pinned at 100,000; millage moves tax 1,000 -> 1,150.
    const r = report([
      line({ parcel_id: "p1", tax_year: 2024, appraised_value: 100000, tax_due: 1000 }),
      line({ parcel_id: "p1", tax_year: 2025, appraised_value: 100000, tax_due: 1150 }),
    ]);
    const c = r.movers[0];
    expect(c.deltaTax).toBe(150);
    expect(c.valuationEffect).toBe(0);
    expect(c.rateEffect).toBe(150);
    expect(c.sentence).toBe("Up $150.00: $150.00 from rates.");
  });

  it("a decrease reads Down with lower appraisal", () => {
    expect(decompositionSentence(-100, -100, 0)).toBe(
      "Down $100.00: $100.00 from lower appraisal."
    );
  });

  it("cents always reconcile even with awkward rates", () => {
    const r = report([
      line({ parcel_id: "p1", tax_year: 2024, appraised_value: 123457, tax_due: 617.33 }),
      line({ parcel_id: "p1", tax_year: 2025, appraised_value: 145931, tax_due: 803.17 }),
    ]);
    const c = r.movers[0];
    expect(c.valuationEffect! + c.rateEffect!).toBeCloseTo(c.deltaTax!, 10);
  });

  it("no decomposition without appraised values, but the tax delta still reports", () => {
    const r = report([
      line({ parcel_id: "p1", tax_year: 2024, tax_due: 500 }),
      line({ parcel_id: "p1", tax_year: 2025, tax_due: 700 }),
    ]);
    const c = r.movers[0];
    expect(c.deltaTax).toBe(200);
    expect(c.sentence).toBeNull();
    expect(c.valuationEffect).toBeNull();
  });
});

describe("assessment ratio flags (Alabama classes)", () => {
  it("flags 10% -> 20% as probable loss of current use", () => {
    const r = report([
      line({ parcel_id: "p1", tax_year: 2024, appraised_value: 100000, assessed_value: 10000, tax_due: 450 }),
      line({ parcel_id: "p1", tax_year: 2025, appraised_value: 100000, assessed_value: 20000, tax_due: 900 }),
    ]);
    const flag = r.movers[0].flags.find((f) => f.kind === "ratio_shift");
    expect(flag?.message).toContain("current use (Class III) was probably LOST");
    expect(flag?.message).toContain("revenue commissioner");
  });

  it("flags 20% -> 10% as gaining current use", () => {
    const r = report([
      line({ parcel_id: "p1", tax_year: 2024, appraised_value: 100000, assessed_value: 20000, tax_due: 900 }),
      line({ parcel_id: "p1", tax_year: 2025, appraised_value: 100000, assessed_value: 10000, tax_due: 450 }),
    ]);
    const flag = r.movers[0].flags.find((f) => f.kind === "ratio_shift");
    expect(flag?.message).toContain("gained current use");
  });

  it("stays quiet for a stable ratio", () => {
    const r = report([
      line({ parcel_id: "p1", tax_year: 2024, appraised_value: 100000, assessed_value: 10000, tax_due: 450 }),
      line({ parcel_id: "p1", tax_year: 2025, appraised_value: 110000, assessed_value: 11000, tax_due: 500 }),
    ]);
    expect(r.movers[0].flags.some((f) => f.kind === "ratio_shift")).toBe(false);
  });

  it("flags a disappearing exemption code by name", () => {
    const r = report([
      line({ parcel_id: "p1", tax_year: 2024, appraised_value: 100000, tax_due: 300, exemptions: "H1" }),
      line({ parcel_id: "p1", tax_year: 2025, appraised_value: 100000, tax_due: 500, exemptions: null }),
    ]);
    const flag = r.movers[0].flags.find((f) => f.kind === "exemption_change");
    expect(flag?.message).toContain("H1 no longer appears");
  });
});

describe("spike and presence flags", () => {
  it("flags a value spike past the threshold (default 15%), not one under it", () => {
    const r = report([
      line({ parcel_id: "p1", tax_year: 2024, appraised_value: 100000, tax_due: 500 }),
      line({ parcel_id: "p1", tax_year: 2025, appraised_value: 118000, tax_due: 590 }),
      line({ parcel_id: "p2", tax_year: 2024, appraised_value: 100000, tax_due: 500 }),
      line({ parcel_id: "p2", tax_year: 2025, appraised_value: 112000, tax_due: 560 }),
    ]);
    const p1 = r.movers.find((m) => m.parcelId === "p1")!;
    const p2 = r.movers.find((m) => m.parcelId === "p2")!;
    expect(p1.flags.some((f) => f.kind === "spike")).toBe(true);
    expect(p2.flags.some((f) => f.kind === "spike")).toBe(false);
  });

  it("respects a custom threshold", () => {
    const r = report(
      [
        line({ parcel_id: "p1", tax_year: 2024, appraised_value: 100000, tax_due: 500 }),
        line({ parcel_id: "p1", tax_year: 2025, appraised_value: 112000, tax_due: 560 }),
      ],
      { spikeThreshold: 0.1 }
    );
    expect(r.movers[0].flags.some((f) => f.kind === "spike")).toBe(true);
  });

  it("surfaces parcels missing in one year instead of dropping them", () => {
    const r = report([
      line({ parcel_id: "p1", tax_year: 2024, appraised_value: 100000, tax_due: 500 }),
      line({ parcel_id: "p2", tax_year: 2025, appraised_value: 50000, tax_due: 250 }),
    ]);
    expect(r.movers).toHaveLength(0); // neither has both years
    const kinds = r.flagged.flatMap((c) => c.flags.map((f) => f.kind));
    expect(kinds).toContain("disappeared");
    expect(kinds).toContain("appeared");
  });
});

describe("scope and totals", () => {
  const twoParcelLines = [
    line({ parcel_id: "p1", tax_year: 2024, appraised_value: 100000, tax_due: 500 }),
    line({ parcel_id: "p1", tax_year: 2025, appraised_value: 120000, tax_due: 600 }),
    line({ parcel_id: "p2", tax_year: 2024, appraised_value: 50000, tax_due: 250 }),
    line({ parcel_id: "p2", tax_year: 2025, appraised_value: 50000, tax_due: 260 }),
    // Personal property and unmatched lines never enter parcel math.
    line({ parcel_id: null, tax_year: 2025, tax_due: 999, line_type: "personal_property" }),
    line({ parcel_id: null, tax_year: 2025, tax_due: 111 }),
  ];

  it("totals per year cover the scope and endpoints report percent changes", () => {
    const r = report(twoParcelLines);
    expect(r.perYear).toEqual([
      { year: 2024, totalTax: 750, totalAppraised: 150000 },
      { year: 2025, totalTax: 860, totalAppraised: 170000 },
    ]);
    expect(r.summary.tax0).toBe(750);
    expect(r.summary.tax1).toBe(860);
    expect(r.summary.taxPct).toBeCloseTo(110 / 750, 10);
    expect(r.summary.comparedParcels).toBe(2);
  });

  it("property and county scopes narrow the report", () => {
    const byProp = report(twoParcelLines, { propertyIds: new Set(["propA"]) });
    expect(byProp.movers).toHaveLength(1);
    expect(byProp.movers[0].parcelId).toBe("p1");
    expect(byProp.summary.tax1).toBe(600);

    const byCounty = report(twoParcelLines, { county: "Colbert" });
    expect(byCounty.movers).toHaveLength(1);
    expect(byCounty.movers[0].parcelId).toBe("p2");
  });

  it("movers sort by absolute tax change", () => {
    const r = report(twoParcelLines);
    expect(r.movers.map((m) => m.parcelId)).toEqual(["p1", "p2"]);
  });
});
