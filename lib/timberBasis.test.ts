import { describe, expect, it } from "vitest";
import {
  ALL_TIMBER,
  accountBalance,
  allocateByValue,
  proposeDepletion,
  proposeDepletionByShare,
  soldFromSettlements,
  taxableGain,
  type AccountProduct,
} from "./timberBasis";

// USDA FS-1275 (2025 tax year) worked examples.
const usda: AccountProduct[] = [
  { product: "pine_sawtimber", unit: "ton", opening_volume: 1000, opening_basis: 10000 },
  { product: "pine_pulpwood", unit: "ton", opening_volume: 6000, opening_basis: 6000 },
];

describe("USDA examples", () => {
  it("depletes $8,000 for 500 tons sawtimber and 3,000 tons pulpwood", () => {
    const bal = accountBalance(usda, []);
    expect(bal.basis).toBe(16000);
    expect(bal.products.find((p) => p.product === "pine_sawtimber")!.unitBasis).toBe(10);
    const prop = proposeDepletion(bal, [
      { product: "pine_sawtimber", unit: "ton", quantity: 500 },
      { product: "pine_pulpwood", unit: "ton", quantity: 3000 },
    ]);
    expect(prop.total).toBe(8000);
    expect(prop.unmatched).toEqual([]);
  });

  it("allocates a $33,000 purchase: land $10,000 and timber $20,000 FMV gives $22,000 timber basis", () => {
    expect(allocateByValue(33000, { land: 10000, timber: 20000, improvements: 0 })).toEqual({
      land: 11000,
      timber: 22000,
      improvements: 0,
    });
  });

  it("taxes $20,000 proceeds less $3,500 expenses and $6,000 depletion at $10,500", () => {
    expect(taxableGain(20000, 3500, 6000)).toBe(10500);
  });
});

describe("ledger balances", () => {
  it("rolls depletion forward and keeps the unit basis", () => {
    const bal = accountBalance(usda, [
      { entry_date: "2025-03-01", entry_type: "depletion", product: "pine_sawtimber", volume_change: -500, basis_change: -5000 },
    ]);
    const saw = bal.products.find((p) => p.product === "pine_sawtimber")!;
    expect(saw.volume).toBe(500);
    expect(saw.basis).toBe(5000);
    expect(saw.unitBasis).toBe(10);
    expect(bal.depleted).toBe(5000);
    expect(bal.basis).toBe(11000);
  });

  it("spreads a whole-account entry over products by basis", () => {
    const bal = accountBalance(usda, [
      { entry_date: "2025-01-01", entry_type: "capitalized_cost", product: null, volume_change: 0, basis_change: 1600 },
    ]);
    expect(bal.products.find((p) => p.product === "pine_sawtimber")!.basis).toBe(11000);
    expect(bal.products.find((p) => p.product === "pine_pulpwood")!.basis).toBe(6600);
  });

  it("a volume adjustment changes the depletion unit", () => {
    const bal = accountBalance(usda, [
      { entry_date: "2026-01-01", entry_type: "volume_adjustment", product: "pine_pulpwood", volume_change: 2000, basis_change: 0 },
    ]);
    expect(bal.products.find((p) => p.product === "pine_pulpwood")!.unitBasis).toBe(0.75);
  });
});

