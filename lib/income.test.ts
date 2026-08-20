import { describe, expect, it } from "vitest";
import {
  UNASSIGNED,
  allocateToProperties,
  projectedLeaseYears,
  summarizeByYear,
  type IncomeInputs,
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
  taxPayments: [],
  parcels: [],
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
  const lease = (sharePct: number) => ({
    ...emptyInputs(),
    leases: [{ id: "L", status: "active", lease_type: "agricultural", rent_structure: "crop_share" as const, start_date: `${year - 1}-01-01`, end_date: `${year + 2}-12-31`, terms: { landowner_share_pct: 25, gov_payment_share_pct: sharePct }, payment_schedule: [] } as never],
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
});
