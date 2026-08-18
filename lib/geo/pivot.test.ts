import { describe, expect, it } from "vitest";
import type { Polygon } from "geojson";
import { approxAcres, toMultiPolygon } from "./normalize";
import {
  bearingTo,
  compositeFromDetails,
  compositePivotGeometry,
  destination,
  detailsFromComposite,
  distanceFt,
  pivotPolygon,
  snapEndBearing,
  sweepDegrees,
  type CompositePivotParams,
} from "./pivot";

const CENTER: [number, number] = [-87.0, 34.5]; // north Alabama

const acresOf = (params: Parameters<typeof pivotPolygon>[0]) =>
  approxAcres(toMultiPolygon(pivotPolygon(params))!);

describe("bearing conventions", () => {
  it("bearing 0 lands due north of the center", () => {
    const north = destination(CENTER, 1000, 0);
    expect(north[0]).toBeCloseTo(CENTER[0], 8);
    expect(north[1]).toBeGreaterThan(CENTER[1]);
  });

  it("bearing 90 lands due east", () => {
    const east = destination(CENTER, 1000, 90);
    expect(east[1]).toBeCloseTo(CENTER[1], 8);
    expect(east[0]).toBeGreaterThan(CENTER[0]);
  });

  it("bearingTo inverts destination", () => {
    for (const bearing of [0, 45, 137, 270, 359]) {
      const point = destination(CENTER, 500, bearing) as [number, number];
      expect(bearingTo(CENTER, point)).toBeCloseTo(bearing, 1);
    }
  });

  it("distanceFt inverts destination", () => {
    const point = destination(CENTER, 396.24, 45) as [number, number]; // 1300 ft
    expect(distanceFt(CENTER, point)).toBeCloseTo(1300, 0);
  });
});

describe("pivotPolygon", () => {
  it("full circle acreage matches pi r squared", () => {
    // 1300 ft radius: pi * 1300^2 sq ft / 43560 = 121.9 acres
    const acres = acresOf({
      center: CENTER,
      radiusFt: 1300,
      fullCircle: true,
      startBearingDeg: null,
      endBearingDeg: null,
    });
    const expected = (Math.PI * 1300 * 1300) / 43560;
    expect(Math.abs(acres - expected) / expected).toBeLessThan(0.01);
  });

  it("a sector's area is full x sweep/360 within tolerance", () => {
    const full = acresOf({
      center: CENTER,
      radiusFt: 1300,
      fullCircle: true,
      startBearingDeg: null,
      endBearingDeg: null,
    });
    const half = acresOf({
      center: CENTER,
      radiusFt: 1300,
      fullCircle: false,
      startBearingDeg: 0,
      endBearingDeg: 180,
    });
    const threeQuarter = acresOf({
      center: CENTER,
      radiusFt: 1300,
      fullCircle: false,
      startBearingDeg: 90,
      endBearingDeg: 0, // clockwise 90 -> 0 = 270 degrees
    });
    expect(Math.abs(half - full / 2) / full).toBeLessThan(0.01);
    expect(Math.abs(threeQuarter - (full * 270) / 360) / full).toBeLessThan(0.01);
  });

  it("uses at least 64 steps on a full circle", () => {
    const poly = pivotPolygon({
      center: CENTER,
      radiusFt: 1000,
      fullCircle: true,
      startBearingDeg: null,
      endBearingDeg: null,
    });
    expect(poly.coordinates[0].length).toBeGreaterThanOrEqual(65);
  });
});

describe("sweepDegrees", () => {
  it("sweeps clockwise, handling wraparound", () => {
    expect(sweepDegrees(0, 180)).toBe(180);
    expect(sweepDegrees(270, 90)).toBe(180); // through north
    expect(sweepDegrees(90, 0)).toBe(270);
    expect(sweepDegrees(45, 45)).toBe(360);
  });
});

const FULL_1300_ACRES = (Math.PI * 1300 * 1300) / 43560;

const composite = (over: Partial<CompositePivotParams>): CompositePivotParams => ({
  center: CENTER,
  radiusFt: 1300,
  fullCircle: true,
  startBearingDeg: null,
  endBearingDeg: null,
  addPolygons: [],
  cutPolygons: [],
  ...over,
});

// A small square polygon centered a given distance/bearing from CENTER.
function square(atM: number, bearing: number, halfDeg: number): Polygon {
  const c = destination(CENTER, atM, bearing) as [number, number];
  return {
    type: "Polygon",
    coordinates: [[
      [c[0] - halfDeg, c[1] - halfDeg],
      [c[0] + halfDeg, c[1] - halfDeg],
      [c[0] + halfDeg, c[1] + halfDeg],
      [c[0] - halfDeg, c[1] + halfDeg],
      [c[0] - halfDeg, c[1] - halfDeg],
    ]],
  };
}

