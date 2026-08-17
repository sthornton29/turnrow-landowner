import { describe, expect, it } from "vitest";
import { approxAcres, toMultiPolygon } from "./normalize";
import {
  bearingTo,
  destination,
  distanceFt,
  pivotPolygon,
  snapEndBearing,
  sweepDegrees,
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
