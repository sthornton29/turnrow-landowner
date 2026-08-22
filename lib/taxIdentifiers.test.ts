import { describe, expect, it } from "vitest";
import { guessKind, harvestIdentifiers, identifiersEqual, normalizeIdentifier, printedIdentifier } from "./taxIdentifiers";

describe("identifier normalizer", () => {
  it("treats spaces, dashes, dots, and leading zeros as equivalent", () => {
    expect(identifiersEqual("07 09 31 0 000 003.000", "07-09-31-0-000-003.000-0")).toBe(true);
    expect(identifiersEqual("0012345", "12345")).toBe(true);
    expect(identifiersEqual("12 345", "12-345")).toBe(true);
    expect(normalizeIdentifier("07-09-31-0-000-003.000")).toBe("7-9-31-0-0-3");
  });
  it("keeps real differences", () => {
    expect(identifiersEqual("12345", "12346")).toBe(false);
    expect(identifiersEqual("", "")).toBe(false);
  });
});

describe("guessKind", () => {
  it("reads printed labels", () => {
    expect(guessKind("PPIN")).toBe("ppin");
    expect(guessKind("Parcel No.")).toBe("parcel_number");
    expect(guessKind("Account Number")).toBe("account_number");
    expect(guessKind("Receipt #")).toBe("receipt_number");
    expect(guessKind("Key Number")).toBe("key_number");
    expect(guessKind("Folio")).toBe("folio");
    expect(guessKind("Alt Key")).toBe("alt_key");
    expect(guessKind("Geo ID")).toBe("geo_id");
    expect(guessKind("Property ID")).toBe("property_id");
    expect(guessKind("Schedule No")).toBe("schedule_number");
    expect(guessKind("Duplicate Number")).toBe("duplicate_number");
    expect(guessKind("Bill Number")).toBe("bill_number");
    expect(guessKind("SBL")).toBe("sbl");
    expect(guessKind("TMK")).toBe("tmk");
    expect(guessKind("Control Map")).toBe("control_map");
    expect(guessKind("Assessment Number")).toBe("assessment_number");
    expect(guessKind("Something else")).toBe("other");
  });
  it("reads GIS field names", () => {
    expect(guessKind("ParcelID_Long")).toBe("parcel_number");
    expect(guessKind("PPIN")).toBe("ppin");
    expect(guessKind("PARID")).toBe("parcel_number");
    expect(guessKind("ALTKEY")).toBe("alt_key");
  });
});

describe("printedIdentifier", () => {
  it("keeps the value as printed and normalizes beside it", () => {
    expect(printedIdentifier("Parcel #", "parcel_number", " 07-09-31-0-000-003.000 ")).toEqual({
      label: "Parcel #",
      kind: "parcel_number",
      value: "07-09-31-0-000-003.000",
      normalized: "7-9-31-0-0-3",
    });
  });
  it("guesses the kind from the label when the AI's kind is unknown", () => {
    expect(printedIdentifier("PPIN", "mystery", "12345")?.kind).toBe("ppin");
    expect(printedIdentifier("Widget", "mystery", "12345")?.kind).toBe("other");
  });
  it("drops empties", () => {
    expect(printedIdentifier("x", "pin", "")).toBeNull();
  });
});

describe("harvestIdentifiers from county attributes", () => {
  it("harvests PPIN and the parcel field from a KCS feature", () => {
    const ids = harvestIdentifiers(
      {
        OBJECTID: 118,
        ParcelID_Long: "07 09 31 0 000 003.000",
        PPIN: 23891,
        Owner: "THE ALBEMARLE CORPORATION",
        DeededAcres: 118.1,
        TaxYear: 2024,
        Shape_Area: 123456.7,
      },
      { parcelField: "ParcelID_Long" }
    );
    expect(ids.map((i) => [i.kind, i.value])).toEqual([
      ["parcel_number", "07 09 31 0 000 003.000"],
      ["ppin", "23891"],
    ]);
  });
  it("ignores prose, acres, and names", () => {
    expect(harvestIdentifiers({ Owner: "SMITH JOHN 123", Acres: 12.5, LegalDesc: "SEC 31 T4S R7W 120 AC" })).toEqual([]);
  });
});
