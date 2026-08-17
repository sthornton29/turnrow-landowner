import { describe, expect, it } from "vitest";
import { proposeAllocation, type OpenExpectedPayment } from "./paymentMatch";

const open = (over: Partial<OpenExpectedPayment>): OpenExpectedPayment => ({
  id: "e1",
  label: "First half",
  due_date: "2026-03-01",
  expected_amount: 10000,
  received_total: 0,
  ...over,
});

describe("proposeAllocation", () => {
  it("puts an exact match on that payment even when another is due sooner", () => {
    const result = proposeAllocation(12500, "2026-11-05", [
      open({ id: "spring", due_date: "2026-03-01", expected_amount: 10000 }),
      open({ id: "fall", due_date: "2026-11-01", expected_amount: 12500 }),
    ]);
    expect(result.lines).toEqual([{ expectedId: "fall", amount: 12500 }]);
    expect(result.leftover).toBe(0);
  });

  it("splits one check across several open payments by due-date proximity", () => {
    const result = proposeAllocation(15000, "2026-03-05", [
      open({ id: "spring", due_date: "2026-03-01", expected_amount: 10000 }),
      open({ id: "fall", due_date: "2026-11-01", expected_amount: 12500 }),
    ]);
    expect(result.lines).toEqual([
      { expectedId: "spring", amount: 10000 },
      { expectedId: "fall", amount: 5000 },
    ]);
    expect(result.leftover).toBe(0);
  });

  it("proposes a partial payment when the check is smaller than the open amount", () => {
    const result = proposeAllocation(4000, "2026-03-05", [
      open({ id: "spring", expected_amount: 10000 }),
    ]);
    expect(result.lines).toEqual([{ expectedId: "spring", amount: 4000 }]);
    expect(result.leftover).toBe(0);
  });

  it("accounts for money already received against a payment", () => {
    const result = proposeAllocation(6000, "2026-03-05", [
      open({ id: "spring", expected_amount: 10000, received_total: 4000 }),
    ]);
    // Outstanding is exactly 6000: exact match.
    expect(result.lines).toEqual([{ expectedId: "spring", amount: 6000 }]);
  });

  it("returns leftover when the check exceeds everything open", () => {
    const result = proposeAllocation(11000, "2026-03-05", [
      open({ id: "spring", expected_amount: 10000 }),
    ]);
    expect(result.lines).toEqual([{ expectedId: "spring", amount: 10000 }]);
    expect(result.leftover).toBe(1000);
  });

  it("handles no open payments (fully unscheduled)", () => {
    const result = proposeAllocation(5000, "2026-03-05", []);
    expect(result.lines).toEqual([]);
    expect(result.leftover).toBe(5000);
  });

  it("skips fully paid rows", () => {
    const result = proposeAllocation(5000, "2026-03-05", [
      open({ id: "paid", expected_amount: 10000, received_total: 10000 }),
      open({ id: "fall", due_date: "2026-11-01", expected_amount: 12500 }),
    ]);
    expect(result.lines).toEqual([{ expectedId: "fall", amount: 5000 }]);
  });
});
