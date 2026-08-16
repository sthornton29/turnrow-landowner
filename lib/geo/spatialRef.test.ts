import { describe, expect, it } from "vitest";
import type { Polygon } from "geojson";
import { ensureWgs84, isPlausiblyLatLon, webMercatorToWgs84 } from "./spatialRef";

// A real northwest Alabama location in both spatial references.
const LON = -87.9718;
const LAT = 34.7903;
// Web Mercator meters for the same point (x = lon * R * pi/180, etc.)
const MERC_X = -9792976.0;
const MERC_Y = 4135420.1;

const latLonSquare: Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [LON, LAT],
      [LON + 0.01, LAT],
      [LON + 0.01, LAT + 0.01],
      [LON, LAT + 0.01],
      [LON, LAT],
    ],
  ],
};

const mercatorSquare: Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [MERC_X, MERC_Y],
      [MERC_X + 1000, MERC_Y],
      [MERC_X + 1000, MERC_Y + 1000],
      [MERC_X, MERC_Y + 1000],
      [MERC_X, MERC_Y],
    ],
  ],
};

describe("isPlausiblyLatLon", () => {
  it("accepts real lat/lon geometry", () => {
    expect(isPlausiblyLatLon(latLonSquare)).toBe(true);
  });

  it("rejects Web Mercator meters", () => {
    expect(isPlausiblyLatLon(mercatorSquare)).toBe(false);
  });
});

describe("webMercatorToWgs84", () => {
  it("recovers the original lon/lat within rounding", () => {
    const fixed = webMercatorToWgs84(mercatorSquare) as Polygon;
    const [lon, lat] = fixed.coordinates[0][0];
    expect(lon).toBeCloseTo(LON, 3);
    expect(lat).toBeCloseTo(LAT, 3);
  });
});

describe("ensureWgs84", () => {
  it("leaves good geometry untouched", () => {
    const result = ensureWgs84(latLonSquare);
    expect(result.reprojected).toBe(false);
    expect(result.geometry).toBe(latLonSquare);
  });

  it("repairs Web Mercator geometry and says so", () => {
    const result = ensureWgs84(mercatorSquare);
    expect(result.reprojected).toBe(true);
    expect(isPlausiblyLatLon(result.geometry)).toBe(true);
  });
});
