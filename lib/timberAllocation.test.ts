import { describe, expect, it } from "vitest";
import {
  allocateAmount,
  allocationShares,
  manualPercentTotal,
  manualPercentsValid,
  resolveSettlementShares,
  standsWithoutAcres,
} from "./timberAllocation";

const stands = [
  { id: "a", acres: 60 },
  { id: "b", acres: 40 },
];

describe("allocationShares", () => {
  it("splits by stand acres by default", () => {
    const shares = allocationShares("by_acres", stands);
    expect(shares).toEqual([
      { standId: "a", pct: 60 },
      { standId: "b", pct: 40 },
    ]);
  });

  it("falls back to an equal split when no stand has acres", () => {
    const shares = allocationShares("by_acres", [
      { id: "a", acres: null },
      { id: "b", acres: null },
    ]);
    expect(shares[0].pct).toBeCloseTo(50);
    expect(shares[1].pct).toBeCloseTo(50);
  });

  it("uses stored manual percentages when they add to 100", () => {
    const shares = allocationShares("manual", [
      { id: "a", acres: 60, allocation_pct: 70 },
      { id: "b", acres: 40, allocation_pct: 30 },
    ]);
    expect(shares).toEqual([
      { standId: "a", pct: 70 },
      { standId: "b", pct: 30 },
    ]);
  });

  // Manual percentages that do not add to 100 used to be applied as
  // typed, which lost or invented dollars. They now fall back to acres.
  it("falls back to acres when manual percentages are blank", () => {
    const shares = allocationShares("manual", [
      { id: "a", acres: 60, allocation_pct: null },
      { id: "b", acres: 40, allocation_pct: null },
    ]);
    expect(allocateAmount(50000, shares)).toEqual([
      { standId: "a", amount: 30000 },
      { standId: "b", amount: 20000 },
    ]);
  });

  it("falls back to acres for 60 and blank, so no dollars go missing", () => {
    const shares = allocationShares("manual", [
      { id: "a", acres: 60, allocation_pct: 60 },
      { id: "b", acres: 40, allocation_pct: null },
    ]);
    const out = allocateAmount(50000, shares);
    expect(out.reduce((s, a) => s + a.amount, 0)).toBe(50000);
    expect(out).toEqual([
      { standId: "a", amount: 30000 },
      { standId: "b", amount: 20000 },
    ]);
  });

  it("falls back to acres for 80 and 40, so no dollars are invented", () => {
    const shares = allocationShares("manual", [
      { id: "a", acres: 50, allocation_pct: 80 },
      { id: "b", acres: 50, allocation_pct: 40 },
    ]);
    const out = allocateAmount(50000, shares);
    expect(out.reduce((s, a) => s + a.amount, 0)).toBe(50000);
    expect(out).toEqual([
      { standId: "a", amount: 25000 },
      { standId: "b", amount: 25000 },
    ]);
  });

  it("totals and checks manual percentages", () => {
    const sixtyBlank = [
      { id: "a", acres: 60, allocation_pct: 60 },
      { id: "b", acres: 40, allocation_pct: null },
    ];
    expect(manualPercentTotal(sixtyBlank)).toBe(60);
    expect(manualPercentsValid(sixtyBlank)).toBe(false);
    expect(manualPercentsValid(sixtyBlank, { a: 60, b: 40 })).toBe(true);
    expect(manualPercentsValid(sixtyBlank, { a: 33.33, b: 33.33, c: 33.34 })).toBe(false);
    expect(manualPercentsValid(sixtyBlank, { a: 120, b: -20 })).toBe(false);
    expect(manualPercentsValid([])).toBe(false);
  });

  it("names linked stands with no drawn boundary when another has acres", () => {
    expect(
      standsWithoutAcres([
        { id: "a", acres: 60 },
        { id: "b", acres: null },
        { id: "c", acres: 0 },
      ])
    ).toEqual(["b", "c"]);
    expect(standsWithoutAcres(stands)).toEqual([]);
    // No stand has acres: the split is equal, nothing is left out.
    expect(
      standsWithoutAcres([
        { id: "a", acres: null },
        { id: "b", acres: null },
      ])
    ).toEqual([]);
  });

  it("allocates nothing under none", () => {
    expect(allocationShares("none", stands)).toEqual([]);
  });
});

describe("allocateAmount", () => {
  it("splits dollars by share and sums back exactly", () => {
    const out = allocateAmount(10000, allocationShares("by_acres", stands));
    expect(out).toEqual([
      { standId: "a", amount: 6000 },
      { standId: "b", amount: 4000 },
    ]);
  });

  it("pushes rounding drift into the last stand so cents add up", () => {
    const shares = allocationShares("by_acres", [
      { id: "a", acres: 1 },
      { id: "b", acres: 1 },
      { id: "c", acres: 1 },
    ]);
    const out = allocateAmount(100, shares);
    const total = out.reduce((s, a) => s + a.amount, 0);
    expect(Math.round(total * 100) / 100).toBe(100);
  });

  it("leaves the remainder unallocated for under-100 manual splits", () => {
    const out = allocateAmount(1000, [
      { standId: "a", pct: 50 },
      { standId: "b", pct: 30 },
    ]);
    expect(out).toEqual([
      { standId: "a", amount: 500 },
      { standId: "b", amount: 300 },
    ]);
  });
});

describe("resolveSettlementShares", () => {
  it("inherits the sale method when the settlement has no override", () => {
    expect(resolveSettlementShares("by_acres", stands, null)).toEqual(
      allocationShares("by_acres", stands)
    );
  });

  it("a settlement override wins over the sale method", () => {
    const shares = resolveSettlementShares("by_acres", stands, {
      method: "manual",
      percents: { a: 100 },
    });
    expect(shares).toEqual([{ standId: "a", pct: 100 }]);
  });

  it("a settlement's own percents stand alone: a stand it leaves out gets 0", () => {
    const withStored = [
      { id: "a", acres: 60, allocation_pct: 60 },
      { id: "b", acres: 40, allocation_pct: 40 },
    ];
    expect(
      resolveSettlementShares("manual", withStored, { method: "manual", percents: { a: 100 } })
    ).toEqual([{ standId: "a", pct: 100 }]);
  });

  it("a settlement override whose percents do not add to 100 falls back to acres", () => {
    expect(
      resolveSettlementShares("by_acres", stands, { method: "manual", percents: { a: 60 } })
    ).toEqual(allocationShares("by_acres", stands));
  });

  it("an override to none allocates nothing", () => {
    expect(
      resolveSettlementShares("by_acres", stands, { method: "none" })
    ).toEqual([]);
  });
});
