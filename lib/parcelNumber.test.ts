import { describe, expect, it } from "vitest";
import { canonicalParcel, parcelKey, parcelsEqual } from "./parcelNumber";

describe("parcel number canonical form", () => {
  const stored = "07 09 31 0 000 003.000";
  it("matches the tax statement's trailing -0 suffix", () => {
    expect(parcelsEqual(stored, "07-09-31-0-000-003.000-0")).toBe(true);
    expect(parcelsEqual(stored, "07-09-31-0-000-003.000.0")).toBe(true);
  });
  it("matches dashed, spaced, and shorthand forms", () => {
    expect(parcelsEqual(stored, "07-09-31-0-000-003.000")).toBe(true);
    expect(parcelsEqual(stored, "07-09-31-0-000-003")).toBe(true);
    expect(parcelsEqual(stored, "7 9 31 0 0 3")).toBe(true);
  });
  it("keeps a real sub-parcel distinct", () => {
    expect(parcelsEqual(stored, "07-09-31-0-000-003.001")).toBe(false);
    expect(parcelsEqual("07 09 29 0 200 001.000", "07 09 29 0 200 001.003")).toBe(false);
  });
  it("keeps interior zeros", () => {
    expect(parcelsEqual("07 09 31 0 000 003.000", "07 09 31 0 200 003.000")).toBe(false);
    expect(canonicalParcel(stored)).toBe("7-9-31-0-0-3");
  });
  it("matches a run-together printing by compact key", () => {
    expect(parcelKey("120307 0 000 004.000")).toBe(parcelKey("12-03-07-0-000-004.000"));
    expect(parcelKey("07-09-31-0-000-003.000-0")).toBe(parcelKey("07 09 31 0 000 003.000"));
  });
  it("never equates empties", () => {
    expect(parcelsEqual("", "")).toBe(false);
    expect(parcelKey(null)).toBe("");
  });
});
