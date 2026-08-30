import { describe, expect, it } from "vitest";
import {
  UNASSIGNED,
  allocateToProperties,
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

  it("stops projecting expired and terminated leases", () => {
    const inputs = cropShareInputs();
    inputs.leases[0].status = "terminated";
    expect(projectedLeaseYears(inputs).size).toBe(0);
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
});
