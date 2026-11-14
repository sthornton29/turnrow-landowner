import { describe, expect, it } from "vitest";
import { readLineValues, valuesFound } from "./taxLineValues";

describe("valuesFound", () => {
  it("keeps only the values a read found, so a second read cannot erase an earlier value", () => {
    // First read found the market value; reading again missed it but
    // found the district. Only the district may be written.
    const second = readLineValues({ market_value: null, current_use_value: null, tax_district: "01", millage: 30 });
    expect(valuesFound(second)).toEqual({ tax_district: "01", millage: 30 });
    expect("market_value" in valuesFound(second)).toBe(false);
  });
  it("keeps a real zero", () => {
    expect(valuesFound(readLineValues({ improvement_value: 0 }))).toEqual({ improvement_value: 0 });
  });
});
