import { describe, expect, it } from "vitest";
import {
  annualRent,
  cropAssumptions,
  generateLeasePayments,
  govPaymentTreatment,
  govTreatmentSentence,
  isGovShareLabel,
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
