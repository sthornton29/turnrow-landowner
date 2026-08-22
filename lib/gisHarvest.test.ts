import { describe, expect, it } from "vitest";
import { harvestIdentifiers } from "./taxIdentifiers";

describe("harvesting identifiers from county features", () => {
  it("reads a KCS Lawrence feature: parcel number and PPIN", () => {
    const feature = {
      OBJECTID: 4411,
      ParcelID_Long: "07 09 31 0 000 003.000",
      PPIN: 23891,
      Owner: "THE ALBEMARLE CORPORATION",
      DeededAcres: 118.1,
      PropAddr1: "COUNTY RD 150",
      TaxYear: 2024,
      LandValue: 212000,
      Shape_Area: 477812.2,
      Shape_Length: 2901.4,
    };
    const ids = harvestIdentifiers(feature, { parcelField: "ParcelID_Long" });
    expect(ids.map((i) => [i.kind, i.value])).toEqual([
      ["parcel_number", "07 09 31 0 000 003.000"],
      ["ppin", "23891"],
    ]);
    expect(ids[1].label).toBe("PPIN");
  });
  it("reads a Florida-style feature: folio and alternate key", () => {
    const feature = { PARCELNO: "12-34-56-000-0010", FOLIO: "1234560000010", ALTKEY: 998877, OWNER: "SMITH JOHN", ACRES: 40 };
    const ids = harvestIdentifiers(feature, { parcelField: "PARCELNO" });
    expect(ids.map((i) => i.kind)).toEqual(["parcel_number", "folio", "alt_key"]);
  });
});
