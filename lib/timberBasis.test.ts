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