describe("proposals", () => {
  it("uses an all-timber pool for products not split out", () => {
    const pool: AccountProduct[] = [{ product: ALL_TIMBER, unit: "ton", opening_volume: 10000, opening_basis: 50000 }];
    const prop = proposeDepletion(accountBalance(pool, []), [
      { product: "pine_sawtimber", unit: "ton", quantity: 1000 },
      { product: "pine_pulpwood", unit: "ton", quantity: 1000 },
    ]);
    expect(prop.total).toBe(10000);
    expect(prop.lines.every((l) => l.product === ALL_TIMBER)).toBe(true);
  });

  it("cannot price per unit without a volume: unmatched, use a share", () => {
    const noVol: AccountProduct[] = [{ product: ALL_TIMBER, unit: "ton", opening_volume: null, opening_basis: 163072 }];
    const bal = accountBalance(noVol, []);
    const prop = proposeDepletion(bal, [{ product: "pine_sawtimber", unit: "ton", quantity: 500 }]);
    expect(prop.total).toBe(0);
    expect(prop.unmatched).toHaveLength(1);
    const share = proposeDepletionByShare(bal, 0.25);
    expect(share.total).toBe(40768);
  });

  it("never depletes more than the basis or volume on hand", () => {
    const prop = proposeDepletion(accountBalance(usda, []), [
      { product: "pine_sawtimber", unit: "ton", quantity: 1500 },
    ]);
    expect(prop.total).toBe(10000);
    expect(prop.lines[0].volumeChange).toBe(-1000);
    expect(prop.note).toMatch(/More was cut/);
  });

  it("does not match across units", () => {
    const prop = proposeDepletion(accountBalance(usda, []), [
      { product: "pine_sawtimber", unit: "mbf", quantity: 10 },
    ]);
    expect(prop.unmatched).toHaveLength(1);
  });
});

describe("settlement quantities", () => {
  it("sums by product and unit and applies the tract's share", () => {
    const sold = soldFromSettlements(
      [
        { lines: [{ product: "pine_pulpwood", label: "", quantity: 100, unit: "ton", rate: 8, amount: 800 }] },
        {
          lines: [
            { product: "pine_pulpwood", label: "", quantity: 50, unit: "ton", rate: 8, amount: 400 },
            { product: "pine_sawtimber", label: "", quantity: 20, unit: "ton", rate: 25, amount: 500 },
          ],
        },
      ],
      0.5
    );
    expect(sold).toEqual([
      { product: "pine_pulpwood", unit: "ton", quantity: 75 },
      { product: "pine_sawtimber", unit: "ton", quantity: 10 },
    ]);
  });
});

import { propertyShareOfSale } from "./timberBasis";

describe("property share of a sale", () => {
  const stands = [
    { id: "a", acres: 30, property_id: "P1" },
    { id: "b", acres: 10, property_id: "P2" },
  ];
  it("splits by acres, and falls back to acres for a sale-level sale", () => {
    expect(propertyShareOfSale("by_acres", stands, "P1")).toBe(0.75);
    expect(propertyShareOfSale("none", stands, "P2")).toBe(0.25);
  });
  it("is 1 when every stand is on the property, and honors manual percents", () => {
    expect(propertyShareOfSale("none", [stands[0]], "P1")).toBe(1);
    expect(
      propertyShareOfSale("by_acres", stands, "P2", { method: "manual", percents: { a: 60, b: 40 } })
    ).toBe(0.4);
  });
});

import {
  depletionOverBasis,
  depletionPlanForSale,
  productsStrandedBySplit,
  type AccountEntry,
  type SaleCut,
} from "./timberBasis";

