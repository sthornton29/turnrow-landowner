import { describe, expect, it } from "vitest";
import {
  UNASSIGNED,
  allocateToProperties,
  entityOfUnassignedKey,
  entityUnassignedKey,
  recordIncomeType,
  emptyTotals,
  leaseYearRows,
  outstandingTotal,
  projectedLeaseYears,
  summarizeByYear,
  sumPropertyScope,
  type IncomeInputs,
  govShareByYearForLease,
} from "./income";

const emptyInputs = (): IncomeInputs => ({
  leases: [],
  assumptions: [],
  leaseLands: [],
  expected: [],
  payments: [],
  settlements: [],
  saleStands: [],
  stands: [],
  taxStatements: [],
  taxLines: [],
  taxPayments: [],
  parcels: [],
});

describe("property taxes by statement lines", () => {
  it("routes each line's tax to its parcel's property and splits a payment by line share", () => {
    const inputs: IncomeInputs = {
      ...emptyInputs(),
      parcels: [
        { id: "pa", property_id: "propA" },
        { id: "pb", property_id: "propB" },
      ],
      taxStatements: [{ id: "s1", tax_year: 2024, amount_due: 1000, entity_id: null }],
      taxLines: [
        { id: "l1", tax_statement_id: "s1", tax_year: 2024, tax_due: 750, parcel_id: "pa", line_type: "real_property" },
        { id: "l2", tax_statement_id: "s1", tax_year: 2024, tax_due: 250, parcel_id: "pb", line_type: "real_property" },
      ],
      taxPayments: [{ tax_statement_id: "s1", paid_date: "2024-12-15", amount: 400 }],
    };
    const by = allocateToProperties(inputs, 2024);
    expect(by.get("propA")?.taxesDue).toBe(750);
    expect(by.get("propB")?.taxesDue).toBe(250);
    expect(by.get("propA")?.taxesPaid).toBe(300);
    expect(by.get("propB")?.taxesPaid).toBe(100);
    expect(by.get(UNASSIGNED)).toBeUndefined();
    expect(summarizeByYear(inputs).get(2024)?.taxesDue).toBe(1000);
  });
  it("sends personal property, unmatched lines, and a line gap to Unassigned", () => {
    const inputs: IncomeInputs = {
      ...emptyInputs(),
      parcels: [{ id: "pa", property_id: "propA" }],
      taxStatements: [{ id: "s1", tax_year: 2024, amount_due: 500, entity_id: null }],
      taxLines: [
        { id: "l1", tax_statement_id: "s1", tax_year: 2024, tax_due: 200, parcel_id: "pa", line_type: "real_property" },
        { id: "l2", tax_statement_id: "s1", tax_year: 2024, tax_due: 100, parcel_id: null, line_type: "personal_property" },
        { id: "l3", tax_statement_id: "s1", tax_year: 2024, tax_due: 150, parcel_id: null, line_type: "real_property" },
      ],
    };
    const by = allocateToProperties(inputs, 2024);
    expect(by.get("propA")?.taxesDue).toBe(200);
    expect(by.get(UNASSIGNED)?.taxesDue).toBe(300); // 100 + 150 + the 50 gap
  });
});

// A 500-acre crop share lease at 25%: 100 ac corn x 180 bu x $4.50
// projects 100*180*4.5*0.25 = $20,250 for 2026.
const cropShareInputs = (): IncomeInputs => ({
  ...emptyInputs(),
  leases: [
    {
      id: "lease1",
      status: "active",
      lease_type: "agricultural",
      rent_structure: "crop_share",
      terms: { landowner_share_pct: 25 },
      payment_schedule: [],
      start_date: "2026-01-01",
      end_date: "2027-12-31",
    },
  ],
  assumptions: [
    {
      lease_id: "lease1",
      year: 2026,
      data: { crops: [{ crop: "Corn", acres: 100, expected_yield: 180, expected_price: 4.5 }] },
    },
  ],
  leaseLands: [
    { lease_id: "lease1", property_id: "propA", leased_acres: 300 },
    { lease_id: "lease1", property_id: "propB", leased_acres: 200 },
  ],
});

