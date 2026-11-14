import { describe, expect, it } from "vitest";
import { recordCountsAsReceived, totalsByYear } from "./incomeRecords";

describe("income record basis", () => {
  it("only a Received record counts as money received", () => {
    expect(recordCountsAsReceived("received")).toBe(true);
    expect(recordCountsAsReceived("accrued")).toBe(false); // owed: invoice or settlement
    expect(recordCountsAsReceived("calculated")).toBe(false); // worked out, not confirmed paid
    // Rows read without the column (older callers) keep counting.
    expect(recordCountsAsReceived(null)).toBe(true);
    expect(recordCountsAsReceived(undefined)).toBe(true);
  });

  it("year totals keep owed and calculated amounts out of the received figures", () => {
    const rows = [
      { year: 2021, income_type: "solar", amount: 14348.01, basis: "received" },
      { year: 2021, income_type: "tower", amount: 15000, basis: "received" },
      { year: 2021, income_type: "share_rent", amount: 5000, basis: "accrued" },
      { year: 2021, income_type: "solar", amount: 700, basis: "calculated" },
      { year: 2020, income_type: "solar", amount: 100, basis: "received" },
    ];
    const [y2021, y2020] = totalsByYear(rows);
    expect(y2021.year).toBe(2021);
    expect(y2021.total).toBeCloseTo(29348.01, 2);
    expect(y2021.byType.get("solar")).toBeCloseTo(14348.01, 2);
    expect(y2021.byType.has("share_rent")).toBe(false);
    expect(y2021.unconfirmed).toBeCloseTo(5700, 2);
    expect(y2020).toMatchObject({ year: 2020, total: 100, unconfirmed: 0 });
  });
});
