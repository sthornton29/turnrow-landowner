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

describe("a sale's money counts whatever the sale type says", () => {
  // The sale was pay as cut with settlements, then its type was changed
  // to lump sum (or the other way round): nothing may drop out.
  it("counts settlements on a sale now marked lump sum", () => {
    const inp = base();
    inp.sales[0].sale_type = "lump_sum";
    const s = buildTimberTaxSummary(inp);
    expect(s.sales[0]).toMatchObject({ proceeds: 29678.84, gain: 22678.84 });
  });

  it("counts payments on a sale now marked pay as cut", () => {
    const inp = base();
    inp.settlements = [];
    inp.payments = [{ timber_sale_id: "T1", amount: 120000, received_date: "2025-03-10" }];
    const s = buildTimberTaxSummary(inp);
    expect(s.sales[0].proceeds).toBe(120000);
  });

  it("adds settlements and payments together when a sale has both", () => {
    const inp = base();
    inp.payments = [{ timber_sale_id: "T1", amount: 1000, received_date: "2025-03-10" }];
    expect(buildTimberTaxSummary(inp).sales[0].proceeds).toBe(30678.84);
  });
});

describe("a sale with no linked stands", () => {
  const noStands = (): SummaryInput => {
    const inp = base();
    inp.saleStands = [];
    inp.sales = [{ id: "T9", sale_name: "Back forty clearcut", sale_type: "lump_sum", allocation_method: "by_acres", contract_date: "2025-02-01" }];
    inp.settlements = [];
    inp.payments = [{ timber_sale_id: "T9", amount: 120000, received_date: "2025-03-10" }];
    inp.costs = [];
    inp.entries = [];
    return inp;
  };

  it("cannot be placed on a property, so the checklist names it and its dollars", () => {
    const s = buildTimberTaxSummary(noStands());
    expect(s.sales).toHaveLength(0);
    const line = s.checklist.find((c) => c.includes("Back forty clearcut"));
    expect(line).toBeDefined();
    expect(line).toContain("$120,000.00");
    expect(line).toMatch(/not linked to any timber stand/);
  });

  it("shows the warning in every taxpayer's summary, since nobody owns it yet", () => {
    const inp = noStands();
    inp.entityKey = "E2";
    expect(buildTimberTaxSummary(inp).checklist.some((c) => c.includes("Back forty clearcut"))).toBe(true);
  });

  it("stays quiet when the unlinked sale had no money in the year", () => {
    const inp = noStands();
    inp.year = 2024;
    expect(buildTimberTaxSummary(inp).checklist.some((c) => c.includes("Back forty clearcut"))).toBe(false);
  });
});

describe("costs on work that is not done", () => {
  it("leaves planned work's costs out of the deduction, the expenses, and the selling costs", () => {
    const inp = base();
    inp.costs = inp.costs.map((c) => ({ ...c, activity_id: c.id === "C2" ? "ACT_PLANNED" : c.id === "C3" ? "ACT_DONE" : null }));
    inp.activities = [
      { id: "ACT_PLANNED", status: "planned" },
      { id: "ACT_DONE", status: "done" },
    ];
    const s = buildTimberTaxSummary(inp);
    // C2 ($14,000 of seedlings) is on planned work: no replanting deduction.
    expect(s.reforestation).toHaveLength(0);
    expect(s.totals.reforestationDeduction).toBe(0);
    // C3 ($900 burn) is on done work and still counts.
    expect(s.expenses.map((e) => e.amount)).toEqual([900, 300]);
    const line = s.checklist.find((c) => c.includes("not marked as done"));
    expect(line).toContain("1 cost");
    expect(line).toContain("$14,000.00");
  });

  it("counts every cost when no activity list is given, as before", () => {
    const s = buildTimberTaxSummary(base());
    expect(s.reforestation[0].paidThisYear).toBe(14000);
    expect(s.checklist.some((c) => c.includes("not marked as done"))).toBe(false);
  });
});

describe("selling costs the summary cannot place", () => {
  it("lists a selling cost with no sale picked, with its dollars", () => {
    const inp = base();
    inp.costs.push({ id: "C6", property_id: "P1", paid_date: "2025-06-01", amount: 1500, tax_category: "selling_expense", timber_sale_id: null, cost_share_award_id: null, vendor: "Attorney", description: "contract review" });
    const s = buildTimberTaxSummary(inp);
    // Not in the sale's numbers...
    expect(s.sales[0].sellingExpenses).toBe(2000);
    // ...so the checklist carries it.
    const line = s.checklist.find((c) => c.includes("not linked to a timber sale"));
    expect(line).toContain("1 selling cost");
    expect(line).toContain("contract review, Attorney $1,500.00");
  });

  it("lists a selling cost linked to a sale with no stand on that property", () => {
    const inp = base();
    inp.properties.push({ id: "P3", name: "Creek tract", entity_id: "E1" });
    inp.costs.push({ id: "C7", property_id: "P3", paid_date: "2025-06-01", amount: 700, tax_category: "selling_expense", timber_sale_id: "T1", cost_share_award_id: null, vendor: null, description: "cruise" });
    const line = buildTimberTaxSummary(inp).checklist.find((c) => c.includes("no stand on the cost's property"));
    expect(line).toContain("cruise $700.00");
  });

  it("says nothing when every selling cost is on a sale line", () => {
    const s = buildTimberTaxSummary(base());
    expect(s.checklist.some((c) => c.includes("selling cost"))).toBe(false);
  });
});