describe("projectedLeaseYears", () => {
  it("projects rent from terms and assumptions with no generated payments", () => {
    const projected = projectedLeaseYears(cropShareInputs());
    expect(projected.get("lease1")?.get(2026)).toBe(20250);
    expect(projected.get("lease1")?.has(2027)).toBe(false); // no 2027 assumptions yet
  });

  // Was "stops projecting expired and terminated leases": marking a lease
  // expired or terminated used to erase its expected rent from every year,
  // past years included. History must not change when the status does.
  it("expired and terminated leases keep the expected rent of their term", () => {
    const active = cropShareInputs();
    for (const status of ["expired", "terminated"]) {
      const inputs = cropShareInputs();
      inputs.leases[0].status = status;
      expect(projectedLeaseYears(inputs)).toEqual(projectedLeaseYears(active));
      expect(summarizeByYear(inputs).get(2026)?.expected.agricultural).toBe(20250);
      expect(leaseYearRows(inputs, 2026)).toEqual(leaseYearRows(active, 2026));
      expect(allocateToProperties(inputs, 2026).get("propA")?.expected).toBeCloseTo(20250 * 0.6, 2);
    }
  });

  it("projects a cash lease from rate x acres with no assumptions at all", () => {
    const inputs: IncomeInputs = {
      ...emptyInputs(),
      leases: [
        {
          id: "cash1",
          status: "draft",
          lease_type: "agricultural",
          rent_structure: "cash",
          terms: { cash_basis: "per_acre", rate_per_acre: 100 },
          payment_schedule: [],
          start_date: "2026-01-01",
          end_date: "2026-12-31",
        },
      ],
      leaseLands: [{ lease_id: "cash1", property_id: "propA", leased_acres: 500 }],
    };
    expect(projectedLeaseYears(inputs).get("cash1")?.get(2026)).toBe(50000);
  });
});

// A hunting lease running July 1 to June 30 at $10,000 a year, paid each
// July 1. It used to show $10,000 in 2026 AND in 2027 (the second "due"
// the day after the lease ended).
const huntingInputs = (over: Record<string, unknown> = {}): IncomeInputs => ({
  ...emptyInputs(),
  leases: [
    {
      id: "hunt1",
      status: "active",
      lease_type: "hunting",
      rent_structure: null,
      terms: { hunt_basis: "lump_sum", amount: 10000 },
      payment_schedule: [{ label: "Annual payment", month: 7, day: 1, percent: 100 }],
      start_date: "2026-07-01",
      end_date: "2027-06-30",
      ...over,
    },
  ],
  leaseLands: [{ lease_id: "hunt1", property_id: "propA", leased_acres: 100 }],
});

