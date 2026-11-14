import { describe, expect, it } from "vitest";
import type { Geometry, MultiPolygon } from "geojson";
import { bboxOf, fitBoundsOf, isLngLat, isLngLatGeometry, stripToXY } from "./normalize";

// A field near Courtland, in longitude/latitude.
const field: MultiPolygon = {
  type: "MultiPolygon",
  coordinates: [[[[-87.31, 34.65], [-87.3, 34.65], [-87.3, 34.66], [-87.31, 34.66], [-87.31, 34.65]]]],
};
// The same sort of field in Alabama West state plane feet (no .prj).
const statePlane: MultiPolygon = {
  type: "MultiPolygon",
  coordinates: [[[[1905123.4, 1712345.6], [1906123.4, 1712345.6], [1906123.4, 1713345.6], [1905123.4, 1712345.6]]]],
};

describe("isLngLat", () => {
  it("accepts the whole globe and nothing past it", () => {
    expect(isLngLat(-87.31, 34.65)).toBe(true);
    expect(isLngLat(-180, -90)).toBe(true);
    expect(isLngLat(180, 90)).toBe(true);
    expect(isLngLat(-180.0001, 0)).toBe(false);
    expect(isLngLat(0, 90.0001)).toBe(false);
    expect(isLngLat(1905123.4, 1712345.6)).toBe(false);
  });
  it("turns away anything that is not a finite number", () => {
    expect(isLngLat(Number.NaN, 34)).toBe(false);
    expect(isLngLat(-87, Number.POSITIVE_INFINITY)).toBe(false);
    expect(isLngLat("-87", 34)).toBe(false);
    expect(isLngLat(undefined, undefined)).toBe(false);
  });
});

describe("isLngLatGeometry", () => {
  it("passes longitude/latitude shapes of every kind", () => {
    expect(isLngLatGeometry(field)).toBe(true);
    expect(isLngLatGeometry({ type: "Point", coordinates: [-87.3, 34.65] })).toBe(true);
    expect(isLngLatGeometry({ type: "MultiLineString", coordinates: [[[-87.31, 34.65], [-87.3, 34.66]]] })).toBe(true);
  });
  it("fails a shape in feet or meters, even when only one point is off", () => {
    expect(isLngLatGeometry(statePlane)).toBe(false);
    // Web Mercator meters for the same place.
    expect(isLngLatGeometry({ type: "Point", coordinates: [-9719300.5, 4116200.2] })).toBe(false);
    expect(
      isLngLatGeometry({ type: "LineString", coordinates: [[-87.31, 34.65], [-87.3, 3466000]] })
    ).toBe(false);
  });
  it("fails a missing or empty geometry", () => {
    expect(isLngLatGeometry(null)).toBe(false);
    expect(isLngLatGeometry({ type: "MultiPolygon", coordinates: [] })).toBe(false);
  });
});

describe("fitBoundsOf", () => {
  it("matches bboxOf for ordinary shapes", () => {
    expect(fitBoundsOf([field])).toEqual(bboxOf([field]));
    expect(fitBoundsOf([field])).toEqual([-87.31, 34.65, -87.3, 34.66]);
  });
  it("leaves out a shape that is not longitude/latitude, so the rest still fits", () => {
    // bboxOf is stretched into the millions (Mapbox would throw on it).
    expect(bboxOf([field, statePlane])?.[3]).toBeGreaterThan(90);
    expect(fitBoundsOf([field, statePlane])).toEqual([-87.31, 34.65, -87.3, 34.66]);
  });
  it("is null when nothing usable is left", () => {
    expect(fitBoundsOf([statePlane])).toBeNull();
    expect(fitBoundsOf([null, undefined])).toBeNull();
    expect(fitBoundsOf([])).toBeNull();
  });
});

describe("stripToXY", () => {
  it("drops the altitude from every position and keeps the shape", () => {
    const withAltitude: Geometry = {
      type: "MultiPolygon",
      coordinates: [[[[-87.31, 34.65, 181.2], [-87.3, 34.65, 180], [-87.3, 34.66, 0], [-87.31, 34.65, 181.2]]]],
    };
    expect(stripToXY(withAltitude)).toEqual({
      type: "MultiPolygon",
      coordinates: [[[[-87.31, 34.65], [-87.3, 34.65], [-87.3, 34.66], [-87.31, 34.65]]]],
    });
    expect(stripToXY({ type: "Point", coordinates: [-87.3, 34.65, 12] })).toEqual({
      type: "Point",
      coordinates: [-87.3, 34.65],
    });
    expect(
      stripToXY({ type: "MultiLineString", coordinates: [[[-87.31, 34.65, 0], [-87.3, 34.66, 0]]] })
    ).toEqual({ type: "MultiLineString", coordinates: [[[-87.31, 34.65], [-87.3, 34.66]]] });
  });
  it("leaves two-dimensional shapes as they are and never edits the input", () => {
    const before = JSON.stringify(field);
    expect(stripToXY(field)).toEqual(field);
    expect(JSON.stringify(field)).toBe(before);
  });
});