describe("selling costs paid in a year the sale brought in no money", () => {
  // Settlements for T1 are dated 2024 and 2025. A cruise fee paid in
  // 2023 still counts in 2023 (the rule is unchanged), with a note.
  const withEarlyFee = (year: number): SummaryInput => {
    const inp = base();
    inp.year = year;
    inp.costs.push({ id: "C8", property_id: "P1", paid_date: "2023-10-01", amount: 800, tax_category: "selling_expense", timber_sale_id: "T1", cost_share_award_id: null, vendor: "Forester", description: "sale cruise" });
    return inp;
  };

  it("keeps counting the cost in the year paid", () => {
    const s = buildTimberTaxSummary(withEarlyFee(2023));
    expect(s.sales[0]).toMatchObject({ proceeds: 0, sellingExpenses: 800, gain: -800 });
    expect(buildTimberTaxSummary(withEarlyFee(2025)).sales[0].sellingExpenses).toBe(2000);
  });

  it("adds a checklist line in the year paid and in the years with proceeds", () => {
    for (const year of [2023, 2025]) {
      const line = buildTimberTaxSummary(withEarlyFee(year)).checklist.find((c) => c.includes("a year with no money in from this sale"));
      expect(line).toContain("Summerwood thinning");
      expect(line).toContain("$800.00 of selling costs paid in 2023");
    }
  });

  it("is quiet when the selling costs were paid in a year with proceeds", () => {
    expect(buildTimberTaxSummary(base()).checklist.some((c) => c.includes("no money in from this sale"))).toBe(false);
  });
});

describe("splitting one amount between properties", () => {
  it("gives the rounding remainder to the last share: a 50/50 split of $100,000.01 adds back to the cent", () => {
    const inp = base();
    inp.properties[1].entity_id = "E1"; // both properties under one taxpayer
    inp.saleStands = [
      { timber_sale_id: "T1", timber_stand_id: "S1", allocation_pct: null },
      { timber_sale_id: "T1", timber_stand_id: "S2", allocation_pct: null },
    ];
    inp.settlements = [{ timber_sale_id: "T1", settlement_date: "2025-01-15", total_amount: 100000.01, allocation: null }];
    const s = buildTimberTaxSummary(inp);
    expect(s.sales.map((x) => x.proceeds)).toEqual([50000.01, 50000]);
    expect(s.totals.proceeds).toBe(100000.01);
  });

  it("splits the same way whichever taxpayer's summary is open", () => {
    const inp = base(); // P1 under E1, P2 under E2
    inp.saleStands = [
      { timber_sale_id: "T1", timber_stand_id: "S1", allocation_pct: null },
      { timber_sale_id: "T1", timber_stand_id: "S2", allocation_pct: null },
    ];
    inp.settlements = [{ timber_sale_id: "T1", settlement_date: "2025-01-15", total_amount: 100000.01, allocation: null }];
    const e1 = buildTimberTaxSummary(inp).totals.proceeds;
    inp.entityKey = "E2";
    const e2 = buildTimberTaxSummary(inp).totals.proceeds;
    expect(Math.round((e1 + e2) * 100) / 100).toBe(100000.01);
  });
});

describe("depletion follows the year of its ledger entry", () => {
  // The basis page now records one set of entries per tax year, each
  // dated in its year; the summary reads them by that date.
  it("shows $10,000 in 2025 and $20,000 in 2026 for a sale that spans both", () => {
    const inp = base();
    inp.settlements = [
      { timber_sale_id: "T1", settlement_date: "2025-12-15", total_amount: 30000, allocation: null },
      { timber_sale_id: "T1", settlement_date: "2026-01-20", total_amount: 60000, allocation: null },
    ];
    inp.entries = [
      { account_id: "AC1", entry_date: "2025-12-15", entry_type: "depletion", basis_change: -10000, timber_sale_id: "T1" },
      { account_id: "AC1", entry_date: "2026-01-20", entry_type: "depletion", basis_change: -20000, timber_sale_id: "T1" },
    ];
    expect(buildTimberTaxSummary(inp).sales[0].depletion).toBe(10000);
    inp.year = 2026;
    expect(buildTimberTaxSummary(inp).sales[0].depletion).toBe(20000);
  });
});
