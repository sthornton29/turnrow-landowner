import { describe, expect, it } from "vitest";
import { buildProtestPacket } from "./protestPacket";
import { landValuePerAcre, readCountyRecord } from "./countyRecord";
import { billCheck, buildTaxReport, cuValue, mixValue, millsFor, ownerMatches, valueKind, type ReportInput } from "./taxReport";

// Real county record shapes (Lawrence KCS, Colbert KCS, Morgan).
const lawrenceCU = { TAV: 9700, TTV: 96928, CLandValue: 96928, CImpValue: 0, CALC_ACRE: 211.95, TimberAcres: 9, TaxDist: "01", TotalTaxDue: 291.9, TaxYearDue: 2026, Owner: "ALBEMARLE CORP" };
const lawrenceMarket = { TAV: 8820, CLandValue: 88200, CImpValue: 0, CALC_ACRE: 10.8, TaxDist: "01", TotalTaxDue: 264.6, TaxYearDue: 2026, Owner: "ALBEMARLE CORP" };
const lawrenceHouse = { TAV: 77700, CLandValue: 177986, CImpValue: 415100, CALC_ACRE: 317.8, TaxDist: "01", TotalTaxDue: 2381, TaxYearDue: 2026, Owner: "MARTIN TRUSTS" };
const colbert = { TAV: 14400, CALC_ACRE: 0, GIS_Acres: 269, CLandValue: 143981, CImpValue: 0, TimberAcres: 91, TotalTaxDue: 441.1, TaxDist: "01", HasCurrentUse: "True", CurrentUseValue: 143981, TaxYearDue: 2026, Owner: "ALBEMARLE CORP" };
const morgan = { AssdValue: 4020, TotalLandValue: 492000, TotalImpValue: 0, CalcAcres: 84.8, TimberAcreage: 5, AssessmentClass: 3, TaxDist: "5", RecordYear: 2026, Owner: "ALBEMARLE CORPORATION" };

const CU: ReportInput["cuValues"] = [
  { state: "AL", tax_year: 2025, land_type: "crop_pasture", rating: "good", value_per_acre: 532 },
  { state: "AL", tax_year: 2025, land_type: "crop_pasture", rating: "average", value_per_acre: 443 },
  { state: "AL", tax_year: 2025, land_type: "crop_pasture", rating: "poor", value_per_acre: 310 },
  { state: "AL", tax_year: 2025, land_type: "timber", rating: "good", value_per_acre: 827 },
  { state: "AL", tax_year: 2025, land_type: "timber", rating: "average", value_per_acre: 630 },
  { state: "AL", tax_year: 2025, land_type: "timber", rating: "poor", value_per_acre: 449 },
];
const MILLS: ReportInput["millage"] = [
  { state: "AL", county: "Lawrence", district: "01", tax_year: 2025, total_mills: 30, timber_per_acre: 0.1, dwelling_fee: 25, verified: true },
  { state: "AL", county: "Colbert", district: "01", tax_year: 2025, total_mills: 30, timber_per_acre: 0.1, dwelling_fee: 50, verified: true },
  { state: "AL", county: "Morgan", district: "*", tax_year: 2025, total_mills: 37.4, timber_per_acre: 0.1, dwelling_fee: null, verified: false },
];

describe("county records", () => {
  it("reads Lawrence, Colbert, and Morgan into one shape", () => {
    const l = readCountyRecord(lawrenceCU)!;
    expect([l.assessed, l.taxableValue, l.timberAcres, l.taxDistrict, l.year]).toEqual([9700, 97000, 9, "01", 2026]);
    const c = readCountyRecord(colbert)!;
    expect([c.hasCurrentUse, c.calcAcres, c.currentUseValue]).toEqual([true, 269, 143981]);
    const m = readCountyRecord(morgan)!;
    expect([m.assessed, m.taxableValue, m.landValue, m.timberAcres, m.assessmentClass]).toEqual([4020, 40200, 492000, 5, 3]);
  });

  it("figures taxable land value per acre without the buildings", () => {
    expect(Math.round(landValuePerAcre(readCountyRecord(lawrenceCU)!, 211.95)!)).toBe(457);
    // A shop assessed at 20%: the county's own land value ($560/ac) is
    // used, not the assessed total worked back at 10% ($1,139/ac).
    expect(Math.round(landValuePerAcre(readCountyRecord(lawrenceHouse)!, 317.8)!)).toBe(560);
    // Morgan: market land value is $5,800/ac, but the TAXABLE value is current use
    expect(Math.round(landValuePerAcre(readCountyRecord(morgan)!, 84.8)!)).toBe(474);
  });
});

