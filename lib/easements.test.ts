import { describe, expect, it } from "vitest";
import { easementAcres } from "./assetTypes";

describe("easementAcres", () => {
  it("computes length x width in acres", () => {
    // One mile of 100 ft corridor: 5280 * 100 / 43560 = 12.121... ac
    expect(easementAcres(5280, 100)).toBeCloseTo(12.12, 2);
  });

  it("is null without a width or length", () => {
    expect(easementAcres(5280, null)).toBeNull();
    expect(easementAcres(null, 100)).toBeNull();
    expect(easementAcres(5280, 0)).toBeNull();
  });
});