describe("leases that do not run January to December", () => {
  it("projects one year's rent, in the year it falls due", () => {
    const inputs = huntingInputs();
    const projected = projectedLeaseYears(inputs);
    expect(projected.get("hunt1")?.get(2026)).toBe(10000);
    expect(projected.get("hunt1")?.has(2027)).toBe(false);
    const byYear = summarizeByYear(inputs);
    expect(byYear.get(2026)?.expected.hunting).toBe(10000);
    expect(byYear.get(2027)?.expected.hunting ?? 0).toBe(0);
    expect(allocateToProperties(inputs, 2027).get("propA")).toBeUndefined();
    // Nothing is due in 2027, so the by-lease table has no row for it
    // (and no "Incomplete" flag).
    expect(leaseYearRows(inputs, 2027)).toEqual([]);
    expect(leaseYearRows(inputs, 2026)).toMatchObject([{ leaseId: "hunt1", expected: 10000, projection: true }]);
  });

  it("splits the year's rent by the installments that fall due inside the term", () => {
    const inputs = huntingInputs({
      payment_schedule: [
        { label: "Spring", month: 3, day: 1, percent: 50 },
        { label: "Fall", month: 9, day: 1, percent: 50 },
      ],
    });
    const projected = projectedLeaseYears(inputs).get("hunt1")!;
    expect(projected.get(2026)).toBe(5000); // September 1, 2026
    expect(projected.get(2027)).toBe(5000); // March 1, 2027
  });

  it("a February to December lease (the live shape) projects exactly as before", () => {
    const inputs: IncomeInputs = {
      ...emptyInputs(),
      leases: [
        {
          id: "cash1",
          status: "active",
          lease_type: "agricultural",
          rent_structure: "cash",
          terms: { cash_basis: "per_acre", rate_per_acre: 100 },
          payment_schedule: [],
          start_date: "2026-02-01",
          end_date: "2026-12-31",
        },
      ],
      leaseLands: [{ lease_id: "cash1", property_id: "propA", leased_acres: 500 }],
    };
    expect(projectedLeaseYears(inputs)).toEqual(new Map([["cash1", new Map([[2026, 50000]])]]));
    expect(summarizeByYear(inputs).get(2026)?.expected.agricultural).toBe(50000);
  });
});

describe("expired and terminated leases", () => {
  // $10,000 a year in two halves (March 1 and December 1), 2025 through 2027.
  const cashInputs = (status: string, endDate: string): IncomeInputs => ({
    ...emptyInputs(),
    leases: [
      {
        id: "cash1",
        status,
        lease_type: "agricultural",
        rent_structure: "cash",
        terms: { cash_basis: "lump_sum", lump_sum: 10000 },
        payment_schedule: [
          { label: "First half", month: 3, day: 1, percent: 50 },
          { label: "Second half", month: 12, day: 1, percent: 50 },
        ],
        start_date: "2025-01-01",
        end_date: endDate,
      },
    ],
    leaseLands: [{ lease_id: "cash1", property_id: "propA", leased_acres: 100 }],
  });

  it("nothing is projected after the end date", () => {
    // Terminated with the end date set to June 30, 2026: 2025 keeps its
    // full year, 2026 keeps the March half, and 2027 is gone.
    const projected = projectedLeaseYears(cashInputs("terminated", "2026-06-30")).get("cash1")!;
    expect(projected.get(2025)).toBe(10000);
    expect(projected.get(2026)).toBe(5000);
    expect(projected.has(2027)).toBe(false);
  });

  it("generated rows for years after the lease ended stop counting unless money was recorded against them", () => {
    const withRows = (status: string) => {
      const inputs = cashInputs(status, "2026-06-30");
      inputs.expected = [
        { id: "e1", lease_id: "cash1", timber_sale_id: null, year: 2026, expected_amount: 5000, label: "First half", due_date: "2026-03-01" },
        { id: "e2", lease_id: "cash1", timber_sale_id: null, year: 2026, expected_amount: 5000, label: "Second half", due_date: "2026-12-01" },
        { id: "e3", lease_id: "cash1", timber_sale_id: null, year: 2027, expected_amount: 5000, label: "First half", due_date: "2027-03-01" },
        { id: "e4", lease_id: "cash1", timber_sale_id: null, year: 2027, expected_amount: 5000, label: "Second half", due_date: "2027-12-01" },
      ];
      // The tenant did pay the March 2027 installment.
      inputs.payments = [
        { lease_id: "cash1", timber_sale_id: null, amount: 5000, received_date: "2027-03-02", expected_payment_id: "e3" },
      ];
      return inputs;
    };
    for (const status of ["expired", "terminated"]) {
      const byYear = summarizeByYear(withRows(status));
      // The lease ended June 30, 2026. Both 2026 rows belong to its last
      // year and still count, the December one included: the lease YEAR
      // decides, not the due date.
      expect(byYear.get(2026)?.expected.agricultural).toBe(10000);
      expect(byYear.get(2027)?.expected.agricultural).toBe(5000); // e3: paid, so it still counts; e4 lapsed
      expect(byYear.get(2026)?.hasProjection).toBe(false); // the schedule still stands in for 2026
      expect(leaseYearRows(withRows(status), 2026)).toMatchObject([{ expected: 10000, projection: false }]);
    }
    // The same rows on a lease that is still active all count.
    const active = summarizeByYear(withRows("active"));
    expect(active.get(2026)?.expected.agricultural).toBe(10000);
    expect(active.get(2027)?.expected.agricultural).toBe(10000);
  });

  it("a crop share lease's final settlement, due the summer after it ended, still counts once the lease is marked expired", () => {
    // The real shape of the family's lease: February to December 2026,
    // most of the rent at harvest and the rest at final prices in July
    // 2027. Both rows are 2026 rent.
    const inputs = cashInputs("expired", "2026-12-31");
    inputs.leases[0].start_date = "2026-02-01";
    inputs.expected = [
      { id: "p", lease_id: "cash1", timber_sale_id: null, year: 2026, expected_amount: 283887.53, label: "Provisional crop-share rent", due_date: "2026-12-10" },
      { id: "f", lease_id: "cash1", timber_sale_id: null, year: 2026, expected_amount: 94629.18, label: "Final crop-share rent at final prices", due_date: "2027-07-01" },
    ];
    inputs.payments = [];
    const byYear = summarizeByYear(inputs);
    expect(byYear.get(2026)?.expected.agricultural).toBeCloseTo(378516.71, 2);
    // And marking it expired changed nothing: active reads the same.
    const stillActive = cashInputs("active", "2026-12-31");
    stillActive.leases[0].start_date = "2026-02-01";
    stillActive.expected = inputs.expected;
    stillActive.payments = [];
    expect(summarizeByYear(stillActive).get(2026)?.expected.agricultural).toBeCloseTo(378516.71, 2);
  });
});