describe("rates", () => {
  it("picks current use values and mixes timber and crop", () => {
    expect(cuValue(CU, "AL", 2026, "timber", "good")).toEqual({ value: 827, year: 2025 });
    expect(mixValue(CU, "AL", 2026, 100, 25, "good")).toBe(0.25 * 827 + 0.75 * 532);
  });

  it("finds a district rate or the county default", () => {
    expect(millsFor(MILLS, "AL", "Lawrence", "01", 2026)?.total_mills).toBe(30);
    expect(millsFor(MILLS, "AL", "Morgan", "5", 2026)?.total_mills).toBe(37.4);
    expect(millsFor(MILLS, "AL", "Lawrence", "99", 2026)).toBeNull();
  });

  it("ties a bill out to the penny, allowing for building fees", () => {
    expect(billCheck(readCountyRecord(lawrenceCU)!, MILLS[0])).toEqual({ expected: 291.9, actual: 291.9, diff: 0 });
    // assessed 77,700 x 30 mills = 2,331 + two $25 fees = 2,381
    expect(billCheck(readCountyRecord(lawrenceHouse)!, MILLS[0])?.diff).toBe(0);
  });

  it("matches county owner names to entities loosely", () => {
    expect(ownerMatches("ALBEMARLE CORP", ["Albemarle Corporation"])).toBe(true);
    expect(ownerMatches("MARTIN LARKIN ETAL", ["Martin Trusts"])).toBe(true);
    expect(ownerMatches("REDD UHLAND", ["Albemarle Corporation"])).toBe(false);
  });
});

function input(over: Partial<ReportInput> = {}): ReportInput {
  return {
    year: 2025,
    today: new Date("2026-11-09T12:00:00"),
    state: "AL",
    propertyScope: null,
    county: null,
    lines: [
      { id: "l1", tax_statement_id: "s1", tax_year: 2025, tax_due: 291.9, parcel_id: "p1" },
      { id: "l2", tax_statement_id: "s1", tax_year: 2025, tax_due: 264.6, parcel_id: "p2" },
      { id: "l3", tax_statement_id: "s0", tax_year: 2024, tax_due: 291.3, parcel_id: "p1" },
      { id: "l4", tax_statement_id: "s0", tax_year: 2024, tax_due: 200, parcel_id: "p2" },
      { id: "l5", tax_statement_id: "s0", tax_year: 2024, tax_due: 50, parcel_id: "p3" },
    ],
    statements: [
      { id: "s1", tax_year: 2025, county: "Lawrence", amount_due: 556.5, delinquent_date: "2026-01-01", entity_id: "e1" },
      { id: "s0", tax_year: 2024, county: "Lawrence", amount_due: 541.3, delinquent_date: "2025-01-01", entity_id: "e1" },
    ],
    payments: [{ tax_statement_id: "s1", amount: 556.5 }, { tax_statement_id: "s0", amount: 541.3 }],
    parcels: [
      { id: "p1", parcel_number: "06 05 22", county: "Lawrence", property_id: "A", acres: 210, deeded_acres: null, attributes: lawrenceCU },
      { id: "p2", parcel_number: "07 03 08", county: "Lawrence", property_id: "A", acres: 10.8, deeded_acres: null, attributes: lawrenceMarket },
      { id: "p3", parcel_number: "09 09 09", county: "Lawrence", property_id: "A", acres: 5, deeded_acres: null, attributes: null },
    ],
    properties: [{ id: "A", name: "Green", entity_id: "e1" }],
    entityNames: new Map([["e1", ["Albemarle Corporation"]]]),
    landUse: new Map([["A", { timber: 40, crop: 150, pasture: 0, leased: true }]]),
    incomeByProperty: new Map([["A", new Map([[2025, 20000]])]]),
    cuValues: CU,
    millage: MILLS,
    ...over,
  };
}

