import { describe, expect, it } from "vitest";
import {
  annualRent,
  cropAssumptions,
  generateLeasePayments,
  govPaymentTreatment,
  govTreatmentSentence,
  installmentsOutsideTerm,
  isGovShareLabel,
  maxScheduleDay,
  planScheduleRefresh,
  rentDueYears,
  rentShareDue,
  schedulePercentTotal,
  scheduleProblem,
  type LeaseLike,
  type YearAssumptions,
} from "./leaseLogic";

const cropShareLease = (over: Partial<LeaseLike> = {}): LeaseLike => ({
  lease_type: "agricultural",
  rent_structure: "crop_share",
  terms: { landowner_share_pct: 25 },
  payment_schedule: [],
  start_date: "2026-01-01",
  end_date: "2026-12-31",
  ...over,
});

describe("cropAssumptions", () => {
  it("reads the multi-crop shape", () => {
    const a: YearAssumptions = {
      crops: [{ crop: "Wheat", acres: 100 }, { crop: "Canola", acres: 50 }],
    };
    expect(cropAssumptions(a)).toHaveLength(2);
  });

  it("reads legacy single-crop rows as one entry", () => {
    const a: YearAssumptions = { crop: "Corn", acres: 100, expected_yield: 180, expected_price: 4.5 };
    expect(cropAssumptions(a)).toEqual([
      {
        crop: "Corn",
        acres: 100,
        expected_yield: 180,
        expected_price: 4.5,
        expected_shared_expenses: null,
      },
    ]);
  });

  it("is empty for untouched rows", () => {
    expect(cropAssumptions({})).toEqual([]);
    expect(cropAssumptions(undefined)).toEqual([]);
  });
});

describe("annualRent crop share", () => {
  it("sums multiple crop entries", () => {
    const rent = annualRent(cropShareLease(), 500, {
      crops: [
        { crop: "Wheat", acres: 100, expected_yield: 60, expected_price: 6 },
        { crop: "Canola", acres: 50, expected_yield: 40, expected_price: 11.25 },
      ],
    });
    // 100*60*6*0.25 + 50*40*11.25*0.25 = 9000 + 5625
    expect(rent).toBe(14625);
  });

  it("sums practice-split entries of the same crop", () => {
    // Corn irrigated and Corn dryland as separate entries.
    const rent = annualRent(cropShareLease(), 500, {
      crops: [
        { crop: "Corn", practice: "irrigated", acres: 60, expected_yield: 220, expected_price: 4.5 },
        { crop: "Corn", practice: "dryland", acres: 40, expected_yield: 130, expected_price: 4.5 },
      ],
    });
    expect(rent).toBe((60 * 220 * 4.5 + 40 * 130 * 4.5) * 0.25);
  });

  it("subtracts shared expenses per entry when the lease shares them", () => {
    const lease = cropShareLease({
      terms: { landowner_share_pct: 50, shares_expenses: true },
    });
    const rent = annualRent(lease, 500, {
      crops: [
        { crop: "Corn", acres: 10, expected_yield: 100, expected_price: 4, expected_shared_expenses: 500 },
      ],
    });
    expect(rent).toBe(10 * 100 * 4 * 0.5 - 500);
  });

  it("stays incomplete while any started entry is missing a value", () => {
    const rent = annualRent(cropShareLease(), 500, {
      crops: [
        { crop: "Wheat", acres: 100, expected_yield: 60, expected_price: 6 },
        { crop: "Canola", acres: 50 }, // no yield or price yet
      ],
    });
    expect(rent).toBeNull();
  });

  it("blank payment schedule rows never zero out generation", () => {
    // The form can save empty schedule rows; they must be ignored and
    // the default annual payment used, not silently generate nothing.
    const lease = cropShareLease({
      payment_schedule: [
        { label: "", month: 0, day: 0, percent: null, amount: null },
        { label: "", month: 0, day: 0, percent: null, amount: null },
      ],
    });
    const rows = generateLeasePayments(
      lease,
      500,
      new Map([
        [2026, { crops: [{ crop: "Corn", acres: 100, expected_yield: 180, expected_price: 4.5 }] }],
      ])
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      year: 2026,
      label: "Annual payment",
      expected_amount: 100 * 180 * 4.5 * 0.25,
    });
  });

  it("still computes legacy single-crop rows", () => {
    const rent = annualRent(cropShareLease(), 500, {
      crop: "Corn",
      acres: 100,
      expected_yield: 180,
      expected_price: 4.5,
    });
    expect(rent).toBe(100 * 180 * 4.5 * 0.25);
  });
});

