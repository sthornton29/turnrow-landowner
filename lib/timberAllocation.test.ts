import { describe, expect, it } from "vitest";
import {
  allocateAmount,
  allocationShares,
  resolveSettlementShares,
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

  it("uses stored manual percentages as-is (under-100 stays unallocated)", () => {
    const shares = allocationShares("manual", [
      { id: "a", acres: 60, allocation_pct: 50 },
      { id: "b", acres: 40, allocation_pct: 30 },
    ]);
    expect(shares).toEqual([
      { standId: "a", pct: 50 },
      { standId: "b", pct: 30 },
    ]);
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

  it("an override to none allocates nothing", () => {
    expect(
      resolveSettlementShares("by_acres", stands, { method: "none" })
    ).toEqual([]);
  });
});