describe("summarizeByYear with projections", () => {
  it("shows projected rent as expected income, flagged as projection", () => {
    const byYear = summarizeByYear(cropShareInputs());
    const totals = byYear.get(2026)!;
    expect(totals.expected.agricultural).toBe(20250);
    expect(totals.hasProjection).toBe(true);
  });

  it("generated expected payments replace the projection for that lease-year", () => {
    const inputs = cropShareInputs();
    inputs.expected = [
      { id: "e1", lease_id: "lease1", timber_sale_id: null, year: 2026, expected_amount: 10000 },
      { id: "e2", lease_id: "lease1", timber_sale_id: null, year: 2026, expected_amount: 10000 },
    ];
    const totals = summarizeByYear(inputs).get(2026)!;
    // The schedule's $20,000, not schedule + projection.
    expect(totals.expected.agricultural).toBe(20000);
    expect(totals.hasProjection).toBe(false);
  });

  it("timber sale expected rows pass through untouched", () => {
    const inputs = emptyInputs();
    inputs.expected = [
      { id: "t1", lease_id: null, timber_sale_id: "sale1", year: 2026, expected_amount: 75000 },
    ];
    const totals = summarizeByYear(inputs).get(2026)!;
    expect(totals.expected.timber).toBe(75000);
    expect(totals.hasProjection).toBe(false);
  });
});

describe("allocateToProperties with projections", () => {
  it("spreads projected rent across properties by leased acres", () => {
    const byProperty = allocateToProperties(cropShareInputs(), 2026);
    expect(byProperty.get("propA")?.expected).toBeCloseTo(20250 * 0.6, 2);
    expect(byProperty.get("propB")?.expected).toBeCloseTo(20250 * 0.4, 2);
    expect(byProperty.get(UNASSIGNED)).toBeUndefined();
  });
});