// A sale that spans two tax years: basis $30,000 on 3,000 tons; 1,000
// tons settled 2025-12-15 and 2,000 tons settled 2026-01-20.
describe("depletion by tax year", () => {
  const pool: AccountProduct[] = [{ product: ALL_TIMBER, unit: "ton", opening_volume: 3000, opening_basis: 30000 }];
  const cuts: SaleCut[] = [
    { date: "2025-12-15", sold: [{ product: "pine_sawtimber", unit: "ton", quantity: 1000 }] },
    { date: "2026-01-20", sold: [{ product: "pine_sawtimber", unit: "ton", quantity: 2000 }] },
  ];
  const asEntries = (date: string, lines: Array<{ product: string; volumeChange: number; basisChange: number }>): AccountEntry[] =>
    lines.map((l) => ({
      entry_date: date,
      entry_type: "depletion",
      product: l.product,
      volume_change: l.volumeChange,
      basis_change: l.basisChange,
      timber_sale_id: "T1",
    }));

  it("proposes $10,000 for 2025 and $20,000 for 2026, each dated in its own year", () => {
    const plan = depletionPlanForSale(pool, [], "T1", cuts);
    expect(plan.recordedThrough).toBeNull();
    expect(plan.periods.map((p) => [p.year, p.date, p.proposal.total])).toEqual([
      [2025, "2025-12-15", 10000],
      [2026, "2026-01-20", 20000],
    ]);
    expect(plan.periods.every((p) => p.proposal.unmatched.length === 0)).toBe(true);
    expect(plan.yearsWithoutDepletion).toEqual([]);
  });

  it("dates a year's entries on its last settlement and merges that year's quantities", () => {
    const plan = depletionPlanForSale(pool, [], "T1", [
      { date: "2025-11-03", sold: [{ product: "pine_sawtimber", unit: "ton", quantity: 400 }] },
      { date: "2025-12-15", sold: [{ product: "pine_sawtimber", unit: "ton", quantity: 600 }] },
    ]);
    expect(plan.periods).toHaveLength(1);
    expect(plan.periods[0]).toMatchObject({ year: 2025, date: "2025-12-15" });
    expect(plan.periods[0].sold).toEqual([{ product: "pine_sawtimber", unit: "ton", quantity: 1000 }]);
    expect(plan.periods[0].proposal.total).toBe(10000);
  });

  it("after 2025 is recorded, proposes only 2026", () => {
    const first = depletionPlanForSale(pool, [], "T1", cuts).periods[0];
    const entries = asEntries(first.date, first.proposal.lines);
    const plan = depletionPlanForSale(pool, entries, "T1", cuts);
    expect(plan.recordedThrough).toBe("2025-12-15");
    expect(plan.periods.map((p) => [p.year, p.date, p.proposal.total])).toEqual([[2026, "2026-01-20", 20000]]);
  });

  it("proposes only what has been cut since when a new settlement arrives", () => {
    const first = depletionPlanForSale(pool, [], "T1", [cuts[0]]).periods[0];
    const entries = asEntries(first.date, first.proposal.lines);
    const plan = depletionPlanForSale(pool, entries, "T1", [
      cuts[0],
      { date: "2025-12-28", sold: [{ product: "pine_pulpwood", unit: "ton", quantity: 500 }] },
    ]);
    expect(plan.periods).toHaveLength(1);
    expect(plan.periods[0]).toMatchObject({ year: 2025, date: "2025-12-28" });
    expect(plan.periods[0].sold).toEqual([{ product: "pine_pulpwood", unit: "ton", quantity: 500 }]);
    expect(plan.periods[0].proposal.total).toBe(5000);
  });

  it("proposes nothing once every settlement is covered", () => {
    const all = depletionPlanForSale(pool, [], "T1", cuts).periods;
    const entries = all.flatMap((p) => asEntries(p.date, p.proposal.lines));
    const plan = depletionPlanForSale(pool, entries, "T1", cuts);
    expect(plan.periods).toEqual([]);
    expect(plan.yearsWithoutDepletion).toEqual([]);
    expect(accountBalance(pool, entries).basis).toBe(0);
  });

  it("flags a year left without depletion by an older one-lump entry", () => {
    const lump = asEntries("2026-01-20", [{ product: ALL_TIMBER, volumeChange: -3000, basisChange: -30000 }]);
    const plan = depletionPlanForSale(pool, lump, "T1", cuts);
    expect(plan.periods).toEqual([]);
    expect(plan.yearsWithoutDepletion).toEqual([2025]);
  });

  it("flags, but does not propose, a settlement entered after the depletion was recorded and dated before it", () => {
    const first = depletionPlanForSale(pool, [], "T1", cuts).periods;
    const entries = first.flatMap((p) => asEntries(p.date, p.proposal.lines)).map((e) => ({ ...e, created_at: "2026-02-01T15:00:00+00:00" }));
    const plan = depletionPlanForSale(pool, entries, "T1", [
      { ...cuts[0], createdAt: "2025-12-16T10:00:00+00:00" },
      { ...cuts[1], createdAt: "2026-01-21T10:00:00+00:00" },
      // A December statement found and entered in March.
      { date: "2025-12-01", sold: [{ product: "pine_sawtimber", unit: "ton", quantity: 50 }], createdAt: "2026-03-05T09:00:00+00:00" },
    ]);
    expect(plan.periods).toEqual([]);
    expect(plan.enteredLater).toEqual(["2025-12-01"]);
    // Nothing is flagged when every settlement was there at the time.
    expect(depletionPlanForSale(pool, entries, "T1", [{ ...cuts[0], createdAt: "2025-12-16T10:00:00+00:00" }]).enteredLater).toEqual([]);
  });

  it("ignores another sale's depletion when deciding what is covered", () => {
    const other: AccountEntry[] = [
      { entry_date: "2026-06-01", entry_type: "depletion", product: ALL_TIMBER, volume_change: 0, basis_change: 0, timber_sale_id: "T2" },
    ];
    expect(depletionPlanForSale(pool, other, "T1", cuts).periods).toHaveLength(2);
  });
});