describe("government payment treatment", () => {
  it("explicit choices resolve as chosen", () => {
    const r = govPaymentTreatment({ gov_payment_treatment: "landowner_share", gov_payment_share_pct: 33, gov_payment_received_via: "tenant_remits" });
    expect(r).toMatchObject({ treatment: "landowner_share", sharePct: 33, receivedVia: "tenant_remits", chosen: true, needsReceivedVia: false });
    expect(govPaymentTreatment({ gov_payment_treatment: "tenant_retains", gov_payment_share_pct: 40 })).toMatchObject({ treatment: "tenant_retains", sharePct: 0, chosen: true });
  });
  it("migrates an old nonzero share to landowner share, flagged unconfirmed", () => {
    const r = govPaymentTreatment({ gov_payment_share_pct: 25 });
    expect(r).toMatchObject({ treatment: "landowner_share", sharePct: 25, chosen: false, needsReceivedVia: true });
    expect(govTreatmentSentence({ gov_payment_share_pct: 25 })).toContain("confirm");
  });
  it("migrates a zero or missing share to tenant retains, not yet chosen", () => {
    expect(govPaymentTreatment({})).toMatchObject({ treatment: "tenant_retains", chosen: false });
    expect(govTreatmentSentence({})).toBe("Government payments: not chosen yet");
    expect(govTreatmentSentence({ gov_payment_treatment: "tenant_retains" })).toBe("Tenant keeps all government payments");
  });
});