// Entity filtering rides on sumPropertyScope: the by-type table, chart,
// and tax rows recompute by summing property allocations over the
// selected entities' properties. These fixtures put propA and propB in
// different entities (the split is by leased acres, so a lease that
// straddles entities pro-rates rather than double-counting).
describe("sumPropertyScope (multi-entity recompute)", () => {
  const multiEntityInputs = (): IncomeInputs => {
    const inputs = cropShareInputs(); // lease across propA (60%) + propB (40%)
    inputs.payments = [
      { id: "pay1", lease_id: "lease1", timber_sale_id: null, expected_payment_id: null, received_date: "2026-11-01", amount: 5000 },
    ] as never;
    inputs.settlements = [
      { id: "set1", timber_sale_id: "sale1", settlement_date: "2026-06-01", total_amount: 9000 },
    ] as never;
    // sale1's stands sit on propA only.
    inputs.saleStands = [{ timber_sale_id: "sale1", timber_stand_id: "st1" }] as never;
    inputs.stands = [{ id: "st1", property_id: "propA", acres: 40 }] as never;
    inputs.parcels = [
      { id: "pa", property_id: "propA" },
      { id: "pb", property_id: "propB" },
    ];
    inputs.taxStatements = [{ id: "s1", tax_year: 2026, amount_due: 1000, entity_id: null }] as never;
    inputs.taxLines = [
      { id: "l1", tax_statement_id: "s1", tax_year: 2026, tax_due: 700, parcel_id: "pa", line_type: "real_property" },
      { id: "l2", tax_statement_id: "s1", tax_year: 2026, tax_due: 300, parcel_id: "pb", line_type: "real_property" },
    ] as never;
    return inputs;
  };

  it("carries per-type splits on each property", () => {
    const by = allocateToProperties(multiEntityInputs(), 2026);
    expect(by.get("propA")?.expectedByType.agricultural).toBeCloseTo(20250 * 0.6, 2);
    expect(by.get("propA")?.receivedByType.timber).toBe(9000);
    expect(by.get("propA")?.receivedByType.agricultural).toBeCloseTo(5000 * 0.6, 2);
    expect(by.get("propB")?.receivedByType.agricultural).toBeCloseTo(5000 * 0.4, 2);
    expect(by.get("propB")?.receivedByType.timber).toBe(0);
  });

  it("scope null reconciles exactly with summarizeByYear", () => {
    const inputs = multiEntityInputs();
    const all = sumPropertyScope(allocateToProperties(inputs, 2026), null);
    const totals = summarizeByYear(inputs).get(2026)!;
    for (const type of ["agricultural", "hunting", "timber", "government"] as const) {
      expect(all.expected[type]).toBeCloseTo(totals.expected[type], 6);
      expect(all.received[type]).toBeCloseTo(totals.received[type], 6);
    }
    expect(all.taxesDue).toBeCloseTo(totals.taxesDue, 6);
    expect(all.taxesPaid).toBeCloseTo(totals.taxesPaid, 6);
    expect(all.hasProjection).toBe(totals.hasProjection);
  });

  it("entity scopes recompute and their parts sum back to the whole", () => {
    const inputs = multiEntityInputs();
    const by = allocateToProperties(inputs, 2026);
    const entityA = sumPropertyScope(by, new Set(["propA"]));
    const entityB = sumPropertyScope(by, new Set(["propB"]));
    const all = sumPropertyScope(by, null);

    // The numbers actually CHANGE with the selection (the bug fixed).
    expect(entityA.received.timber).toBe(9000);
    expect(entityB.received.timber).toBe(0);
    expect(entityA.taxesDue).toBe(700);
    expect(entityB.taxesDue).toBe(300);
    expect(entityA.expected.agricultural).toBeCloseTo(20250 * 0.6, 2);

    // And reconcile: A + B (+ nothing Unassigned here) = the whole.
    for (const type of ["agricultural", "hunting", "timber", "government"] as const) {
      expect(entityA.expected[type] + entityB.expected[type]).toBeCloseTo(all.expected[type], 6);
      expect(entityA.received[type] + entityB.received[type]).toBeCloseTo(all.received[type], 6);
    }
    expect(entityA.taxesDue + entityB.taxesDue).toBeCloseTo(all.taxesDue, 6);
  });
});

