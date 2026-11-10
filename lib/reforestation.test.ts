import { describe, expect, it } from "vitest";
import { amortizationSchedule, deductionForYear, recaptureUntil, reforestationByYear } from "./reforestation";

describe("Sec 194", () => {
  it("expenses up to $10,000 and amortizes the rest with the half-year convention", () => {
    const [y] = reforestationByYear([{ paid_date: "2025-03-01", amount: 24000 }], new Map());
    expect(y.expensed).toBe(10000);
    expect(y.amortizable).toBe(14000);
    expect(y.schedule.map((s) => s.amount)).toEqual([1000, 2000, 2000, 2000, 2000, 2000, 2000, 1000]);
    expect(y.schedule[0].year).toBe(2025);
    expect(y.schedule[7].year).toBe(2032);
  });

  it("gives a trust amortization only", () => {
    const [y] = reforestationByYear([{ paid_date: "2025-03-01", amount: 7000 }], new Map(), { isTrust: true });
    expect(y.expensed).toBe(0);
    expect(y.amortizable).toBe(7000);
  });

  it("schedule always adds back to the amount", () => {
    const s = amortizationSchedule(10000.01, 2024);
    expect(Math.round(s.reduce((t, x) => t + x.amount, 0) * 100) / 100).toBe(10000.01);
  });

  it("deduction for a year sums this year's expense and older amortization", () => {
    const res = reforestationByYear(
      [
        { paid_date: "2024-05-01", amount: 24000 },
        { paid_date: "2025-05-01", amount: 3000 },
      ],
      new Map()
    );
    expect(deductionForYear(res, 2025)).toEqual({ expensed: 3000, amortization: 2000, total: 5000 });
  });
});

describe("Sec 126 netting", () => {
  it("excluded cost-share comes off the costs it paid for, earliest first", () => {
    // Dupes-like: $16,269.80 of white oak establishment, $21,065 NRCS excluded
    const res = reforestationByYear(
      [
        { paid_date: "2023-11-01", amount: 5137.5, cost_share_award_id: "a" },
        { paid_date: "2024-02-01", amount: 11132.3, cost_share_award_id: "a" },
        { paid_date: "2024-03-01", amount: 1450 },
      ],
      new Map([["a", 12000]])
    );
    expect(res[0]).toMatchObject({ year: 2023, eligible: 5137.5, costShareExcluded: 5137.5, net: 0 });
    expect(res[1]).toMatchObject({ year: 2024, eligible: 12582.3, costShareExcluded: 6862.5, net: 5719.8, expensed: 5719.8 });
  });

  it("cost-share reported as income does not net anything", () => {
    const [y] = reforestationByYear([{ paid_date: "2024-01-01", amount: 5000, cost_share_award_id: "a" }], new Map());
    expect(y.net).toBe(5000);
  });
});

describe("recapture", () => {
  it("adds years to the date", () => {
    expect(recaptureUntil("2024-06-15", 20)).toBe("2044-06-15");
  });
});