describe("depletion never exceeds the basis left", () => {
  const bal = accountBalance(usda, []);
  it("allows depletion up to the basis left for the product", () => {
    expect(depletionOverBasis(bal, [{ product: "pine_sawtimber", basis_change: -10000 }])).toBeNull();
  });
  it("refuses more than the product has left, adding up rows for the same product", () => {
    expect(
      depletionOverBasis(bal, [
        { product: "pine_sawtimber", basis_change: -6000 },
        { product: "pine_sawtimber", basis_change: -6000 },
      ])
    ).toEqual({ product: "pine_sawtimber", asked: 12000, left: 10000 });
  });
  it("checks a whole-account entry against the total, and an unknown product against zero", () => {
    expect(depletionOverBasis(bal, [{ product: null, basis_change: -16000 }])).toBeNull();
    expect(depletionOverBasis(bal, [{ product: null, basis_change: -16000.01 }])).toMatchObject({ product: null, left: 16000 });
    expect(depletionOverBasis(bal, [{ product: "poles_pilings", basis_change: -1 }])).toMatchObject({ left: 0 });
  });
});

describe("changing the product split after entries exist", () => {
  // All timber $50,000 with $20,000 depleted, then split into sawtimber
  // $35,000 and pulpwood $15,000: the depletion would stop counting.
  const depleted = [{ product: ALL_TIMBER }, { product: null }];
  it("names the products whose ledger entries the new split would strand", () => {
    expect(productsStrandedBySplit(["pine_sawtimber", "pine_pulpwood"], depleted)).toEqual([ALL_TIMBER]);
  });
  it("allows the same products, added products, and whole-account entries", () => {
    expect(productsStrandedBySplit([ALL_TIMBER], depleted)).toEqual([]);
    expect(productsStrandedBySplit([ALL_TIMBER, "poles_pilings"], depleted)).toEqual([]);
    expect(productsStrandedBySplit(["pine_sawtimber"], [{ product: null }])).toEqual([]);
  });
});

describe("property share when manual percentages are missing or do not add to 100", () => {
  const twoProps = (a: number | null, b: number | null) => [
    { id: "a", acres: 30, property_id: "P1", allocation_pct: a },
    { id: "b", acres: 10, property_id: "P2", allocation_pct: b },
  ];
  const total = (stands: ReturnType<typeof twoProps>) =>
    propertyShareOfSale("manual", stands, "P1") + propertyShareOfSale("manual", stands, "P2");

  it("splits by acres when the percentages were never typed, instead of $0 and $0", () => {
    expect(propertyShareOfSale("manual", twoProps(null, null), "P1")).toBe(0.75);
    expect(propertyShareOfSale("manual", twoProps(null, null), "P2")).toBe(0.25);
  });
  it("accounts for the whole sale with 60 and blank, and with 80 and 40", () => {
    expect(total(twoProps(60, null))).toBe(1);
    expect(total(twoProps(80, 40))).toBe(1);
  });
  it("uses the percentages when they add to 100", () => {
    expect(propertyShareOfSale("manual", twoProps(60, 40), "P1")).toBe(0.6);
  });
});