// Government payments: the landowner's share of projected ARC/PLC on
// leased base acres, attributed to the PAYMENT year (program year Y pays
// in Y+1). A 0% share keeps totals untouched but still reports the
// informational figure.
import { govShareRows, informationalGovPayments } from "./income";

describe("government payment share", () => {
  const year = new Date().getFullYear();
  const govInputs = () => ({
    farms: [{ id: "f1", farm_number: "100", state: "AL", county: "Lawrence" }],
    links: [{ fsa_farm_id: "f1", property_id: "p1", allocation_pct: 100 }],
    baseAcres: [{ fsa_farm_id: "f1", commodity: "corn", base_acres: 100, plc_yield: 150 }],
    elections: [],
    commodities: [{ slug: "corn", name: "Corn", unit: "bushel" as const, statutory_reference_price: 4.1, national_loan_rate: 2.42, marketing_year_start_month: 9 }],
    priceData: [{ commodity: "corn", program_year: year - 1, effective_reference_price: 4.42, mya_price_estimate: 4.1, mya_price_final: null, wasde_midpoint: null, source: "estimate" }],
    configs: [],
    benchmarks: [],
  });
  const lease = (sharePct: number, extraTerms: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
    ...emptyInputs(),
    leases: [{ id: "L", status: "active", lease_type: "agricultural", rent_structure: "crop_share" as const, start_date: `${year - 1}-01-01`, end_date: `${year + 2}-12-31`, terms: { landowner_share_pct: 25, gov_payment_share_pct: sharePct, ...extraTerms }, payment_schedule: [] } as never],
    ...extra,
    leaseLands: [{ lease_id: "L", property_id: "p1", leased_acres: 50 }],
    propertyAcres: [{ id: "p1", acres: 100 }],
    gov: govInputs(),
  });

  it("0% share: nothing in totals, informational figure still reported", () => {
    const inputs = lease(0);
    const totals = summarizeByYear(inputs).get(year);
    expect(totals?.expected.government ?? 0).toBe(0);
    const info = informationalGovPayments(inputs, year);
    // PLC corn 100 ac x 150 x 0.32 = 4800 gross => 3859.68 net for the program year paying this year
    expect(info.total).toBe(3859.68);
    expect(info.landownerTotal).toBe(0);
  });

  it("a 50% share on half the property flows half of half into the payment year", () => {
    const inputs = lease(50);
    const rows = govShareRows(inputs, year);
    expect(rows).toHaveLength(1);
    expect(rows[0].tenantAmount).toBe(1929.84); // 50 of 100 acres
    expect(rows[0].landownerAmount).toBe(964.92);
    expect(summarizeByYear(inputs).get(year)?.expected.government).toBe(964.92);
    expect(allocateToProperties(inputs, year).get("p1")?.expected).toBe(964.92);
    // Nothing lands in the program year itself (it pays the following year).
    expect(govShareRows(inputs, year - 1)).toHaveLength(0);
  });

  it("tenant retains all: the share is zero even if an old percent lingers", () => {
    const inputs = lease(50, { gov_payment_treatment: "tenant_retains" });
    const rows = govShareRows(inputs, year);
    expect(rows[0].landownerAmount).toBe(0);
    expect(rows[0].treatment).toBe("tenant_retains");
    expect(summarizeByYear(inputs).get(year)?.expected.government ?? 0).toBe(0);
  });

  it("FSA direct: projected as government income, tagged so matchers skip it", () => {
    const inputs = lease(50, { gov_payment_treatment: "landowner_share", gov_payment_received_via: "fsa_direct" });
    const rows = govShareRows(inputs, year);
    expect(rows[0].receivedVia).toBe("fsa_direct");
    expect(rows[0].generated).toBe(false);
    expect(summarizeByYear(inputs).get(year)?.expected.government).toBe(964.92);
    expect(govShareByYearForLease(inputs, "L").get(year - 1)).toBe(964.92);
  });

  it("tenant remits with a generated row: the row counts once, projection steps aside", () => {
    const inputs = lease(
      50,
      { gov_payment_treatment: "landowner_share", gov_payment_received_via: "tenant_remits" },
      {
        expected: [
          { id: "g1", lease_id: "L", timber_sale_id: null, year, expected_amount: 964.92, label: `Government payment share (program year ${year - 1})` },
        ],
        payments: [{ lease_id: "L", timber_sale_id: null, amount: 964.92, received_date: `${year}-10-05`, expected_payment_id: "g1" }],
      }
    );
    expect(govShareRows(inputs, year)[0].generated).toBe(true);
    const totals = summarizeByYear(inputs).get(year)!;
    expect(totals.expected.government).toBe(964.92);
    expect(totals.received.government).toBe(964.92);
    expect(totals.received.agricultural).toBe(0);
    expect(allocateToProperties(inputs, year).get("p1")?.expected).toBe(964.92);
  });

  it("the by-type and by-property tables use one year rule for the projected share", () => {
    // Price data for the program year that pays two years out: the
    // by-property table used to count that share while the by-type table
    // (which projects the share for last year, this year, and next) did not.
    const inputs = lease(50);
    inputs.gov.priceData.push({ commodity: "corn", program_year: year + 1, effective_reference_price: 4.42, mya_price_estimate: 4.1, mya_price_final: null, wasde_midpoint: null, source: "estimate" });
    expect(govShareRows(inputs, year + 2)[0]?.landownerAmount).toBe(964.92); // the share itself exists
    const byYear = summarizeByYear(inputs);
    for (const y of [year - 1, year, year + 1, year + 2]) {
      const byType = byYear.get(y)?.expected.government ?? 0;
      const byProperty = sumPropertyScope(allocateToProperties(inputs, y), null).expected.government;
      expect(byProperty, `government share for ${y}`).toBeCloseTo(byType, 6);
    }
  });
});

