import { describe, expect, it } from "vitest";
import { spatialSuggestions, verifyMatches, type MatchableParcel, type MatchableProperty, type SpatialEvidence } from "./documentMatch";

// Stuart's real case: a deed for "a portion ... south and west of Sandy
// Branch in Section 31, T4S R7W, containing 120 acres" plots as the
// whole section; the section holds one property and three parcels, one
// of them 118.1 acres.
const properties: MatchableProperty[] = [
  { id: "shop", name: "Shop Area", county: "Lawrence", state: "AL", fsa_numbers: null, acres: 1689, aliases: ["View Celeste"] },
  { id: "phin", name: "Phinizy", county: "Lawrence", state: "AL", fsa_numbers: null, acres: 83, aliases: null },
];
const parcels: MatchableParcel[] = [
  { id: "p1", property_id: "shop", parcel_number: "07 09 31 0 000 001.000" },
  { id: "p3", property_id: "shop", parcel_number: "07 09 31 0 000 003.000" },
  { id: "p16", property_id: "shop", parcel_number: "07 09 31 0 200 016.000" },
];
const wholeSection: SpatialEvidence = {
  computed: true,
  whole_section: true,
  stated_acres: 120,
  reference_label: "Sec 31, T4S R7W, Huntsville PM",
  matches: [
    { entity_type: "property", id: "shop", name: "Shop Area", overlap_acres: 399.6, pct_of_described: 61.9, pct_of_boundary: 23.7 },
    { entity_type: "parcel", id: "p1", name: "07 09 31 0 000 001.000", overlap_acres: 184.4, pct_of_described: 28.6, pct_of_boundary: 97.3 },
    { entity_type: "parcel", id: "p3", name: "07 09 31 0 000 003.000", overlap_acres: 118.1, pct_of_described: 18.3, pct_of_boundary: 100 },
    { entity_type: "parcel", id: "p16", name: "07 09 31 0 200 016.000", overlap_acres: 95.3, pct_of_described: 14.8, pct_of_boundary: 98.1 },
    { entity_type: "property", id: "phin", name: "Phinizy", overlap_acres: 40, pct_of_described: 6.2, pct_of_boundary: 48 },
  ],
};

describe("parcel fit on a whole-section tract", () => {
  it("names the parcel whose acreage fits the stated acres", () => {
    const s = spatialSuggestions(wholeSection, properties, parcels);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ propertyId: "shop", parcelId: "p3", score: 85 });
    expect(s[0].reasons[0]).toContain("07 09 31 0 000 003.000");
    expect(s[0].reasons[0]).toContain("120 acres");
  });
  it("falls back to shares when no parcel fits, pre-checking only the largest", () => {
    const s = spatialSuggestions({ ...wholeSection, stated_acres: 300 }, properties, parcels);
    expect(s.map((x) => [x.propertyId, x.score])).toEqual([["shop", 80], ["phin", 60]]);
    const v = verifyMatches([], null, properties, parcels, [], null, {}, { ...wholeSection, stated_acres: 300 });
    expect(v.preselect).toEqual(["shop"]);
  });
  it("pre-checks every overlap for a quarter-chain tract", () => {
    const v = verifyMatches([], null, properties, parcels, [], null, {}, { ...wholeSection, whole_section: false, stated_acres: null });
    expect(new Set(v.preselect)).toEqual(new Set(["shop", "phin"]));
  });
  it("carries the parcel onto the verified suggestion", () => {
    const v = verifyMatches([], null, properties, parcels, [], null, {}, wholeSection);
    expect(v.verified[0]).toMatchObject({ propertyId: "shop", parcelId: "p3" });
  });
});

describe("learned aliases", () => {
  it("verifies a name claim through an alias", () => {
    const v = verifyMatches(
      [{ name: "Shop Area", confidence: "high", signal: "name", value: "View Celeste" }],
      { place_names: ["View Celeste", "Sandy Branch"] },
      properties,
      parcels
    );
    expect(v.verified[0]?.propertyId).toBe("shop");
    expect(v.verified[0]?.reasons[0]).toContain("View Celeste");
  });
  it("finds an alias on the page with no claim at all", () => {
    const v = verifyMatches([], { place_names: ["the View Celeste tract"] }, properties, parcels);
    expect(v.verified.map((x) => x.propertyId)).toEqual(["shop"]);
    expect(v.preselect).toEqual(["shop"]);
  });
});
