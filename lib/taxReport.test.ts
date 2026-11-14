import { describe, expect, it } from "vitest";
import { buildProtestPacket } from "./protestPacket";
import { landValuePerAcre, readCountyRecord } from "./countyRecord";
import { billCheck, buildTaxReport, cuValue, deadlineText, lastBusinessDayOfDecember, mixValue, millsFor, ownerMatches, valueKind, type ReportInput } from "./taxReport";

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
    // Taxable value is the county's own land plus buildings ($96,928),
    // not the assessed value worked back at 10% ($97,000, which only
    // reflects the county rounding the assessed value to $20).
    expect([l.assessed, l.taxableValue, l.timberAcres, l.taxDistrict, l.year]).toEqual([9700, 96928, 9, "01", 2026]);
    const c = readCountyRecord(colbert)!;
    expect([c.hasCurrentUse, c.calcAcres, c.currentUseValue]).toEqual([true, 269, 143981]);
    const m = readCountyRecord(morgan)!;
    expect([m.assessed, m.taxableValue, m.landValue, m.timberAcres, m.assessmentClass]).toEqual([4020, 40200, 492000, 5, 3]);
  });

  it("takes the taxable value from the county's land and building values, and marks a worked-back figure as estimated", () => {
    // A shop assessed at 20% beside land at 10%: assessed / 10% would
    // say $777,000 for a parcel the county values at $593,086.
    const house = readCountyRecord(lawrenceHouse)!;
    expect(house.taxableValue).toBe(177986 + 415100);
    expect(house.taxableValueEstimated).toBe(false);
    // Morgan's land value is MARKET value, so it is never used; its class
    // field gives the ratio (10% for Class III, 20% for Class II).
    expect(readCountyRecord(morgan)!.taxableValueEstimated).toBe(false);
    expect(readCountyRecord({ ...morgan, AssessmentClass: 2 })!.taxableValue).toBe(20100);
    // No taxable land value and no class: 10% is assumed and the figure
    // is labeled an estimate.
    const bare = readCountyRecord({ AssdValue: 4020, TotalLandValue: 492000 })!;
    expect(bare.taxableValue).toBe(40200);
    expect(bare.taxableValueEstimated).toBe(true);
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
    // The last business day of December: Jan 1 is a holiday.
    expect(f.deadline).toBe("2026-12-31");
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

// ---------------------------------------------------------------- pre-rollout review

// One unpaid 2026 Lawrence bill on p1, for the deadline tests.
const unpaid2026 = (over: Partial<ReportInput> = {}, delinquent: string | null = "2027-01-01", amount = 300) =>
  input({
    year: 2026,
    statements: [{ id: "s2", tax_year: 2026, county: "Lawrence", amount_due: amount, delinquent_date: delinquent, entity_id: "e1" }],
    lines: [{ id: "y", tax_statement_id: "s2", tax_year: 2026, tax_due: amount, parcel_id: "p1" }],
    payments: [],
    ...over,
  });

describe("unpaid bills: the last day to pay is the day before the delinquent date", () => {
  it("says pay by Dec 31 for a bill that goes delinquent Jan 1, in words and in the deadline", () => {
    const f = buildTaxReport(unpaid2026()).findings.find((x) => x.kind === "unpaid")!;
    expect(f.title).toBe("Unpaid: Lawrence 2026 bill");
    expect(f.deadline).toBe("2026-12-31");
    expect(f.detail).toContain("$300.00 still open. Pay by Dec 31, 2026; delinquent Jan 1, 2027.");
    expect(f.detail).not.toContain("2027-01-01");
  });

  it("means the same thing when no delinquent date is on file", () => {
    const f = buildTaxReport(unpaid2026({}, null)).findings.find((x) => x.kind === "unpaid")!;
    expect(f.deadline).toBe("2026-12-31");
    expect(f.detail).toContain("Pay by Dec 31, 2026; delinquent Jan 1, 2027.");
  });

  it("is still on time on Dec 31 and delinquent on Jan 1 itself", () => {
    const eve = buildTaxReport(unpaid2026({ today: new Date("2026-12-31T20:00:00") })).findings.find((x) => x.kind === "unpaid")!;
    expect(eve.title).toMatch(/^Unpaid/);
    const newYear = buildTaxReport(unpaid2026({ today: new Date("2027-01-01T08:00:00") })).findings.find((x) => x.kind === "unpaid")!;
    expect(newYear.title).toBe("Delinquent: Lawrence 2026 bill");
    expect(newYear.detail).toContain("it went delinquent Jan 1, 2027 (the last day to pay on time was Dec 31, 2026)");
    expect(newYear.deadline).toBe("2026-12-31");
  });

  it("prints dollars with commas", () => {
    const f = buildTaxReport(unpaid2026({}, "2027-01-01", 13647.18)).findings.find((x) => x.kind === "unpaid")!;
    expect(f.detail).toContain("$13,647.18 still open");
  });

  it("never says 'By' a date that has already passed", () => {
    expect(deadlineText("2026-12-31", "2026-11-14")).toBe("By Dec 31, 2026.");
    expect(deadlineText("2026-11-14", "2026-11-14")).toBe("By Nov 14, 2026.");
    expect(deadlineText("2025-12-31", "2026-11-14")).toBe("This was due Dec 31, 2025.");
  });
});

describe("missing bills", () => {
  // p1 and p2 were billed for 2025; nothing at all is on file for 2026.
  const none2026 = (today: string) => {
    const base = input();
    return buildTaxReport(input({ year: 2026, today: new Date(today), lines: base.lines.filter((l) => l.tax_year === 2025), statements: [base.statements[0]], payments: [base.payments[0]] }));
  };

  it("flags every parcel billed last year when a whole county's bills are missing, instead of reporting nothing", () => {
    const r = none2026("2026-11-14T12:00:00");
    expect(r.coverage.lines).toBe(0);
    const missing = r.findings.filter((f) => f.kind === "missing_bill");
    expect(missing.map((f) => f.parcelId).sort()).toEqual(["p1", "p2"]);
    expect(missing.every((f) => f.severity === "high" && f.deadline === "2026-12-31")).toBe(true);
    expect(missing.find((f) => f.parcelId === "p1")!.detail).toBe("Parcel 06 05 22 was billed $291.90 for 2025, but no 2026 statement line is matched to it.");
    expect(r.bottom.findings).toBeGreaterThanOrEqual(2);
  });

  it("waits for Oct 1 of the tax year, is medium in October, and stays high from Nov 1 until the bill is on file", () => {
    const sev = (today: string) => none2026(today).findings.filter((f) => f.kind === "missing_bill").map((f) => f.severity);
    expect(sev("2026-09-30T12:00:00")).toEqual([]);
    expect(sev("2026-10-01T12:00:00")).toEqual(["medium", "medium"]);
    expect(sev("2026-11-01T12:00:00")).toEqual(["high", "high"]);
    // It used to drop to medium in January, after the bill went delinquent.
    expect(sev("2027-02-10T12:00:00")).toEqual(["high", "high"]);
  });
});

describe("a parcel entered twice", () => {
  it("counts bill lines matched to the second copy, so no false missing bill", () => {
    const base = input();
    const r = buildTaxReport(
      input({
        parcels: [...base.parcels, { ...base.parcels[1], id: "p2b" }],
        lines: base.lines.map((l) => (l.id === "l2" ? { ...l, parcel_id: "p2b" } : l)),
      })
    );
    expect(r.bottom.tax).toBe(556.5);
    expect(r.bottom.paid).toBe(556.5);
    expect(r.parcels.find((p) => p.id === "p2")!.tax).toBe(264.6);
    expect(r.findings.some((f) => f.kind === "missing_bill" && f.parcelId === "p2")).toBe(false);
    expect(r.findings.some((f) => f.kind === "duplicate_parcel")).toBe(true);
  });

  it("counts them too when the other copy sits under a property outside the view", () => {
    const base = input();
    const r = buildTaxReport(
      input({
        propertyScope: new Set(["A"]),
        properties: [...base.properties, { id: "B", name: "Blue", entity_id: "e2" }],
        parcels: [...base.parcels, { ...base.parcels[1], id: "p2b", property_id: "B" }],
        lines: base.lines.map((l) => (l.id === "l2" ? { ...l, parcel_id: "p2b" } : l)),
      })
    );
    expect(r.parcels.find((p) => p.id === "p2")!.tax).toBe(264.6);
    expect(r.findings.some((f) => f.kind === "missing_bill" && f.parcelId === "p2")).toBe(false);
    expect(r.findings.find((f) => f.kind === "duplicate_parcel")?.detail).toContain("under different properties");
  });
});

describe("payments are spread over the whole statement", () => {
  // A $1,000 statement: $900 on p1 and a $100 personal property line that
  // row level security hides from a 'user' member. $500 has been paid.
  const view = (lines: ReportInput["lines"], over: Partial<ReportInput> = {}) =>
    buildTaxReport(
      input({
        year: 2026,
        today: new Date("2026-10-20T12:00:00"),
        statements: [{ id: "s9", tax_year: 2026, county: "Lawrence", amount_due: 1000, line_total: 1000, delinquent_date: "2027-01-01", entity_id: "e1" }],
        lines,
        payments: [{ tax_statement_id: "s9", amount: 500, paid_date: "2026-10-15" }],
        ...over,
      })
    );
  const onP1 = { id: "a", tax_statement_id: "s9", tax_year: 2026, tax_due: 900, parcel_id: "p1" };
  const personal = { id: "b", tax_statement_id: "s9", tax_year: 2026, tax_due: 100, parcel_id: null, line_type: "personal_property" };

  it("a member who cannot see every line sees the same paid figure on the property as an admin", () => {
    const admin = view([onP1, personal]);
    const member = view([onP1]);
    expect(admin.bottom.paid).toBe(500);
    // It used to read $500 paid against the $900 in view.
    expect(member.bottom.paid).toBe(450);
    expect(member.bottom.outstanding).toBe(450);
    const rows = (r: typeof admin) => r.paidByYear.map((p) => [p.year, p.entity, p.property, p.amount]);
    expect(rows(admin)).toEqual([
      [2026, "Albemarle Corporation", "Green", 450],
      [2026, "Albemarle Corporation", "Not tied to a parcel", 50],
    ]);
    expect(rows(member)).toEqual(rows(admin));
  });

  it("with an entity filter, keeps the entity's own lines that are not tied to a parcel", () => {
    const base = input();
    const unmatched = { id: "c", tax_statement_id: "s9", tax_year: 2026, tax_due: 60, parcel_id: null, line_type: "real_property" };
    const lines = [onP1, unmatched, { ...personal, tax_due: 40 }];
    const properties = [...base.properties, { id: "B", name: "Blue", entity_id: "e2" }];
    const e1 = view(lines, { properties, propertyScope: new Set(["A"]), entityId: "e1" });
    expect(e1.bottom.tax).toBe(1000);
    expect(e1.bottom.paid).toBe(500);
    expect(e1.findings.find((f) => f.kind === "unmatched")?.title).toBe("1 bill line not tied to a parcel");
    expect(e1.properties.find((p) => p.name === "Not tied to a parcel")?.tax).toBe(100);
    expect(e1.paidByYear.map((p) => [p.property, p.amount])).toEqual([
      ["Green", 450],
      ["Not tied to a parcel", 50],
    ]);
    // Another entity's view never picks them up, and neither does a view
    // narrowed to one property.
    const e2 = view(lines, { properties, propertyScope: new Set(["B"]), entityId: "e2" });
    expect(e2.bottom.tax).toBe(0);
    expect(e2.paidByYear).toEqual([]);
    const oneProperty = view(lines, { properties, propertyScope: new Set(["A"]), entityId: null });
    expect(oneProperty.bottom.tax).toBe(900);
  });

  it("still flags an unpaid bill in an entity view when none of its lines is tied to a parcel", () => {
    const loose = { id: "c", tax_statement_id: "s9", tax_year: 2026, tax_due: 1000, parcel_id: null, line_type: "real_property" };
    const r = view([loose], { today: new Date("2026-12-01T12:00:00"), propertyScope: new Set(["A"]), entityId: "e1" });
    expect(r.findings.find((f) => f.kind === "unpaid")?.dollars).toBe(500);
  });
});

describe("dates and wording", () => {
  it("dates the coming valuation notice season this year until April 1 passes", () => {
    const season = (today: string) => buildTaxReport(input({ today: new Date(today) })).deadlines.find((d) => d.label.startsWith("Valuation notices"))?.date;
    expect(season("2026-11-09T12:00:00")).toBe("2027-04-01");
    // In January to March it used to skip the season about to start.
    expect(season("2027-02-10T12:00:00")).toBe("2027-04-01");
    expect(season("2027-05-10T12:00:00")).toBe("2028-04-01");
  });

  it("puts the current use deadline on the last business day of December, never the Jan 1 holiday", () => {
    expect(lastBusinessDayOfDecember(2026)).toBe("2026-12-31"); // Thursday
    expect(lastBusinessDayOfDecember(2022)).toBe("2022-12-30"); // Dec 31 was a Saturday
    expect(lastBusinessDayOfDecember(2028)).toBe("2028-12-29"); // Dec 31 is a Sunday
    const r = buildTaxReport(input());
    const f = r.findings.find((x) => x.kind === "current_use")!;
    expect(f.deadline).toBe("2026-12-31");
    expect(f.action).toContain("between Oct 1 and the last business day of December");
    expect(r.deadlines.find((d) => d.label.startsWith("Current use applications close"))).toMatchObject({
      date: "2026-12-31",
      label: "Current use applications close on the last business day of December",
    });
    expect(r.deadlines.some((d) => d.label.includes("Jan 1"))).toBe(false);
  });

  it("hedges the current use ceiling, the 30-day protest date, and the yearly increase cap", () => {
    const r = buildTaxReport(input({ notices: [{ county: "Lawrence", tax_year: 2026, notice_date: "2026-10-20", parcel_id: null }] }));
    const cu = r.findings.find((x) => x.kind === "current_use")!;
    expect(cu.detail).toContain("on 10.8 acres; current use values for the best soil class are about $");
    expect(cu.detail).not.toContain("cannot be valued");
    const notice = r.findings.find((x) => x.kind === "protest_window")!;
    expect(notice.detail).toContain("The notice dated Oct 20, 2026 can be protested to the Lawrence County Board of Equalization until about Nov 19, 2026 (30 days from the notice).");
    expect(notice.detail).toContain("Use the deadline printed on your notice; confirm with the county Board of Equalization.");
    expect(r.deadlines.find((d) => d.date === "2026-11-19")?.detail).toContain("Use the deadline printed on your notice");
    expect(r.deadlines.some((d) => d.label.includes("7%"))).toBe(false);
    expect(r.deadlines.find((d) => d.date === "2027-10-01")?.detail).toContain("ask the county whether a cap applies");
  });

  it("reads the best-soil current use values and the Morgan rate's status from the tables", () => {
    const r = buildTaxReport(input());
    expect([r.rates.cuYear, r.rates.cuCropGood, r.rates.cuTimberGood]).toEqual([2025, 532, 827]);
    expect(r.rates.millageNote).toContain("Morgan 37.4 mills from the state's table, not yet checked against a bill.");
    const verified = buildTaxReport(input({ millage: MILLS.map((m) => (m.county === "Morgan" ? { ...m, verified: true } : m)) }));
    expect(verified.rates.millageNote).toContain("Morgan 37.4 mills from the state's table, verified against the Morgan bills.");
  });

  it("writes an acreage finding as a sentence with only the figures on file", () => {
    const base = input();
    const r = buildTaxReport(input({ parcels: base.parcels.map((p) => (p.id === "p2" ? { ...p, acres: 40 } : p)) }));
    const f = r.findings.find((x) => x.kind === "acreage" && x.parcelId === "p2")!;
    expect(f.detail).toBe("The county record shows 10.8 acres and the map measures 40.0 acres.");
    expect(f.detail).not.toContain("?");
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
  const ctx = {
    entityName: "Albemarle Corporation",
    today: new Date("2026-11-09T12:00:00"),
    cuValues: CU,
    state: "AL",
    propertyEntity: new Map<string, string | null>([["A", "e1"], ["B", "e2"]]),
  };

  // p2's acres as the deed, the county, and the map have them.
  const acresCase = (deeded: number | null, map: number | null) => {
    const base = input();
    return buildTaxReport(input({ parcels: base.parcels.map((p) => (p.id === "p2" ? { ...p, deeded_acres: deeded, acres: map } : p)) }));
  };

  it("makes acreage a ground only when the county counts more acres than the deed (or the map, with no deed)", () => {
    // County 10.8 acres against a 40-acre deed: the finding exists, but
    // telling the Board the owner holds more acres than are taxed is not
    // a reason the value is too high.
    const fewer = acresCase(40, 10.8);
    expect(fewer.findings.some((f) => f.kind === "acreage" && f.parcelId === "p2")).toBe(true);
    const pkFewer = buildProtestPacket(fewer, "p2", ctx)!;
    expect(pkFewer.grounds.some((g) => g.heading === "Acreage")).toBe(false);
    expect(pkFewer.letter.join("\n")).not.toMatch(/acre/i);
    // No deed figure, map larger than the county: still not a ground.
    expect(buildProtestPacket(acresCase(null, 40), "p2", ctx)!.grounds.some((g) => g.heading === "Acreage")).toBe(false);

    const over = buildProtestPacket(acresCase(5, 10.8), "p2", ctx)!;
    const ground = over.grounds.find((g) => g.heading === "Acreage")!;
    expect(ground.forWhom).toBe("board");
    expect(ground.text).toBe("The county record counts 10.8 acres for this parcel; the deed gives 5.0 acres.");
    expect(over.letter.some((l) => l === `1. Acreage: ${ground.text}`)).toBe(true);
    const overMap = buildProtestPacket(acresCase(null, 5), "p2", ctx)!;
    expect(overMap.grounds.find((g) => g.heading === "Acreage")?.text).toBe(
      "The county record counts 10.8 acres for this parcel; the owner's map of the parcel measures 5.0 acres (no deed figure is on file)."
    );
    for (const pk of [pkFewer, over, overMap]) expect(JSON.stringify(pk)).not.toContain("?");
  });

  it("calls a tax increase what it is and keeps it out of the letter", () => {
    const pk = buildProtestPacket(buildTaxReport(input()), "p2", ctx)!;
    expect(pk.grounds.some((g) => g.heading === "Value increase")).toBe(false);
    const g = pk.grounds.find((x) => x.heading === "Tax increase")!;
    expect(g.forWhom).toBe("background");
    expect(g.text).toContain("$200.00 in 2024, $264.60 in 2025");
    expect(pk.letter.join("\n")).not.toContain("Tax increase");
    expect(pk.letter.some((l) => l.startsWith("Reasons: ___"))).toBe(true);
  });

  it("compares only with the same entity's parcels, even when the report covers every entity", () => {
    const base = input();
    const r = buildTaxReport(
      input({
        properties: [...base.properties, { id: "B", name: "Blue", entity_id: "e2" }],
        parcels: [...base.parcels, { id: "other", parcel_number: "08 08 08", county: "Lawrence", property_id: "B", acres: 12, deeded_acres: null, attributes: { ...lawrenceMarket, CALC_ACRE: 12 } }],
      })
    );
    expect(r.parcels.some((p) => p.id === "other" && p.landPerAcre !== null)).toBe(true);
    expect(buildProtestPacket(r, "p2", ctx)!.comparables.map((c) => c.parcelNumber)).toEqual(["06 05 22"]);
    expect(buildProtestPacket(r, "other", ctx)!.comparables).toEqual([]);
  });

  it("says so when the 30-day window has closed, instead of reverting to generic text", () => {
    const r = buildTaxReport(input({ notices: [{ county: "Lawrence", tax_year: 2026, notice_date: "2026-09-01", parcel_id: null }] }));
    const pk = buildProtestPacket(r, "p2", ctx)!;
    expect(pk.deadline).toBeNull();
    expect(pk.windowClosed).toEqual({ noticeDate: "2026-09-01", closedOn: "2026-10-01" });
    expect(pk.checklist[0]).toContain("The window for the notice dated Sep 1, 2026 closed on Oct 1, 2026.");
    // A notice from years back is not brought up.
    const old = buildTaxReport(input({ notices: [{ county: "Lawrence", tax_year: 2024, notice_date: "2024-06-01", parcel_id: null }] }));
    expect(buildProtestPacket(old, "p2", ctx)!.windowClosed).toBeNull();
  });

  it("takes the valuation year from the notice and says when the county record on file is older", () => {
    const when = { today: new Date("2027-05-20T12:00:00") };
    const r = buildTaxReport(input({ ...when, notices: [{ county: "Lawrence", tax_year: 2027, notice_date: "2027-05-10", parcel_id: null }] }));
    const pk = buildProtestPacket(r, "p2", { ...ctx, ...when })!;
    // The county record on file says 2026 (TaxYearDue).
    expect(pk.valuationYear).toBe(2027);
    expect(pk.letter[1]).toBe("Re: Parcel 07 03 08, 2027 valuation, notice dated May 10, 2027");
    expect(pk.recordNote).toContain("The county record on file is for 2026, older than the 2027 notice");
    expect(pk.checklist.some((c) => c.includes("older than the 2027 notice"))).toBe(true);
    expect(pk.facts.some(([k]) => k === "2026 tax (county record)")).toBe(true);
    // Same year: nothing to add.
    const same = buildTaxReport(input({ notices: [{ county: "Lawrence", tax_year: 2026, notice_date: "2026-10-20", parcel_id: null }] }));
    expect(buildProtestPacket(same, "p2", ctx)!.recordNote).toBeNull();
  });

  it("hedges the deadline, sends current use to the assessor, and warns that a court appeal has filing requirements", () => {
    const r = buildTaxReport(input({ notices: [{ county: "Lawrence", tax_year: 2026, notice_date: "2026-10-20", parcel_id: null }] }));
    const pk = buildProtestPacket(r, "p2", ctx)!;
    expect(pk.checklist[0]).toContain("Use the deadline printed on your notice; confirm with the county Board of Equalization.");
    const cu = pk.grounds.find((g) => g.heading === "Current use classification")!;
    expect(cu.text).toContain("It is not decided by a protest: a protest to the Board of Equalization is about market value.");
    expect(cu.text).not.toContain("a protest can ask the Board");
    expect(pk.checklist.some((c) => c.includes("last business day of December"))).toBe(true);
    const appeal = pk.checklist.find((c) => c.includes("circuit court"))!;
    expect(appeal).toContain("written notice and a bond");
    expect(appeal).toContain("attorney");
    expect(pk.disclaimer).toBe("This is a worksheet to help you prepare, not legal or tax advice. Confirm deadlines and figures with the county.");
  });

  it("labels a taxable value worked back from the assessed value as estimated, and rounds timber acres", () => {
    const base = input();
    const r = buildTaxReport(input({ parcels: base.parcels.map((p) => (p.id === "p3" ? { ...p, county: "Morgan", attributes: { AssdValue: 4020, CalcAcres: 84.8, TimberAcreage: 5.4321 } } : p)) }));
    const pk = buildProtestPacket(r, "p3", ctx)!;
    expect(pk.facts.find(([k]) => k === "Taxable value (estimated)")?.[1]).toBe("$40,200");
    expect(pk.facts.find(([k]) => k === "Timber acres (county)")?.[1]).toBe("5.4");
  });

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
    // Dates read "Oct 20, 2026" in the letter and checklist (they used to
    // print as 2026-10-20).
    expect(pk.letter[1]).toContain("notice dated Oct 20, 2026");
    expect(pk.checklist[0]).toContain("by Nov 19, 2026");
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
