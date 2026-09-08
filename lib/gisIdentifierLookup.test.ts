import { describe, expect, it } from "vitest";
import { buildIdentifierLikeWhere, buildIdentifierWhere, isNumericFieldType } from "./gisServer";
import { guessIdentifierFields, identifierFieldsOf } from "./gis";

// The where clauses the live county lookup sends (migration 0042). The
// field TYPE decides the literal form: Colbert publishes PPIN as a
// double, where CAST(PPIN AS VARCHAR) = '2471' returned nothing and
// PPIN = 2471 returned the parcel (verified live 2026-09-08).
describe("buildIdentifierWhere", () => {
  it("asks a numeric column with bare literals, digit-only values only, leading zeros dropped", () => {
    expect(buildIdentifierWhere("PPIN", "esriFieldTypeDouble", ["2471", "002661", "12-34"])).toBe("PPIN IN (2471, 2661)");
    expect(buildIdentifierWhere("PPIN", "esriFieldTypeInteger", ["AB-12"])).toBeNull();
    expect(isNumericFieldType("esriFieldTypeOID")).toBe(true);
    expect(isNumericFieldType("esriFieldTypeString")).toBe(false);
  });
  it("asks a text column with the printed, compact, and unpadded forms, quotes escaped", () => {
    expect(buildIdentifierWhere("PIN", "esriFieldTypeString", ["12-345"])).toBe("UPPER(PIN) IN ('12-345', '12345')");
    expect(buildIdentifierWhere("PIN", "esriFieldTypeString", ["0042"])).toBe("UPPER(PIN) IN ('0042', '42')");
    expect(buildIdentifierWhere("PIN", "esriFieldTypeString", ["O'NEAL 1"])).toContain("'O''NEAL 1'");
    expect(buildIdentifierWhere("PIN", "esriFieldTypeString", [" ", ""])).toBeNull();
  });
  it("loosens to an interleaved LIKE on text columns only", () => {
    expect(buildIdentifierLikeWhere("PIN", "esriFieldTypeString", "12-345")).toBe("UPPER(PIN) LIKE '%1%2%3%4%5%'");
    expect(buildIdentifierLikeWhere("PPIN", "esriFieldTypeDouble", "12345")).toBeNull();
    expect(buildIdentifierLikeWhere("PIN", "esriFieldTypeString", "12")).toBeNull();
  });
});

describe("registry identifier mappings", () => {
  const fields = (...names: string[]) => names.map((name) => ({ name, type: "esriFieldTypeString", alias: null }));
  it("auto-detects the KCS names, skipping the parcel field and composites", () => {
    const g = guessIdentifierFields(fields("OBJECTID", "PARCEL_NO", "PIN", "PPIN", "ParcelID_GISlink", "PIN_PID", "acctNum", "Owner"), "ParcelID_GISlink");
    expect(g).toEqual([
      { field: "PPIN", kind: "ppin" },
      { field: "PIN", kind: "pin" },
      { field: "acctNum", kind: "account_number" },
    ]);
    // A layer whose parcel field IS the PIN maps nothing under pin.
    expect(guessIdentifierFields(fields("PIN", "OWNER"), "PIN")).toEqual([]);
  });
  it("cleans a stored mapping list: unknown kinds, blanks, the parcel kind, and duplicates drop", () => {
    expect(
      identifierFieldsOf({
        identifier_fields: [
          { field: "PPIN", kind: "ppin" },
          { field: "PPIN", kind: "pin" },
          { field: "X", kind: "nonsense" },
          { field: "", kind: "pin" },
          { field: "PARCELID", kind: "parcel_number" },
        ],
      })
    ).toEqual([{ field: "PPIN", kind: "ppin" }]);
    expect(identifierFieldsOf({})).toEqual([]);
    expect(identifierFieldsOf(null)).toEqual([]);
  });
});
