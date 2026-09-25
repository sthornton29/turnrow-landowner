import { describe, expect, it } from "vitest";
import { annualRent, type LeaseLike } from "./leaseLogic";
import { explainLeaseYear, structureOf, cropUnit, type ExplainArgs } from "./leaseExplain";

const TODAY = new Date("2026-06-01T00:00:00");

function cropShareLease(): LeaseLike & { status: string } {
  return {
    status: "active",
    lease_type: "agricultural",
    rent_structure: "crop_share",
    terms: { landowner_share_pct: 25, shares_expenses: true },
    payment_schedule: [],
    start_date: "2026-01-01",
    end_date: "2026-12-31",
  };
}

function base(over: Partial<ExplainArgs> = {}): ExplainArgs {
  return {
    lease: cropShareLease(),
    year: 2026,
    lands: [
      { propertyId: "a", propertyName: "Home place", leasedAcres: 300 },
      { propertyId: "b", propertyName: "River", leasedAcres: 200 },
    ],
    assumptions: {
      crops: [
        {
          crop: "Corn",
          practice: "irrigated",
          acres: 100,
          expected_yield: 180,
          expected_price: 4.5,
          expected_shared_expenses: 250,
          sources: {
            acres: { kind: "tenant_actual", as_of: "2026-05-01" },
            expected_yield: { kind: "tenant_projected", as_of: "2026-05-01" },
          },
        },
        { crop: "Cotton", acres: 50, expected_yield: 1000, expected_price: 0.8 },
      ],
    },
    expectedRows: [],
    payments: [],
    gov: [],
    today: TODAY,
    ...over,
  };
}

describe("explainLeaseYear crop share", () => {
  it("shows each crop's arithmetic and matches annualRent to the cent", () => {
    const args = base();
    const x = explainLeaseYear(args);
    expect(x.structure).toBe("crop_share");
    expect(x.basis).toBe("projection");
    const corn = x.cropShare!.crops[0];
    expect(corn.production).toBe(18000); // 100 x 180
    expect(corn.cropValue).toBe(81000); // x 4.50
    expect(corn.yourShare).toBe(20250); // x 25%
    expect(corn.sharedExpenses).toBe(250);
    expect(corn.net).toBe(20000);
    const cotton = x.cropShare!.crops[1];
    expect(cotton.unit).toBe("lb");
    expect(cotton.net).toBeCloseTo(50 * 1000 * 0.8 * 0.25, 6);
    expect(x.cropShare!.subtotal).toBeCloseTo(annualRent(args.lease, 500, args.assumptions)!, 6);
    expect(x.expected).toBeCloseTo(x.projection!, 6);
    expect(x.totalAcres).toBe(500);
  });

  it("carries each value's source and flags hand-entered values", () => {
    const x = explainLeaseYear(base());
    const corn = x.cropShare!.crops[0];
    expect(corn.acres.source?.kind).toBe("tenant_actual");
    expect(corn.expectedYield.source?.kind).toBe("tenant_projected");
    expect(corn.price.source).toBeNull();
    expect(x.sourceKinds.sort()).toEqual(["tenant_actual", "tenant_projected"]);
    expect(x.handEntered).toBe(true);
  });

  it("is incomplete, never understated, when a crop is missing a price", () => {
    const args = base();
    args.assumptions!.crops![1].expected_price = null;
    const x = explainLeaseYear(args);
    expect(x.basis).toBe("incomplete");
    expect(x.expected).toBe(0);
    expect(x.projection).toBeNull();
    expect(x.cropShare!.crops[1].missing).toEqual(["price"]);
    expect(x.missing).toContain("price for Cotton");
    // The complete crop still shows its own arithmetic.
    expect(x.cropShare!.crops[0].net).toBe(20000);
    expect(x.cropShare!.subtotal).toBeNull();
  });
});