describe("income records (history and income outside a lease)", () => {
  const inputs = (): IncomeInputs => ({
    ...emptyInputs(),
    records: [
      { year: 2015, income_type: "farmland_cash_rent", amount: 439117.2, property_id: null, entity_id: "alb" },
      { year: 2015, income_type: "share_rent", amount: 28393, property_id: "jm", entity_id: "jmllc" },
      { year: 2021, income_type: "solar", amount: 14348.01, property_id: "betts", entity_id: "trusts" },
      { year: 2021, income_type: "tower", amount: 15000, property_id: null, entity_id: "trusts" },
      { year: 2021, income_type: "other", amount: 4085.4, property_id: null, entity_id: null },
    ],
  });

  it("maps record types to income buckets", () => {
    expect(["farmland_cash_rent", "share_rent", "timber", "hunting", "solar", "tower", "commercial_rent", "other"].map(recordIncomeType)).toEqual([
      "agricultural", "agricultural", "timber", "hunting", "other", "other", "other", "other",
    ]);
  });

  it("counts records as received income in their year", () => {
    const y = summarizeByYear(inputs());
    expect(y.get(2015)!.received.agricultural).toBeCloseTo(467510.2, 2);
    expect(y.get(2021)!.received.other).toBeCloseTo(33433.41, 2);
    expect(y.get(2021)!.expected.other).toBe(0);
  });

  it("routes a record to its property, else to its entity's own bucket, else to Unassigned", () => {
    const by = allocateToProperties(inputs(), 2021);
    expect(by.get("betts")!.receivedByType.other).toBeCloseTo(14348.01, 2);
    expect(by.get(entityUnassignedKey("trusts"))!.received).toBe(15000);
    expect(by.get(UNASSIGNED)!.received).toBeCloseTo(4085.4, 2);
    expect(entityOfUnassignedKey(entityUnassignedKey("trusts"))).toBe("trusts");
    expect(entityOfUnassignedKey(UNASSIGNED)).toBeNull();
    expect(entityOfUnassignedKey("betts")).toBeNull();
  });

  it("counts only records marked Received as received; owed and calculated ones are reported apart", () => {
    const i = inputs();
    i.records!.push(
      { year: 2021, income_type: "share_rent", amount: 5000, property_id: "betts", entity_id: "trusts", basis: "accrued" },
      { year: 2021, income_type: "solar", amount: 700, property_id: null, entity_id: "trusts", basis: "calculated" },
      { year: 2021, income_type: "solar", amount: 100, property_id: "betts", entity_id: "trusts", basis: "received" }
    );
    const y = summarizeByYear(i).get(2021)!;
    expect(y.received.agricultural).toBe(0); // the $5,000 is owed, not received
    expect(y.received.other).toBeCloseTo(33433.41 + 100, 2);
    expect(y.unconfirmed).toBeCloseTo(5700, 2);
    const by = allocateToProperties(i, 2021);
    expect(by.get("betts")!.received).toBeCloseTo(14348.01 + 100, 2);
    expect(by.get("betts")!.unconfirmed).toBe(5000);
    expect(by.get(entityUnassignedKey("trusts"))!.received).toBe(15000);
    expect(by.get(entityUnassignedKey("trusts"))!.unconfirmed).toBe(700);
    expect(sumPropertyScope(by, null).unconfirmed).toBeCloseTo(5700, 2);
    expect(sumPropertyScope(by, new Set(["betts"])).unconfirmed).toBe(5000);
    // Records loaded without a basis (older callers) still count as received.
    expect(summarizeByYear(inputs()).get(2021)!.unconfirmed).toBe(0);
  });

  it("keeps an entity's property-less records inside that entity's scope", () => {
    const by = allocateToProperties(inputs(), 2015);
    const alb = sumPropertyScope(by, new Set([entityUnassignedKey("alb")]));
    expect(alb.received.agricultural).toBeCloseTo(439117.2, 2);
    const all = sumPropertyScope(by, null);
    expect(all.received.agricultural).toBeCloseTo(summarizeByYear(inputs()).get(2015)!.received.agricultural, 2);
  });
});