describe("compositePivotGeometry", () => {
  it("an add polygon outside the base grows gross watered acres", () => {
    // A corner lobe drawn beyond the circle edge.
    const lobe = square(1300 * 0.3048 + 200, 45, 0.0008);
    const lobeAcres = approxAcres(toMultiPolygon(lobe)!);
    const { grossAcres } = compositePivotGeometry(composite({ addPolygons: [lobe] }));
    const expected = FULL_1300_ACRES + lobeAcres;
    expect(Math.abs(grossAcres - expected) / expected).toBeLessThan(0.01);
  });

  it("an add polygon overlapping the base only counts the extra part", () => {
    // Entirely inside the circle: no change.
    const inside = square(100, 90, 0.0005);
    const { grossAcres } = compositePivotGeometry(
      composite({ addPolygons: [inside] })
    );
    expect(Math.abs(grossAcres - FULL_1300_ACRES) / FULL_1300_ACRES).toBeLessThan(0.01);
  });

  it("cut polygons reduce plantable acres but not gross watered acres", () => {
    const pond = square(0, 0, 0.001);
    const { grossAcres, plantableAcres, plantable } = compositePivotGeometry(
      composite({ cutPolygons: [pond] })
    );
    expect(Math.abs(grossAcres - FULL_1300_ACRES) / FULL_1300_ACRES).toBeLessThan(0.01);
    expect(plantableAcres).toBeLessThan(grossAcres);
    // The hole is real: the plantable polygon has an inner ring.
    const rings =
      plantable.type === "Polygon"
        ? plantable.coordinates.length
        : plantable.coordinates[0].length;
    expect(rings).toBeGreaterThan(1);
  });

  it("cuts also trim added lobes", () => {
    const lobe = square(1300 * 0.3048 + 150, 45, 0.0008);
    const cutOfLobe = square(1300 * 0.3048 + 150, 45, 0.0004); // inside the lobe
    const withLobe = compositePivotGeometry(composite({ addPolygons: [lobe] }));
    const trimmed = compositePivotGeometry(
      composite({ addPolygons: [lobe], cutPolygons: [cutOfLobe] })
    );
    expect(trimmed.grossAcres).toBeCloseTo(withLobe.grossAcres, 1);
    expect(trimmed.plantableAcres).toBeLessThan(withLobe.plantableAcres);
  });
});

describe("details round trip", () => {
  it("serializes and reads back the composite shape", () => {
    const lobe = square(500, 45, 0.0006);
    const pond = square(100, 180, 0.0004);
    const params = composite({
      fullCircle: false,
      startBearingDeg: 10,
      endBearingDeg: 190,
      addPolygons: [lobe],
      cutPolygons: [pond],
    });
    const details = detailsFromComposite(params);
    const back = compositeFromDetails(details)!;
    expect(back.radiusFt).toBe(1300);
    expect(back.startBearingDeg).toBe(10);
    expect(back.addPolygons).toHaveLength(1);
    expect(back.cutPolygons).toHaveLength(1);
    expect(back.addPolygons[0].coordinates).toEqual(lobe.coordinates);
  });

  it("reads pre-0015 details: legacy cutouts become cut polygons", () => {
    const pond = square(100, 180, 0.0004);
    const back = compositeFromDetails({
      center_lon: -87,
      center_lat: 34.5,
      wetted_length_ft: 1300,
      full_circle: true,
      cutouts: [pond.coordinates],
    })!;
    expect(back.addPolygons).toEqual([]);
    expect(back.cutPolygons).toHaveLength(1);
    expect(back.cutPolygons[0].coordinates).toEqual(pond.coordinates);
  });

  it("reads plain circle details as empty add/cut lists", () => {
    const back = compositeFromDetails({
      center_lon: -87,
      center_lat: 34.5,
      wetted_length_ft: 1300,
      full_circle: true,
    })!;
    expect(back.addPolygons).toEqual([]);
    expect(back.cutPolygons).toEqual([]);
  });
});

describe("snapEndBearing", () => {
  it("snaps within 3 degrees of the common sweeps", () => {
    expect(sweepDegrees(0, snapEndBearing(0, 178))).toBe(180);
    expect(sweepDegrees(30, snapEndBearing(30, 302))).toBe(270);
    expect(sweepDegrees(0, snapEndBearing(0, 88))).toBe(90);
  });

  it("leaves free angles alone", () => {
    expect(snapEndBearing(0, 137)).toBe(137);
    expect(snapEndBearing(0, 200)).toBe(200);
  });
});