describe("government share expected rows", () => {
  const gov = new Map([[2026, 964.92], [2027, 1000]]);
  const base = (terms: Record<string, unknown>) =>
    cropShareLease({
      terms: { landowner_share_pct: 25, ...terms },
      start_date: "2026-01-01",
      end_date: "2027-12-31",
      payment_schedule: [{ label: "Rent", month: 12, day: 1, percent: 100 }],
    });
  it("tenant remits: one row per program year, due October of the payment year", () => {
    const rows = generateLeasePayments(
      base({ gov_payment_treatment: "landowner_share", gov_payment_share_pct: 50, gov_payment_received_via: "tenant_remits" }),
      100,
      new Map(),
      gov
    ).filter((r) => isGovShareLabel(r.label));
    expect(rows).toEqual([
      { year: 2027, label: "Government payment share (program year 2026)", due_date: "2027-10-01", expected_amount: 964.92 },
      { year: 2028, label: "Government payment share (program year 2027)", due_date: "2028-10-01", expected_amount: 1000 },
    ]);
  });
  it("FSA direct and tenant retains generate no government rows", () => {
    for (const terms of [
      { gov_payment_treatment: "landowner_share", gov_payment_share_pct: 50, gov_payment_received_via: "fsa_direct" },
      { gov_payment_treatment: "tenant_retains" },
      { gov_payment_share_pct: 50 }, // unconfirmed migration: never generates
    ]) {
      const rows = generateLeasePayments(base(terms), 100, new Map(), gov).filter((r) => isGovShareLabel(r.label));
      expect(rows).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------- refresh

describe("planScheduleRefresh (Refresh expected payments)", () => {
  const row = (id: string, due_date: string, label: string) => ({
    id,
    year: Number(due_date.slice(0, 4)),
    label,
    due_date,
  });
  const gen = (due_date: string, label: string, expected_amount = 5000) => ({
    year: Number(due_date.slice(0, 4)),
    label,
    due_date,
    expected_amount,
  });
  const existing = [row("mar", "2026-03-01", "First half"), row("dec", "2026-12-01", "Second half")];
  const insertDates = (plan: { inserts: Array<{ due_date: string }> }) => plan.inserts.map((r) => r.due_date);

  it("an unchanged schedule replaces only the unpaid rows", () => {
    const plan = planScheduleRefresh(existing, new Set(["mar"]), [
      gen("2026-03-01", "First half"),
      gen("2026-12-01", "Second half"),
    ]);
    expect(plan.deleteIds).toEqual(["dec"]);
    expect(insertDates(plan)).toEqual(["2026-12-01"]);
  });

  it("editing the date or label of a paid installment does not add an unpaid copy of it", () => {
    // The first half is paid; its date moves to March 15 and it is renamed.
    // Matching on label and date used to insert it again.
    const plan = planScheduleRefresh(existing, new Set(["mar"]), [
      gen("2026-03-15", "Spring payment"),
      gen("2026-12-01", "Second half"),
    ]);
    expect(plan.deleteIds).toEqual(["dec"]);
    expect(insertDates(plan)).toEqual(["2026-12-01"]);
  });

  it("the paid second installment stands for the second installment, wherever it moves", () => {
    const plan = planScheduleRefresh(existing, new Set(["dec"]), [
      gen("2026-04-01", "First half"),
      gen("2026-11-15", "Fall payment"),
    ]);
    expect(plan.deleteIds).toEqual(["mar"]);
    expect(insertDates(plan)).toEqual(["2026-04-01"]);
  });

  it("a paid row whose year lost its other row still matches its own installment", () => {
    // The unpaid March row was deleted by hand earlier; December is paid.
    const plan = planScheduleRefresh([existing[1]], new Set(["dec"]), [
      gen("2026-03-01", "First half"),
      gen("2026-12-15", "Second half"),
    ]);
    expect(plan.deleteIds).toEqual([]);
    expect(insertDates(plan)).toEqual(["2026-03-01"]);
  });

  it("years are matched separately, and government share rows only with each other", () => {
    const rows = [
      ...existing,
      row("gov", "2027-10-01", "Government payment share (program year 2026)"),
      row("r27", "2027-03-01", "First half"),
    ];
    const plan = planScheduleRefresh(rows, new Set(["gov"]), [
      gen("2026-03-01", "First half"),
      gen("2026-12-01", "Second half"),
      gen("2027-03-01", "First half"),
      gen("2027-12-01", "Second half"),
      gen("2027-10-01", "Government payment share (program year 2026)", 964.92),
    ]);
    expect(plan.deleteIds.sort()).toEqual(["dec", "mar", "r27"]);
    expect(insertDates(plan)).toEqual(["2026-03-01", "2026-12-01", "2027-03-01", "2027-12-01"]);
  });

  it("with no rows yet everything is inserted", () => {
    const plan = planScheduleRefresh([], new Set(), [gen("2026-03-01", "First half")]);
    expect(plan).toEqual({ deleteIds: [], inserts: [gen("2026-03-01", "First half")] });
  });
});

// ---------------------------------------------------------------- lease term

const huntingLease = (over: Partial<LeaseLike> = {}): LeaseLike => ({
  lease_type: "hunting",
  rent_structure: null,
  terms: { hunt_basis: "lump_sum", amount: 10000 },
  payment_schedule: [{ label: "Annual payment", month: 7, day: 1, percent: 100 }],
  start_date: "2026-07-01",
  end_date: "2027-06-30",
  ...over,
});
const cashLease = (over: Partial<LeaseLike> = {}): LeaseLike => ({
  lease_type: "agricultural",
  rent_structure: "cash",
  terms: { cash_basis: "lump_sum", lump_sum: 10000 },
  payment_schedule: [],
  start_date: "2026-01-01",
  end_date: "2026-12-31",
  ...over,
});
const dues = (lease: LeaseLike) =>
  generateLeasePayments(lease, 0, new Map()).map((r) => `${r.due_date} ${r.expected_amount}`);

describe("installments stay inside the lease term", () => {
  it("a July-to-June hunting lease owes one payment, not one per calendar year it touches", () => {
    // 2027-07-01 would fall due the day after the lease ended.
    expect(dues(huntingLease())).toEqual(["2026-07-01 10000"]);
    expect(rentDueYears(huntingLease())).toEqual([2026]);
    expect(rentShareDue(huntingLease(), 2026, 10000)).toBe(1);
    expect(rentShareDue(huntingLease(), 2027, 10000)).toBe(0);
  });

  it("the same lease paid each January 1 owes the one that falls inside the term", () => {
    const lease = huntingLease({ payment_schedule: [{ label: "Annual payment", month: 1, day: 1, percent: 100 }] });
    expect(dues(lease)).toEqual(["2027-01-01 10000"]);
  });

  it("a two-year July-to-June lease owes two payments, not three", () => {
    expect(dues(huntingLease({ end_date: "2028-06-30" }))).toEqual(["2026-07-01 10000", "2027-07-01 10000"]);
  });

  it("the due date is inclusive at both ends of the term", () => {
    const lease = huntingLease({ start_date: "2026-07-01", end_date: "2027-07-01" });
    expect(dues(lease)).toEqual(["2026-07-01 10000", "2027-07-01 10000"]);
  });

  it("a split schedule keeps only the halves due inside the term", () => {
    const lease = huntingLease({
      payment_schedule: [
        { label: "Spring", month: 3, day: 1, percent: 50 },
        { label: "Fall", month: 9, day: 1, percent: 50 },
      ],
    });
    // 2026-03-01 is before the start and 2027-09-01 is after the end.
    expect(dues(lease)).toEqual(["2026-09-01 5000", "2027-03-01 5000"]);
    expect(rentShareDue(lease, 2026, 10000)).toBe(0.5);
    expect(rentShareDue(lease, 2027, 10000)).toBe(0.5);
  });

  it("a lease running February through December keeps its year's rent under any schedule", () => {
    // The live leases: nothing about them may change. With no schedule the
    // one annual payment is dated January 1, before the February start; it
    // is the lease's only year of rent, so it stays.
    const feb = { start_date: "2026-02-01", end_date: "2026-12-31" };
    expect(dues(cashLease(feb))).toEqual(["2026-01-01 10000"]);
    expect(rentShareDue(cashLease(feb), 2026, 10000)).toBe(1);
    const split = cashLease({
      ...feb,
      payment_schedule: [
        { label: "First half", month: 1, day: 15, percent: 50 },
        { label: "Second half", month: 12, day: 1, percent: 50 },
      ],
    });
    expect(dues(split)).toEqual(["2026-01-15 5000", "2026-12-01 5000"]);
    expect(rentShareDue(split, 2026, 10000)).toBe(1);
  });

  it("a lease that starts after the payment date still owes its first year", () => {
    // February 2026 through December 2027 is two lease years: the January 1
    // payment of the first year predates the start but is still owed.
    const lease = cashLease({ start_date: "2026-02-01", end_date: "2027-12-31" });
    expect(dues(lease)).toEqual(["2026-01-01 10000", "2027-01-01 10000"]);
    expect(rentDueYears(lease)).toEqual([2026, 2027]);
  });

  it("lists the installments that fall outside the lease dates, for the form to show", () => {
    // July-to-June, halves due March 1 and September 1.
    const lease = huntingLease({
      payment_schedule: [
        { label: "Spring", month: 3, day: 1, percent: 50 },
        { label: "Fall", month: 9, day: 1, percent: 50 },
      ],
    });
    expect(installmentsOutsideTerm(lease)).toEqual([
      { label: "Spring", due_date: "2026-03-01", when: "before_start" },
      { label: "Fall", due_date: "2027-09-01", when: "after_end" },
    ]);
    // A lease ending November 30 with rent due December 1: that payment
    // is not expected, and the form says so rather than dropping it silently.
    const short = cashLease({
      start_date: "2026-03-01",
      end_date: "2026-11-30",
      payment_schedule: [{ label: "Rent", month: 12, day: 1, percent: 100 }],
    });
    expect(dues(short)).toEqual([]);
    expect(installmentsOutsideTerm(short)).toEqual([
      { label: "Rent", due_date: "2026-12-01", when: "after_end" },
    ]);
    // Nothing to report when every installment is expected.
    expect(installmentsOutsideTerm(cashLease())).toEqual([]);
    expect(installmentsOutsideTerm(cashLease({ start_date: "2026-02-01" }))).toEqual([]);
    expect(installmentsOutsideTerm(cashLease({ start_date: null }))).toEqual([]);
  });

  it("calendar-year leases are unchanged", () => {
    const lease = cashLease({
      end_date: "2027-12-31",
      payment_schedule: [
        { label: "First half", month: 3, day: 1, percent: 50 },
        { label: "Second half", month: 12, day: 1, percent: 50 },
      ],
    });
    expect(dues(lease)).toEqual([
      "2026-03-01 5000",
      "2026-12-01 5000",
      "2027-03-01 5000",
      "2027-12-01 5000",
    ]);
  });
});

describe("schedule dates that do not exist", () => {
  it("clamps the day to the month's length", () => {
    const lease = cashLease({
      end_date: "2028-12-31",
      payment_schedule: [
        { label: "Winter", month: 2, day: 30, percent: 50 },
        { label: "Summer", month: 6, day: 31, percent: 50 },
      ],
    });
    expect(generateLeasePayments(lease, 0, new Map()).map((r) => r.due_date)).toEqual([
      "2026-02-28",
      "2026-06-30",
      "2027-02-28",
      "2027-06-30",
      "2028-02-29", // leap year
      "2028-06-30",
    ]);
  });

  it("February 29 becomes February 28 outside leap years", () => {
    const lease = cashLease({
      end_date: "2028-12-31",
      payment_schedule: [{ label: "Rent", month: 2, day: 29, percent: 100 }],
    });
    expect(generateLeasePayments(lease, 0, new Map()).map((r) => r.due_date)).toEqual([
      "2026-02-28",
      "2027-02-28",
      "2028-02-29",
    ]);
  });

  it("names the last real day of each month for the form", () => {
    expect(maxScheduleDay(2)).toBe(29);
    expect(maxScheduleDay(6)).toBe(30);
    expect(maxScheduleDay(12)).toBe(31);
    expect(scheduleProblem([{ label: "Rent", month: 6, day: 31, percent: 100 }])).toContain("June");
    expect(scheduleProblem([{ label: "Rent", month: 13, day: 1, percent: 100 }])).toContain("month");
    expect(scheduleProblem([{ label: "Rent", month: 2, day: 29, percent: 100 }])).toBeNull();
    expect(scheduleProblem([])).toBeNull();
  });
});

describe("schedule percentages", () => {
  const thirds = (pcts: number[]) =>
    cashLease({
      terms: { cash_basis: "lump_sum", lump_sum: 10035.02 },
      payment_schedule: pcts.map((percent, i) => ({ label: `Payment ${i + 1}`, month: 3 + i * 3, day: 1, percent })),
    });
  const total = (lease: LeaseLike) =>
    Math.round(generateLeasePayments(lease, 0, new Map()).reduce((s, r) => s + r.expected_amount, 0) * 100) / 100;

  it("the last installment takes the rounding remainder so the year adds up to the rent", () => {
    const rows = generateLeasePayments(thirds([33.33, 33.33, 33.33]), 0, new Map());
    expect(rows.map((r) => r.expected_amount)).toEqual([3344.67, 3344.67, 3345.68]);
    expect(total(thirds([33.33, 33.33, 33.33]))).toBe(10035.02); // was 10,034.01
    expect(total(thirds([33.33, 33.33, 33.34]))).toBe(10035.02);
  });

  it("two halves of an odd-cent rent add up exactly", () => {
    const lease = cashLease({
      terms: { cash_basis: "lump_sum", lump_sum: 10035.03 },
      payment_schedule: [
        { label: "First half", month: 3, day: 1, percent: 50 },
        { label: "Second half", month: 12, day: 1, percent: 50 },
      ],
    });
    expect(generateLeasePayments(lease, 0, new Map()).map((r) => r.expected_amount)).toEqual([5017.52, 5017.51]);
  });

  it("percentages that do not total 100 generate what they say and are flagged", () => {
    const lease = thirds([50, 40]);
    expect(generateLeasePayments(lease, 0, new Map()).map((r) => r.expected_amount)).toEqual([5017.51, 4014.01]);
    expect(schedulePercentTotal(lease.payment_schedule)).toEqual({ total: 90, full: false });
    expect(schedulePercentTotal(thirds([33.33, 33.33, 33.33]).payment_schedule)?.full).toBe(true);
    expect(schedulePercentTotal(thirds([50, 50]).payment_schedule)).toEqual({ total: 100, full: true });
    // Fixed dollar amounts (or no schedule) have no percent total to check.
    expect(schedulePercentTotal([{ label: "Rent", month: 3, day: 1, amount: 5000 }])).toBeNull();
    expect(schedulePercentTotal([])).toBeNull();
  });

  it("a year the term only partly covers keeps the amounts of the installments it has", () => {
    // Thirds on a July-to-June lease: the remainder still sits on the
    // third installment, whichever calendar year it lands in.
    const lease = cashLease({
      terms: { cash_basis: "lump_sum", lump_sum: 10035.02 },
      start_date: "2026-07-01",
      end_date: "2027-06-30",
      payment_schedule: [
        { label: "One", month: 2, day: 1, percent: 33.33 },
        { label: "Two", month: 8, day: 1, percent: 33.33 },
        { label: "Three", month: 11, day: 1, percent: 33.34 },
      ],
    });
    expect(dues(lease)).toEqual(["2026-08-01 3344.67", "2026-11-01 3345.68", "2027-02-01 3344.67"]);
    expect(total(lease)).toBe(10035.02);
  });

  it("fixed dollar installments are left exactly as entered", () => {
    const lease = cashLease({
      payment_schedule: [
        { label: "Spring", month: 3, day: 1, amount: 4000 },
        { label: "Fall", month: 11, day: 1, amount: 4000 },
      ],
    });
    expect(generateLeasePayments(lease, 0, new Map()).map((r) => r.expected_amount)).toEqual([4000, 4000]);
  });
});