describe("buildTaxReport", () => {
  it("leads with the bottom line and a reason", () => {
    const r = buildTaxReport(input());
    expect(r.bottom.tax).toBe(556.5);
    expect(r.bottom.priorTax).toBe(541.3);
    expect(r.bottom.paid).toBe(556.5);
    expect(r.bottom.outstanding).toBe(0);
    expect(r.bottom.reason).toMatch(/^Up \$15 from 2024/);
    expect(r.bottom.pctIncome).toBeCloseTo(556.5 / 20000, 5);
  });

  it("flags a market-valued parcel with farm use as a high current use finding with savings", () => {
    const r = buildTaxReport(input());
    const f = r.findings.find((x) => x.kind === "current_use")!;
    expect(f.parcelId).toBe("p2");
    expect(f.severity).toBe("high");
    expect(f.dollars).toBeGreaterThan(200);
    expect(f.deadline).toBe("2027-01-01");
    expect(r.parcels.find((p) => p.id === "p1")!.cuStatus).toBe("looks_cu");
  });

  it("reports a parcel entered twice once, and flags the duplicate", () => {
    const base = input();
    const r = buildTaxReport(input({ parcels: [...base.parcels, { ...base.parcels[1], id: "p2b", property_id: "A" }] }));
    expect(r.parcels.filter((p) => p.parcelNumber === "07 03 08")).toHaveLength(1);
    expect(r.findings.filter((f) => f.kind === "current_use")).toHaveLength(1);
    expect(r.findings.some((f) => f.kind === "duplicate_parcel")).toBe(true);
  });

  it("flags a statement line far from the county's figure", () => {
    const base = input();
    const r = buildTaxReport(input({ lines: base.lines.map((l) => (l.id === "l1" ? { ...l, tax_due: 3442.9 } : l)) }));
    expect(r.findings.some((f) => f.kind === "line_mismatch" && f.parcelId === "p1")).toBe(true);
  });

  it("flags a tax jump and a missing bill, ranked high before low", () => {
    const r = buildTaxReport(input());
    expect(r.findings.some((f) => f.kind === "tax_jump" && f.parcelId === "p2")).toBe(true);
    expect(r.findings.some((f) => f.kind === "missing_bill" && f.parcelId === "p3")).toBe(true);
    const ranks = r.findings.map((f) => ({ high: 0, medium: 1, low: 2 })[f.severity]);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  it("uses the county's own current use answer when it has one", () => {
    const r = buildTaxReport(
      input({
        parcels: [{ id: "c1", parcel_number: "11 07 26", county: "Colbert", property_id: "A", acres: 269, deeded_acres: null, attributes: colbert }],
        lines: [{ id: "x", tax_statement_id: "s1", tax_year: 2025, tax_due: 441.1, parcel_id: "c1" }],
      })
    );
    expect(r.parcels[0].cuStatus).toBe("county_yes");
    expect(r.findings.some((f) => f.kind === "current_use")).toBe(false);
    expect(r.findings.some((f) => f.kind === "bill_check")).toBe(false);
  });

  it("previews next year's bills from the county records", () => {
    const r = buildTaxReport(input());
    expect(r.nextYear).toEqual({ total: 556.5, covered: 2, parcelsInScope: 3, thisYear: 556.5 });
  });

  it("flags an unpaid bill near delinquency", () => {
    const r = buildTaxReport(
      input({ year: 2026, statements: [{ id: "s2", tax_year: 2026, county: "Lawrence", amount_due: 300, delinquent_date: "2027-01-01", entity_id: "e1" }], lines: [{ id: "y", tax_statement_id: "s2", tax_year: 2026, tax_due: 300, parcel_id: "p1" }], payments: [] })
    );
    const f = r.findings.find((x) => x.kind === "unpaid")!;
    expect(f.severity).toBe("high");
    expect(f.dollars).toBe(300);
  });

  it("counts down the 30-day protest window from a logged notice", () => {
    const open = buildTaxReport(input({ notices: [{ county: "Lawrence", tax_year: 2026, notice_date: "2026-10-20", parcel_id: null }] }));
    expect(open.openNotices).toEqual([{ county: "Lawrence", notice_date: "2026-10-20", deadline: "2026-11-19", parcelId: null }]);
    expect(open.findings[0].kind).toBe("protest_window");
    expect(open.deadlines.some((d) => d.date === "2026-11-19")).toBe(true);
    const closed = buildTaxReport(input({ notices: [{ county: "Lawrence", tax_year: 2026, notice_date: "2026-09-01", parcel_id: null }] }));
    expect(closed.openNotices).toHaveLength(0);
    const other = buildTaxReport(input({ county: "Colbert", notices: [{ county: "Lawrence", tax_year: 2026, notice_date: "2026-10-20", parcel_id: null }] }));
    expect(other.openNotices).toHaveLength(0);
  });

  it("sums tax paid by calendar year, splitting a bill by line", () => {
    const r = buildTaxReport(
      input({
        payments: [
          { tax_statement_id: "s1", amount: 556.5, paid_date: "2026-01-05" },
          { tax_statement_id: "s0", amount: 541.3, paid_date: "2024-12-20" },
        ],
      })
    );
    expect(r.paidByYear.map((p) => [p.year, p.entity, p.property, p.amount])).toEqual([
      [2026, "Albemarle Corporation", "Green", 556.5],
      [2024, "Albemarle Corporation", "Green", 541.3],
    ]);
    // Payments without a date are left out rather than guessed.
    expect(buildTaxReport(input()).paidByYear).toHaveLength(0);
  });
});

describe("value kinds", () => {
  it("tells a taxed value from a market value printed beside current use", () => {
    // 97,000 x 10% x 30 mills = 291 + 9 timber ac x $0.10 = 291.90
    expect(valueKind(97000, 291.9, 30, 9)).toBe("taxed");
    expect(valueKind(900000, 291.9, 30, 9)).toBe("market");
    expect(valueKind(null, 291.9, 30)).toBe("unknown");
  });
});


describe("protest packet", () => {
  const ctx = { entityName: "Albemarle Corporation", today: new Date("2026-11-09T12:00:00"), cuValues: CU, state: "AL" };

  it("gathers the county record, grounds, comparables, and the deadline for one parcel", () => {
    const r = buildTaxReport(input({ notices: [{ county: "Lawrence", tax_year: 2026, notice_date: "2026-10-20", parcel_id: null }] }));
    const pk = buildProtestPacket(r, "p2", ctx)!;
    expect(pk.parcelNumber).toBe("07 03 08");
    expect(pk.valuationYear).toBe(2026);
    expect(pk.deadline).toEqual({ date: "2026-11-19", noticeDate: "2026-10-20" });
    expect(pk.grounds.some((g) => g.heading === "Current use classification" && g.forWhom === "assessor")).toBe(true);
    expect(pk.facts.find(([k]) => k === "Assessed value")?.[1]).toBe("$8,820");
    expect(pk.comparables.map((c) => c.parcelNumber)).toEqual(["06 05 22"]);
    expect(pk.cuTable?.year).toBe(2025);
    expect(pk.letter[0]).toBe("To the Lawrence County Board of Equalization");
    expect(pk.letter[1]).toContain("notice dated 2026-10-20");
    expect(pk.checklist[0]).toContain("by 2026-11-19");
    expect(pk.checklist.some((c) => c.includes("cuapp"))).toBe(true);
  });

  it("still makes a packet with blanks when nothing was found, and none for an unknown parcel", () => {
    const r = buildTaxReport(input());
    const pk = buildProtestPacket(r, "p1", ctx)!;
    expect(pk.deadline).toBeNull();
    expect(pk.letter.some((l) => l.startsWith("Reasons: ___"))).toBe(true);
    expect(buildProtestPacket(r, "nope", ctx)).toBeNull();
  });
});