describe("outstanding on a total row", () => {
  it("adds up what each line is still owed; money beyond one line's expected never pays down another", () => {
    // Agricultural leases: expected $100,000, received $60,000. Solar
    // records: $45,000 received, nothing expected. Netting the totals
    // (100,000 - 105,000) said $0.00 outstanding.
    const totals = emptyTotals();
    totals.expected.agricultural = 100000;
    totals.received.agricultural = 60000;
    totals.received.other = 45000;
    expect(outstandingTotal(totals)).toBe(40000);
    // The same rule for a list of leases: one overpaid, one short.
    expect(
      outstandingTotal([
        { expected: 10000, received: 12000 },
        { expected: 8000, received: 3000 },
        { expected: 5000, received: 5000 },
      ])
    ).toBe(5000);
    expect(outstandingTotal(emptyTotals())).toBe(0);
  });
});

describe("timber sales on stands without boundaries", () => {
  it("routes a sale on an undrawn stand (no acres) to the stand's property", () => {
    const inputs: IncomeInputs = {
      ...emptyInputs(),
      settlements: [{ timber_sale_id: "s", settlement_date: "2021-03-01", total_amount: 29345.3 }],
      saleStands: [{ timber_sale_id: "s", timber_stand_id: "st" }],
      stands: [{ id: "st", property_id: "trinity", acres: null }],
    };
    const by = allocateToProperties(inputs, 2021);
    expect(by.get("trinity")!.received).toBeCloseTo(29345.3, 2);
    expect(by.get(UNASSIGNED)).toBeUndefined();
  });
});

