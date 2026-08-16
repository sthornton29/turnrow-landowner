import { describe, expect, it } from "vitest";
import { buildWhere } from "./gisServer";

describe("buildWhere parcel search", () => {
  it("matches digits-only input against formatted county fields", () => {
    const where = buildWhere("parcel", "0204180000007000", "Owner", "PARCELID");
    // As typed, plus an any-separator pattern that catches
    // "02 04 18 0 000 007.000" and "02-04-18-0-000-007.000".
    expect(where).toContain("LIKE '%0204180000007000%'");
    expect(where).toContain(
      "LIKE '%0%2%0%4%1%8%0%0%0%0%0%0%7%0%0%0%'"
    );
    expect(where.split(" OR ")).toHaveLength(2);
  });

  it("matches formatted input against digits-only county fields", () => {
    const where = buildWhere(
      "parcel",
      "02 04 18 0 000 007.000",
      "Owner",
      "ParcelNum"
    );
    expect(where).toContain("LIKE '%02 04 18 0 000 007.000%'");
    expect(where).toContain("LIKE '%0204180000007000%'");
    expect(where.split(" OR ")).toHaveLength(3);
  });

  it("keeps short fragments as plain contains searches", () => {
    const where = buildWhere("parcel", "007", "Owner", "PARCELID");
    expect(where).toBe("UPPER(PARCELID) LIKE '%007%'");
  });

  it("escapes quotes and leaves owner searches unchanged", () => {
    expect(buildWhere("owner", "O'NEAL", "Owner", "PARCELID")).toBe(
      "UPPER(Owner) LIKE '%O''NEAL%'"
    );
  });
});
