import { describe, expect, it } from "vitest";
import {
  annualRent,
  cropAssumptions,
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
