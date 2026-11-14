import { describe, expect, it } from "vitest";
import { allocationBasis, defaultDates, draftDates, lastDayToPay, statementDateProblem, taxStatus, type CountyDefault } from "./tax";

const NO_DEFAULTS: CountyDefault[] = [];

describe("statement dates follow the tax year", () => {
  it("derives Alabama's calendar: due Oct 1 of the tax year, delinquent Jan 1 of the next", () => {
    expect(defaultDates(2026, "Morgan", "AL", NO_DEFAULTS)).toEqual({ due_date: "2026-10-01", delinquent_date: "2027-01-01" });
  });

  it("the last day to pay on time is the day before the delinquent date", () => {
    expect(lastDayToPay("2027-01-01")).toBe("2026-12-31");
    expect(lastDayToPay("2026-03-01")).toBe("2026-02-28");
    expect(lastDayToPay("2028-03-01")).toBe("2028-02-29");
  });

  it("accepts dates that agree with the tax year", () => {
    expect(statementDateProblem(2026, "2026-10-01", "2027-01-01")).toBeNull();
    // A state that bills the following year.
    expect(statementDateProblem(2026, "2027-02-01", "2027-08-01")).toBeNull();
    // Blank dates are not a mismatch.
    expect(statementDateProblem(2026, "", null)).toBeNull();
  });

  it("flags the two live Morgan rows: tax year 2026 with dates a year early", () => {
    expect(statementDateProblem(2026, "2025-10-01", "2026-01-01")).toMatch(/due date \(Oct 1, 2025\) is not in tax year 2026 or the year after/);
  });

  it("flags a delinquent date that is not after the due date", () => {
    expect(statementDateProblem(2026, "2026-10-01", "2026-10-01")).toMatch(/not after the due date/);
    expect(statementDateProblem(2026, "2026-10-01", "2026-01-01")).toMatch(/not after the due date/);
  });

  it("keeps dates read from the bill when they fit the tax year", () => {
    expect(draftDates(2026, { due_date: "2026-10-01", delinquent_date: "2027-01-01" }, "Colbert", "AL", NO_DEFAULTS)).toEqual({
      due_date: "2026-10-01",
      delinquent_date: "2027-01-01",
      note: null,
    });
    // Only one date printed: the other comes from the county's calendar.
    expect(draftDates(2026, { due_date: null, delinquent_date: "2027-01-01" }, "Colbert", "AL", NO_DEFAULTS)).toEqual({
      due_date: "2026-10-01",
      delinquent_date: "2027-01-01",
      note: null,
    });
  });

  it("does not trust a year the reader guessed: a 2026 bill read with 2025 dates gets the 2026 calendar and a note", () => {
    // Morgan bills print "due on October 1 of each tax year, and are
    // delinquent after December 31 of each year" with no year at all.
    const d = draftDates(2026, { due_date: "2025-10-01", delinquent_date: "2026-01-01" }, "Morgan", "AL", NO_DEFAULTS);
    expect(d.due_date).toBe("2026-10-01");
    expect(d.delinquent_date).toBe("2027-01-01");
    expect(d.note).toMatch(/due Oct 1, 2025/);
    expect(d.note).toMatch(/do not fit tax year 2026/);
  });

  it("re-derives when the tax year is corrected in review", () => {
    // The reader said 2025 (dates to match); the user corrects the year.
    const first = draftDates(2025, { due_date: "2025-10-01", delinquent_date: "2026-01-01" }, "Morgan", "AL", NO_DEFAULTS);
    expect(first).toEqual({ due_date: "2025-10-01", delinquent_date: "2026-01-01", note: null });
    const corrected = draftDates(2026, { due_date: "2025-10-01", delinquent_date: "2026-01-01" }, "Morgan", "AL", NO_DEFAULTS);
    expect([corrected.due_date, corrected.delinquent_date]).toEqual(["2026-10-01", "2027-01-01"]);
    expect(statementDateProblem(2026, corrected.due_date, corrected.delinquent_date)).toBeNull();
  });

  it("uses the county's remembered calendar, and leaves dates blank until a tax year is known", () => {
    const defaults: CountyDefault[] = [{ county: "Tishomingo", state: "MS", due_month: 2, due_day: 1, delinquent_month: 2, delinquent_day: 2 }];
    expect(draftDates(2026, {}, "Tishomingo", "MS", defaults)).toEqual({ due_date: "2026-02-01", delinquent_date: "2027-02-02", note: null });
    expect(draftDates(0, {}, "Morgan", "AL", NO_DEFAULTS)).toEqual({ due_date: "", delinquent_date: "", note: null });
    expect(draftDates(202, {}, "Morgan", "AL", NO_DEFAULTS)).toEqual({ due_date: "", delinquent_date: "", note: null });
  });
});

describe("taxStatus", () => {
  const today = new Date("2027-02-01T12:00:00");
  it("treats a zero-amount statement as paid, never delinquent", () => {
    expect(taxStatus({ amount_due: 0, delinquent_date: "2027-01-01" }, 0, today)).toBe("paid");
  });
  it("still reports unpaid, partial, paid, and delinquent for a real balance", () => {
    expect(taxStatus({ amount_due: 100, delinquent_date: "2027-01-01" }, 0, today)).toBe("delinquent");
    expect(taxStatus({ amount_due: 100, delinquent_date: "2027-01-01" }, 100, today)).toBe("paid");
    expect(taxStatus({ amount_due: 100, delinquent_date: "2028-01-01" }, 40, today)).toBe("partial");
    expect(taxStatus({ amount_due: 100, delinquent_date: "2028-01-01" }, 0, today)).toBe("unpaid");
  });
});

describe("allocationBasis", () => {
  it("spreads a payment over the whole statement, not only the lines this viewer can see", () => {
    // $1,000 statement, $900 of lines visible to a 'user' member.
    expect(allocationBasis({ amount_due: 1000, line_total: 1000 }, 900)).toBe(1000);
    // No stored line total: the statement total stands in.
    expect(allocationBasis({ amount_due: 1000, line_total: null }, 900)).toBe(1000);
    // Never less than the lines actually in view.
    expect(allocationBasis({ amount_due: 500, line_total: 500 }, 900)).toBe(900);
    expect(allocationBasis(undefined, 900)).toBe(900);
  });
});
