import { describe, expect, it } from "vitest";
import { attributeValue, guessKind, harvestIdentifiers, identifiersEqual, normalizeIdentifier, printedIdentifier } from "./taxIdentifiers";

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

describe("harvestIdentifiers with registry mappings (migration 0042)", () => {
  // The Colbert County record for Cottontown's 269-acre parcel exactly
  // as the KCS layer returned it on 2026-09-08 (PPIN is a double there).
  const colbert = {
    OBJECTID: 11938,
    PARCEL_NO: "1107260000001000",
    PIN: "2661",
    PPIN: 2661,
    PARCELID: "1107260000001000",
    ParcelID_GISlink: "11 07 26 0 000 001.000",
    Owner: "ALBEMARLE CORP/ THE",
    DeededAcres: 0,
    CalcAcres: 269,
    PIN_PID: "2661.00000000, 1107260000001000",
    acctNum: "1234",
    TaxYearDue: 2026,
    TotalTaxDue: 441.1,
  };
  it("stores the mapped PPIN and PIN under their kinds, then sweeps the rest by name", () => {
    const ids = harvestIdentifiers(colbert, {
      parcelField: "ParcelID_GISlink",
      identifierFields: [
        { field: "PPIN", kind: "ppin" },
        { field: "PIN", kind: "pin" },
      ],
    });
    const byKind = Object.fromEntries(ids.map((i) => [i.kind, i.value]));
    expect(byKind.ppin).toBe("2661");
    expect(byKind.pin).toBe("2661");
    expect(byKind.parcel_number).toBe("11 07 26 0 000 001.000"); // the parcel field; PARCEL_NO dedupes onto it
    expect(byKind.account_number).toBe("1234");
    // The parcel field mirrors by trigger; the composite PIN_PID and the
    // tax figures are not identifiers.
    expect(ids.some((i) => i.label === "PIN_PID" || i.label === "TotalTaxDue" || i.label === "TaxYearDue")).toBe(false);
    // Mapped first, so the statement's PPIN 2661 matches kind-aware.
    expect(ids[0]).toEqual({ label: "PPIN", kind: "ppin", value: "2661", normalized: "2661" });
  });
  it("prints a numeric PPIN without a decimal tail and finds the same PPIN by name when unmapped", () => {
    expect(attributeValue(2661)).toBe("2661");
    expect(attributeValue("2661.00000000")).toBe("2661");
    const unmapped = harvestIdentifiers(colbert, { parcelField: "ParcelID_GISlink" });
    expect(unmapped.find((i) => i.kind === "ppin")?.value).toBe("2661");
  });
});
