import { describe, expect, it } from "vitest";
import {
  spatialSuggestions,
  verifyMatches,
  type MatchableParcel,
  type MatchableProperty,
  type SpatialEvidence,
} from "./documentMatch";

const properties: MatchableProperty[] = [
  { id: "river", name: "River Place", county: "Lawrence", state: "AL", fsa_numbers: ["1234"], acres: 120 },
  { id: "home", name: "Home Place", county: "Lawrence", state: "AL", fsa_numbers: [], acres: 80 },
  { id: "hill", name: "Hill Tract", county: "Morgan", state: "AL", fsa_numbers: [], acres: 40 },
];
const parcels: MatchableParcel[] = [
  { id: "p1", property_id: "river", parcel_number: "12-03-07-0-000-004.000", county: "Lawrence" },
  { id: "p2", property_id: "home", parcel_number: "12-03-08-0-000-001.000", county: "Lawrence" },
];

const computed = (matches: SpatialEvidence["matches"]): SpatialEvidence => ({
  reference_label: "Sec 12, T4S R8W, Huntsville PM",
  described_acres: 40,
  computed: true,
  matches,
  notes: [],
});

describe("spatial suggestions", () => {
  it("shows nothing unless the intersection actually computed", () => {
    expect(spatialSuggestions(null, properties, parcels)).toEqual([]);
    expect(spatialSuggestions({ notes: ["timed out"] }, properties, parcels)).toEqual([]);
    expect(
      spatialSuggestions({ computed: false, matches: [{ entity_type: "property", id: "river", name: "River Place", overlap_acres: 30, pct_of_described: 75, pct_of_boundary: 25 }] }, properties, parcels)
    ).toEqual([]);
  });

  it("scores a strong overlap 80 and a partial one 60, with the why line", () => {
    const out = spatialSuggestions(
      computed([
        { entity_type: "property", id: "river", name: "River Place", overlap_acres: 37.6, pct_of_described: 94, pct_of_boundary: 31.3 },
        { entity_type: "property", id: "home", name: "Home Place", overlap_acres: 2.4, pct_of_described: 6, pct_of_boundary: 3 },
        { entity_type: "property", id: "hill", name: "Hill Tract", overlap_acres: 0.4, pct_of_described: 1, pct_of_boundary: 1 },
      ]),
      properties,
      parcels
    );
    expect(out.map((s) => [s.propertyId, s.score])).toEqual([
      ["river", 80],
      ["home", 60],
    ]);
    expect(out[0].reasons[0]).toBe(
      "describes land in Sec 12, T4S R8W, Huntsville PM, overlapping River Place (94% of described area)"
    );
  });

  it("maps parcel overlaps to their property without double counting", () => {
    const out = spatialSuggestions(
      computed([
        { entity_type: "parcel", id: "p1", name: "12-03-07-0-000-004.000", overlap_acres: 38, pct_of_described: 95, pct_of_boundary: 60 },
        { entity_type: "property", id: "river", name: "River Place", overlap_acres: 38, pct_of_described: 95, pct_of_boundary: 31 },
      ]),
      properties,
      parcels
    );
    expect(out).toHaveLength(1);
    expect(out[0].propertyId).toBe("river");
    expect(out[0].score).toBe(80);
  });
});

describe("verifyMatches with spatial evidence", () => {
  it("agreement: parcel signal and overlap on the same property preselects it", () => {
    const v = verifyMatches(
      [{ name: "River Place", confidence: "high", signal: "parcel", value: "12-03-07-0-000-004.000", reason: "parcel on page" }],
      { parcel_numbers: ["12-03-07-0-000-004.000"] },
      properties,
      parcels,
      [],
      null,
      {},
      computed([{ entity_type: "property", id: "river", name: "River Place", overlap_acres: 37.6, pct_of_described: 94, pct_of_boundary: 31 }])
    );
    expect(v.conflict).toBe(false);
    expect(v.preselect).toEqual(["river"]);
    expect(v.verified[0].propertyId).toBe("river");
    expect(v.verified[0].reasons).toHaveLength(2);
  });

  it("conflict: parcel names one property, the description overlaps only another; both shown, nothing preselected", () => {
    const v = verifyMatches(
      [{ name: "River Place", confidence: "high", signal: "parcel", value: "12-03-07-0-000-004.000", reason: "parcel on page" }],
      { parcel_numbers: ["12-03-07-0-000-004.000"] },
      properties,
      parcels,
      [],
      null,
      {},
      computed([{ entity_type: "property", id: "home", name: "Home Place", overlap_acres: 36, pct_of_described: 90, pct_of_boundary: 45 }])
    );
    expect(v.conflict).toBe(true);
    expect(v.preselect).toEqual([]);
    expect(v.verified.map((s) => s.propertyId).sort()).toEqual(["home", "river"]);
  });

  it("multi-property overlap preselects every property at or above 5 percent", () => {
    const v = verifyMatches(
      [],
      null,
      properties,
      parcels,
      [],
      null,
      {},
      computed([
        { entity_type: "property", id: "river", name: "River Place", overlap_acres: 24, pct_of_described: 60, pct_of_boundary: 20 },
        { entity_type: "property", id: "home", name: "Home Place", overlap_acres: 14, pct_of_described: 35, pct_of_boundary: 17 },
        { entity_type: "property", id: "hill", name: "Hill Tract", overlap_acres: 1, pct_of_described: 2, pct_of_boundary: 2 },
      ])
    );
    expect(v.conflict).toBe(false);
    expect(v.preselect.sort()).toEqual(["home", "river"]);
  });

  it("without computed spatial evidence the old rules stand", () => {
    const v = verifyMatches(
      [{ name: "River Place", confidence: "high", signal: "parcel", value: "12-03-07-0-000-004.000", reason: "parcel on page" }],
      { parcel_numbers: ["12-03-07-0-000-004.000"] },
      properties,
      parcels,
      [],
      null,
      {},
      { notes: ["resolved to Baldwin County, deed says Lawrence"] }
    );
    expect(v.conflict).toBe(false);
    expect(v.preselect).toEqual(["river"]);
    expect(v.verified).toHaveLength(1);
  });
});
