import { describe, expect, it } from "vitest";
import { buildTimberTaxSummary, NO_ENTITY_KEY, type SummaryInput } from "./timberTaxSummary";

const base = (): SummaryInput => ({
  year: 2025,
  entityKey: "E1",
  properties: [
    { id: "P1", name: "Shop Area", entity_id: "E1" },
    { id: "P2", name: "Redd", entity_id: "E2" },
  ],
  entities: [
    { id: "E1", name: "Albemarle", entity_type: "corporation" },
    { id: "E2", name: "VLM", entity_type: "individual" },
  ],
  stands: [
    { id: "S1", property_id: "P1", acres: 100 },
    { id: "S2", property_id: "P2", acres: 100 },
  ],
  saleStands: [{ timber_sale_id: "T1", timber_stand_id: "S1", allocation_pct: null }],
  sales: [{ id: "T1", sale_name: "Summerwood thinning", sale_type: "pay_as_cut", allocation_method: "by_acres", contract_date: "2024-11-01" }],
  settlements: [
    { timber_sale_id: "T1", settlement_date: "2024-12-20", total_amount: 10000, allocation: null },
    { timber_sale_id: "T1", settlement_date: "2025-01-15", total_amount: 29678.84, allocation: null },
  ],
  payments: [],
  costs: [
    { id: "C1", property_id: "P1", paid_date: "2025-02-01", amount: 2000, tax_category: "selling_expense", timber_sale_id: "T1", cost_share_award_id: null, vendor: "Forester", description: "sale fee" },
    { id: "C2", property_id: "P1", paid_date: "2025-03-01", amount: 14000, tax_category: "reforestation", timber_sale_id: null, cost_share_award_id: "A1", vendor: null, description: "seedlings" },
    { id: "C3", property_id: "P1", paid_date: "2025-04-01", amount: 900, tax_category: "operating_expense", timber_sale_id: null, cost_share_award_id: null, vendor: "Burn crew", description: "burn" },
    { id: "C4", property_id: "P1", paid_date: "2025-05-01", amount: 300, tax_category: "not_sure", timber_sale_id: null, cost_share_award_id: null, vendor: null, description: "gate" },
    { id: "C5", property_id: "P2", paid_date: "2025-05-01", amount: 999, tax_category: "operating_expense", timber_sale_id: null, cost_share_award_id: null, vendor: null, description: "other entity" },
  ],
  accounts: [{ id: "AC1", property_id: "P1", acquisition_type: "purchase", acquired_date: "1990-01-01" }],
  entries: [{ account_id: "AC1", entry_date: "2025-01-15", entry_type: "depletion", basis_change: -5000, timber_sale_id: "T1" }],
  awards: [{ id: "A1", property_id: "P1", entity_id: "E1", program: "eqip", title: "EQIP planting" }],
  costSharePayments: [{ award_id: "A1", received_date: "2025-06-01", amount: 3000, sec126_choice: "exclude" }],
});

describe("annual timber tax summary", () => {
  it("counts only this year's proceeds, nets selling costs and depletion", () => {
    const s = buildTimberTaxSummary(base());
    expect(s.sales).toHaveLength(1);
    expect(s.sales[0]).toMatchObject({ proceeds: 29678.84, sellingExpenses: 2000, depletion: 5000, gain: 22678.84, holding: "long" });
    expect(s.formT).toBe(true);
  });

  it("nets excluded cost-share out of the replanting deduction", () => {
    const s = buildTimberTaxSummary(base());
    // 14,000 - 3,000 excluded = 11,000: 10,000 expensed + 1,000/14 amortized
    expect(s.reforestation[0]).toMatchObject({ paidThisYear: 14000, costShareExcluded: 3000, expensed: 10000 });
    expect(s.reforestation[0].amortization).toBeCloseTo(71.43, 2);
    expect(s.totals.costShareExcluded).toBe(3000);
  });

  it("keeps other entities out and flags not-sure costs", () => {
    const s = buildTimberTaxSummary(base());
    expect(s.expenses.map((e) => e.amount)).toEqual([900, 300]);
    expect(s.totals.notSure).toBe(300);
    expect(s.checklist.some((c) => c.includes("not sure"))).toBe(true);
  });

  it("flags a sale with no basis set up", () => {
    const inp = base();
    inp.accounts = [];
    inp.entries = [];
    const s = buildTimberTaxSummary(inp);
    expect(s.sales[0].basisSetUp).toBe(false);
    expect(s.checklist[0]).toMatch(/no timber basis/);
  });

  it("a trust amortizes only", () => {
    const inp = base();
    inp.entities[0].entity_type = "trust";
    const s = buildTimberTaxSummary(inp);
    expect(s.reforestation[0].expensed).toBe(0);
    expect(s.isTrust).toBe(true);
  });

  it("selects properties with no entity", () => {
    const inp = base();
    inp.entityKey = NO_ENTITY_KEY;
    expect(buildTimberTaxSummary(inp).sales).toHaveLength(0);
  });
});
