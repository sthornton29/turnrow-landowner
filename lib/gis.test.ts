import { describe, expect, it } from "vitest";
import { bboxesIntersect, serviceExtent, type CountyGisService, type LonLatBbox } from "./gis";

const base: CountyGisService = {
  id: "svc-1",
  state: "AL",
  county: "Lawrence",
  display_name: "Lawrence County, AL",
  service_url: "https://example.test/arcgis/rest/services/Parcels/MapServer",
  layer_id: 0,
  parcel_field: "PARCELNO",
  owner_field: "OWNER",
  acres_field: null,
  situs_field: null,
  status: "active",
  last_verified_at: null,
  notes: null,
  extent_xmin: -87.53,
  extent_ymin: 34.3,
  extent_xmax: -86.94,
  extent_ymax: 34.85,
  identifier_fields: [],
};

describe("serviceExtent", () => {
  it("returns the [w, s, e, n] extent when all four columns are set", () => {
    expect(serviceExtent(base)).toEqual([-87.53, 34.3, -86.94, 34.85]);
  });

  it("returns null when any extent column is null (un-reverified service)", () => {
    expect(serviceExtent({ ...base, extent_xmin: null })).toBeNull();
    expect(serviceExtent({ ...base, extent_ymax: null })).toBeNull();
  });
});

describe("bboxesIntersect", () => {
  const lawrence: LonLatBbox = [-87.53, 34.3, -86.94, 34.85];

  it("intersects an overlapping viewport", () => {
    expect(bboxesIntersect(lawrence, [-87.4, 34.5, -87.2, 34.6])).toBe(true);
  });

  it("intersects a viewport straddling the county line (partial overlap)", () => {
    // Straddles the western edge, so a Colbert viewport still catches
    // the Lawrence service and both counties serve one screen.
    expect(bboxesIntersect(lawrence, [-87.7, 34.5, -87.45, 34.6])).toBe(true);
  });

  it("rejects a disjoint viewport", () => {
    expect(bboxesIntersect(lawrence, [-86.5, 34.5, -86.3, 34.6])).toBe(false);
    expect(bboxesIntersect(lawrence, [-87.4, 35.0, -87.2, 35.2])).toBe(false);
  });

  it("counts a shared edge as touching", () => {
    expect(bboxesIntersect(lawrence, [-86.94, 34.5, -86.8, 34.6])).toBe(true);
  });

  it("intersects when one box contains the other", () => {
    expect(bboxesIntersect(lawrence, [-88, 34, -86, 35])).toBe(true);
    expect(bboxesIntersect([-88, 34, -86, 35], lawrence)).toBe(true);
  });
});