describe("explainLeaseYear other structures", () => {
  it("cash per acre: acres x rate", () => {
    const x = explainLeaseYear(
      base({
        lease: {
          ...cropShareLease(),
          rent_structure: "cash",
          terms: { cash_basis: "per_acre", rate_per_acre: 150 },
        },
        assumptions: undefined,
      })
    );
    expect(x.structure).toBe("cash_per_acre");
    expect(x.cash!.rate.value).toBe(150);
    expect(x.cash!.rate.fromTerms).toBe(true);
    expect(x.expected).toBe(75000);
    expect(x.headline).toContain("500.0 acres at $150.00 an acre");
  });

  it("flex: base plus the year's bonus estimate", () => {
    const x = explainLeaseYear(
      base({
        lease: {
          ...cropShareLease(),
          rent_structure: "flex",
          terms: { base_rate_per_acre: 100, bonus_description: "Half of price above $5" },
        },
        assumptions: { bonus_estimate: 1200 },
      })
    );
    expect(x.flex!.baseTotal).toBe(50000);
    expect(x.flex!.bonus.value).toBe(1200);
    expect(x.expected).toBe(51200);
    expect(x.flex!.bonusDescription).toBe("Half of price above $5");
  });

  it("hunting lump sum", () => {
    const x = explainLeaseYear(
      base({
        lease: {
          ...cropShareLease(),
          lease_type: "hunting",
          rent_structure: null,
          terms: { hunt_basis: "lump_sum", amount: 8000 },
        },
        assumptions: undefined,
      })
    );
    expect(x.structure).toBe("hunting_lump_sum");
    expect(x.expected).toBe(8000);
  });

  it("does not project outside the lease dates or once expired", () => {
    expect(explainLeaseYear(base({ year: 2027 })).basis).toBe("none");
    expect(
      explainLeaseYear(base({ lease: { ...cropShareLease(), status: "expired" } })).basis
    ).toBe("none");
  });
});

describe("explainLeaseYear schedule and received", () => {
  it("a generated schedule replaces the projection and tracks each line", () => {
    const x = explainLeaseYear(
      base({
        expectedRows: [
          { id: "r1", label: "Spring", due_date: "2026-03-01", expected_amount: 10000 },
          { id: "r2", label: "Fall", due_date: "2026-11-01", expected_amount: 10000 },
        ],
        payments: [
          { amount: 10000, received_date: "2026-03-03", expected_payment_id: "r1" },
          { amount: 500, received_date: "2026-04-10", expected_payment_id: null, memo: "Late fee" },
        ],
      })
    );
    expect(x.basis).toBe("schedule");
    expect(x.expected).toBe(20000);
    expect(x.projection).toBe(30000); // still computed, shown for comparison
    expect(x.received).toBe(10500);
    expect(x.outstanding).toBe(9500);
    expect(x.schedule.map((s) => s.status)).toEqual(["paid", "upcoming"]);
    expect(x.unscheduledPayments).toEqual([
      { date: "2026-04-10", amount: 500, memo: "Late fee" },
    ]);
  });

  it("counts received by the year the payment was dated, like the Income page", () => {
    const x = explainLeaseYear(
      base({
        payments: [
          { amount: 100, received_date: "2025-12-30", expected_payment_id: null },
          { amount: 200, received_date: "2026-01-02", expected_payment_id: null },
        ],
      })
    );
    expect(x.received).toBe(200);
  });

  it("summarizes the government share for the payment year", () => {
    const x = explainLeaseYear(
      base({
        gov: [
          {
            leaseId: "l", propertyId: "a", paymentYear: 2026, tenantAmount: 4000,
            landownerAmount: 1000, sharePct: 25, treatment: "landowner_share",
            receivedVia: "fsa_direct", generated: false,
          },
          {
            leaseId: "l", propertyId: "b", paymentYear: 2026, tenantAmount: 2000,
            landownerAmount: 500, sharePct: 25, treatment: "landowner_share",
            receivedVia: "fsa_direct", generated: false,
          },
          {
            leaseId: "l", propertyId: "b", paymentYear: 2027, tenantAmount: 9,
            landownerAmount: 9, sharePct: 25, treatment: "landowner_share",
            receivedVia: "fsa_direct", generated: false,
          },
        ],
      })
    );
    expect(x.gov).toEqual({
      sharePct: 25, tenantAmount: 6000, landownerAmount: 1500,
      receivedVia: "fsa_direct", generated: false,
    });
  });
});

describe("helpers", () => {
  it("structureOf and cropUnit", () => {
    expect(structureOf(cropShareLease())).toBe("crop_share");
    expect(cropUnit("Cotton irrigated")).toBe("lb");
    expect(cropUnit("Bermuda hay")).toBe("ton");
    expect(cropUnit("Soybeans")).toBe("bu");
  });
});
