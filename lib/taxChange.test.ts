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
  it("flags 10% -> 20% as a possible class or current use change, to ask the county about", () => {
    const r = report([
      line({ parcel_id: "p1", tax_year: 2024, appraised_value: 100000, assessed_value: 10000, tax_due: 450 }),
      line({ parcel_id: "p1", tax_year: 2025, appraised_value: 100000, assessed_value: 20000, tax_due: 900 }),
    ]);
    const flag = r.movers[0].flags.find((f) => f.kind === "ratio_shift");
    // The cause is not asserted: 10% to 20% is a class change, which may
    // or may not involve current use.
    expect(flag?.message).toContain("10% (Class III) to 20% (Class II)");
    expect(flag?.message).toContain("current use status");
    expect(flag?.message).toContain("revenue commissioner");
  });

  it("flags 20% -> 10% as gaining current use", () => {
    const r = report([
      line({ parcel_id: "p1", tax_year: 2024, appraised_value: 100000, assessed_value: 20000, tax_due: 900 }),
      line({ parcel_id: "p1", tax_year: 2025, appraised_value: 100000, assessed_value: 10000, tax_due: 450 }),
    ]);
    const flag = r.movers[0].flags.find((f) => f.kind === "ratio_shift");
    expect(flag?.message).toContain("moved into Class III");
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

describe("values that are not the same kind are not compared", () => {
  it("says so instead of splitting the change when one bill printed market value and the other the taxed value", () => {
    // 2024 printed the value the tax was figured on ($60,400 at 10%);
    // 2025 printed market value beside the same current use tax.
    const r = report([
      line({ parcel_id: "p1", tax_year: 2024, appraised_value: 60400, assessed_value: 6040, tax_due: 486 }),
      line({ parcel_id: "p1", tax_year: 2025, appraised_value: 485800, assessed_value: 6040, tax_due: 486 }),
    ]);
    const c = r.movers[0];
    expect(c.valuesComparable).toBe(false);
    expect(c.deltaTax).toBe(0);
    expect(c.valuationEffect).toBeNull();
    expect(c.rateEffect).toBeNull();
    expect(c.pctAppraised).toBeNull();
    expect(c.sentence).toBe(
      "Tax unchanged. The values printed for 2024 and 2025 are not comparable (one looks like a market value, the other the value the tax was figured on), so the change is not split between value and rates."
    );
    // No "Appraised value up 704.3%" and no "ratio moved 10% to 1.2%".
    expect(c.flags).toEqual([]);
    expect(r.summary.flaggedParcels).toBe(0);
  });

  it("uses the bill's own market and current use columns when the re-read filled them", () => {
    const r = report([
      line({ parcel_id: "p1", tax_year: 2024, appraised_value: 60400, tax_due: 181.2, market_value: 485800, current_use_value: 60400 }),
      line({ parcel_id: "p1", tax_year: 2025, appraised_value: 499000, tax_due: 185, market_value: 499000, current_use_value: 61000 }),
    ]);
    const c = r.movers[0];
    expect([c.y0?.valueKind, c.y1?.valueKind]).toEqual(["taxed", "market"]);
    expect(c.valuesComparable).toBe(false);
    expect(c.sentence).toMatch(/^Tax up \$3\.80\. The values printed for 2024 and 2025 are not comparable/);
    expect(c.flags.some((f) => f.kind === "spike")).toBe(false);
  });

  it("falls back on the effective rate when the kind cannot be told", () => {
    // No assessed value either year: value up eightfold with the same tax
    // is a change of what was printed, not a reappraisal.
    const r = report([
      line({ parcel_id: "p1", tax_year: 2024, appraised_value: 60400, tax_due: 181.2 }),
      line({ parcel_id: "p1", tax_year: 2025, appraised_value: 485800, tax_due: 181.2 }),
    ]);
    expect(r.movers[0].valuesComparable).toBe(false);
    expect(r.movers[0].flags.some((f) => f.kind === "spike")).toBe(false);
  });

  it("still decomposes and flags a real spike when both years are the same kind", () => {
    const r = report([
      line({ parcel_id: "p1", tax_year: 2024, appraised_value: 100000, assessed_value: 10000, tax_due: 300 }),
      line({ parcel_id: "p1", tax_year: 2025, appraised_value: 130000, assessed_value: 13000, tax_due: 390 }),
    ]);
    const c = r.movers[0];
    expect(c.valuesComparable).toBe(true);
    expect(c.sentence).toBe("Up $90.00: $90.00 from higher appraisal.");
    expect(c.flags.some((f) => f.kind === "spike")).toBe(true);
  });
});

describe("zero-change sentence", () => {
  it("does not read 'Up $0.00' when value and rates cancel", () => {
    expect(decompositionSentence(0, 486, -486)).toBe("No change in tax: $486.00 from higher appraisal, offset by $486.00 from lower rates.");
    expect(decompositionSentence(0, -20, 20)).toBe("No change in tax: $20.00 from lower appraisal, offset by $20.00 from rates.");
    expect(decompositionSentence(0, 0, 0)).toBe("No change.");
  });
});

describe("ratio shift wording does not assert the cause", () => {
  it("says the class or current use status may have changed and sends the reader to the county", () => {
    const r = report([
      line({ parcel_id: "p1", tax_year: 2024, appraised_value: 100000, assessed_value: 10000, tax_due: 450 }),
      line({ parcel_id: "p1", tax_year: 2025, appraised_value: 100000, assessed_value: 20000, tax_due: 900 }),
    ]);
    const flag = r.movers[0].flags.find((f) => f.kind === "ratio_shift");
    expect(flag?.message).toContain("which can mean the property's class or its current use status changed; ask the county");
    expect(flag?.message).not.toContain("usually means");
  });
});

describe("summary", () => {
  it("does not report a percent change in total value when a parcel's two values are not the same kind", () => {
    const r = report([
      line({ parcel_id: "p1", tax_year: 2024, appraised_value: 60400, assessed_value: 6040, tax_due: 486 }),
      line({ parcel_id: "p1", tax_year: 2025, appraised_value: 485800, assessed_value: 6040, tax_due: 486 }),
      line({ parcel_id: "p2", tax_year: 2024, appraised_value: 50000, assessed_value: 5000, tax_due: 250 }),
      line({ parcel_id: "p2", tax_year: 2025, appraised_value: 50000, assessed_value: 5000, tax_due: 260 }),
    ]);
    expect(r.summary.notComparableParcels).toBe(1);
    expect(r.summary.appraisedPct).toBeNull();
    expect(r.summary.taxPct).toBeCloseTo(10 / 736, 10);
  });
});
