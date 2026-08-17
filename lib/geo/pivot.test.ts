import { describe, expect, it } from "vitest";
import { approxAcres, toMultiPolygon } from "./normalize";
import {
  bearingTo,
  compositeFromDetails,
  compositePivotGeometry,
  destination,
  detailsFromComposite,
  distanceFt,
  lateralGeometry,
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
  extensions: [],
  skips: [],
  cutouts: [],
  positions: [],
  ...over,
});

describe("compositePivotGeometry", () => {
  it("an extension zone adds the sector ring area", () => {
    // Quarter-circle end gun zone at 1400 ft over a 1300 ft base:
    // adds (90/360) * pi * (1400^2 - 1300^2) / 43560 acres.
    const { grossAcres } = compositePivotGeometry(
      composite({
        extensions: [{ startBearingDeg: 0, endBearingDeg: 90, outerRadiusFt: 1400 }],
      })
    );
    const expected =
      FULL_1300_ACRES + (0.25 * Math.PI * (1400 * 1400 - 1300 * 1300)) / 43560;
    expect(Math.abs(grossAcres - expected) / expected).toBeLessThan(0.01);
  });

  it("an extension shorter than the base radius adds nothing", () => {
    const { grossAcres } = compositePivotGeometry(
      composite({
        extensions: [{ startBearingDeg: 0, endBearingDeg: 90, outerRadiusFt: 1000 }],
      })
    );
    expect(Math.abs(grossAcres - FULL_1300_ACRES) / FULL_1300_ACRES).toBeLessThan(0.01);
  });

  it("a skip wedge subtracts its share, extensions included", () => {
    // 90 degree skip on a full circle: three quarters remain.
    const { grossAcres } = compositePivotGeometry(
      composite({ skips: [{ startBearingDeg: 0, endBearingDeg: 90 }] })
    );
    const expected = FULL_1300_ACRES * 0.75;
    expect(Math.abs(grossAcres - expected) / expected).toBeLessThan(0.01);
  });

  it("cutouts reduce plantable acres but not gross watered acres", () => {
    // A small square pond inside the circle.
    const d = 0.001; // ~100m square
    const pond: [number, number][] = [
      [CENTER[0] - d, CENTER[1] - d],
      [CENTER[0] + d, CENTER[1] - d],
      [CENTER[0] + d, CENTER[1] + d],
      [CENTER[0] - d, CENTER[1] + d],
      [CENTER[0] - d, CENTER[1] - d],
    ];
    const { grossAcres, plantableAcres, plantable } = compositePivotGeometry(
      composite({ cutouts: [{ type: "Polygon", coordinates: [pond] }] })
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

  it("towable positions union into a multipolygon with summed acres", () => {
    const second = destination(CENTER, 3000, 90) as [number, number]; // well clear
    const { watered, grossAcres } = compositePivotGeometry(
      composite({
        radiusFt: 1000,
        positions: [
          {
            center: second,
            radiusFt: 1000,
            fullCircle: true,
            startBearingDeg: null,
            endBearingDeg: null,
            extensions: [],
            skips: [],
          },
        ],
      })
    );
    const one = (Math.PI * 1000 * 1000) / 43560;
    expect(watered.type).toBe("MultiPolygon");
    expect(Math.abs(grossAcres - 2 * one) / (2 * one)).toBeLessThan(0.01);
  });
});

describe("lateralGeometry", () => {
  it("a straight run covers path length x machine length", () => {
    // Half-mile run (2640 ft) with a 400 ft machine: 2640*400/43560 ac.
    const end = destination(CENTER, 2640 * 0.3048, 90) as [number, number];
    const result = lateralGeometry([CENTER, end], 400, [])!;
    const expected = (2640 * 400) / 43560;
    expect(Math.abs(result.grossAcres - expected) / expected).toBeLessThan(0.01);
  });

  it("supports cutouts like pivots", () => {
    const end = destination(CENTER, 800, 90) as [number, number];
    const d = 0.0005;
    const mid = destination(CENTER, 400, 90) as [number, number];
    const cut: [number, number][] = [
      [mid[0] - d, mid[1] - d],
      [mid[0] + d, mid[1] - d],
      [mid[0] + d, mid[1] + d],
      [mid[0] - d, mid[1] + d],
      [mid[0] - d, mid[1] - d],
    ];
    const result = lateralGeometry([CENTER, end], 400, [
      { type: "Polygon", coordinates: [cut] },
    ])!;
    expect(result.plantableAcres).toBeLessThan(result.grossAcres);
  });

  it("rejects degenerate input", () => {
    expect(lateralGeometry([CENTER], 400, [])).toBeNull();
    expect(lateralGeometry([CENTER, CENTER], 0, [])).toBeNull();
  });
});

describe("details round trip", () => {
  it("serializes and reads back the composite shape", () => {
    const params = composite({
      fullCircle: false,
      startBearingDeg: 10,
      endBearingDeg: 190,
      extensions: [{ startBearingDeg: 40, endBearingDeg: 70, outerRadiusFt: 1390 }],
      skips: [{ startBearingDeg: 100, endBearingDeg: 120 }],
      cutouts: [
        {
          type: "Polygon",
          coordinates: [[[0, 0], [0.001, 0], [0.001, 0.001], [0, 0]]],
        },
      ],
      positions: [
        {
          center: [-86.9, 34.6],
          radiusFt: 900,
          fullCircle: true,
          startBearingDeg: null,
          endBearingDeg: null,
          extensions: [],
          skips: [],
        },
      ],
    });
    const details = detailsFromComposite(params);
    const back = compositeFromDetails(details)!;
    expect(back.radiusFt).toBe(1300);
    expect(back.startBearingDeg).toBe(10);
    expect(back.extensions).toHaveLength(1);
    expect(back.extensions[0].outerRadiusFt).toBe(1390);
    expect(back.skips).toHaveLength(1);
    expect(back.cutouts).toHaveLength(1);
    expect(back.positions).toHaveLength(1);
    expect(back.positions[0].radiusFt).toBe(900);
  });

  it("reads pre-composite pivot details as empty zone lists", () => {
    const back = compositeFromDetails({
      center_lon: -87,
      center_lat: 34.5,
      wetted_length_ft: 1300,
      full_circle: true,
    })!;
    expect(back.extensions).toEqual([]);
    expect(back.skips).toEqual([]);
    expect(back.cutouts).toEqual([]);
    expect(back.positions).toEqual([]);
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
