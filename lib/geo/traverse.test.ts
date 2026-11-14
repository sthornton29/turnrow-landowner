import { describe, expect, it } from "vitest";
import {
  formatClosure,
  metersPerDegree,
  parseAngle,
  parseBearing,
  parseDistance,
  toGeoJSON,
  traverse,
  type Call,
} from "./traverse";

const az = (t: string) => parseBearing(t)?.azimuthDeg;

describe("parseBearing", () => {
  it("reads DMS in every common form", () => {
    expect(az("N 45°30'15\" E")).toBeCloseTo(45.504167, 5);
    expect(az("N45-30-15E")).toBeCloseTo(45.504167, 5);
    expect(az("N 45 30 15 E")).toBeCloseTo(45.504167, 5);
    expect(az("N45d30m15sE")).toBeCloseTo(45.504167, 5);
    expect(az("North 45 degrees 30 minutes East")).toBeCloseTo(45.5, 5);
    expect(az("N 45.5 E")).toBeCloseTo(45.5, 5);
    const p = parseBearing("N 45°30'15\" E");
    expect(p?.quadrant).toBe("NE");
    expect(p?.degrees).toBe(45);
    expect(p?.minutes).toBe(30);
    expect(p?.seconds).toBe(15);
  });

  it("converts quadrants to azimuths", () => {
    expect(az("N 10 E")).toBeCloseTo(10);
    expect(az("S 10 E")).toBeCloseTo(170);
    expect(az("S 12.5 W")).toBeCloseTo(192.5);
    expect(az("N 10 W")).toBeCloseTo(350);
  });

  it("handles due directions and azimuths", () => {
    expect(az("due north")).toBe(0);
    expect(az("Due East")).toBe(90);
    expect(az("south")).toBe(180);
    expect(az("Az 123.5")).toBeCloseTo(123.5);
    expect(az("123°30'")).toBeCloseTo(123.5);
    expect(parseBearing(370)?.azimuthDeg).toBe(10);
  });

  it("rejects junk", () => {
    expect(parseBearing("")).toBeNull();
    expect(parseBearing("hello")).toBeNull();
    expect(parseBearing("N 95 E")).toBeNull();
  });
});

describe("parseDistance", () => {
  it("converts units to feet", () => {
    expect(parseDistance("100 ft")).toBe(100);
    expect(parseDistance("100'")).toBe(100);
    expect(parseDistance("1,320.5 feet")).toBe(1320.5);
    expect(parseDistance("20 chains")).toBe(1320);
    expect(parseDistance("4 ch")).toBe(264);
    expect(parseDistance("2 poles")).toBe(33);
    expect(parseDistance("2 rods")).toBe(33);
    expect(parseDistance("50 links")).toBeCloseTo(33);
    expect(parseDistance("3 varas")).toBeNull(); // varas are flagged, never converted
    expect(parseDistance("10 m")).toBeCloseTo(32.8084);
    expect(parseDistance("2 yards")).toBe(6);
    expect(parseDistance(5, "chains")).toBe(330);
    expect(parseDistance("abc")).toBeNull();
  });
});

describe("traverse", () => {
  const square: Call[] = [
    { bearing: "N 0 E", distance: 100 },
    { bearing: "N 90 E", distance: 100 },
    { bearing: "S 0 E", distance: 100 },
    { bearing: "S 90 W", distance: 100 },
  ];

  it("closes a 100 ft square exactly", () => {
    const r = traverse(square);
    expect(r.closureDistanceFt).toBeLessThan(1e-9);
    expect(r.closureRatio).toBe(Infinity);
    expect(r.perimeterFt).toBe(400);
    expect(r.areaSqFt).toBeCloseTo(10000, 6);
    expect(r.areaAcres).toBeCloseTo(0.2296, 4);
    expect(r.adjusted).toBe(false);
    expect(formatClosure(r)).toBe("Closes exactly");
  });

  it("reports an open figure and force-closes it", () => {
    const open: Call[] = [
      { bearing: "N 0 E", distance: 100 },
      { bearing: "N 90 E", distance: 100 },
      { bearing: "S 0 E", distance: 100 },
      { bearing: "S 90 W", distance: 98 }, // 2 ft short
    ];
    const r = traverse(open);
    expect(r.closureDistanceFt).toBeCloseTo(2, 6);
    expect(r.closureRatio).toBeCloseTo(398 / 2, 6);
    expect(formatClosure(r)).toBe("Closure 2.0 ft, 1:199");
    expect(r.warnings.some((w) => w.includes("poor"))).toBe(true);

    const fixed = traverse(open, { forceClose: true });
    expect(fixed.adjusted).toBe(true);
    const last = fixed.points[fixed.points.length - 1];
    expect(last[0]).toBe(0);
    expect(last[1]).toBe(0);
    // Compass rule keeps the figure near its raw shape.
    expect(fixed.areaAcres).toBeCloseTo(0.227, 2);
  });

  it("plots a tangent curve from radius and arc", () => {
    const calls: Call[] = [
      { bearing: "N 0 E", distance: 100 },
      {
        bearing: "N 0 E",
        distance: 0,
        curve: { radius: 100, arcLength: 157.08, direction: "right" },
      },
    ];
    const r = traverse(calls);
    const end = r.points[2];
    // delta 90, chord 141.42 at bearing N 45 E from (0,100)
    expect(Math.hypot(end[0] - 0, end[1] - 100)).toBeCloseTo(141.42, 1);
    expect(end[0]).toBeCloseTo(100, 0);
    expect(end[1]).toBeCloseTo(200, 0);
    expect(r.perimeterFt).toBeCloseTo(257.08, 2);
  });

  it("uses a chord when given directly", () => {
    const r = traverse([
      { bearing: "N 0 E", distance: 10, curve: { chordBearing: "N 90 E", chordLength: 50, direction: "left" } },
    ]);
    expect(r.points[1][0]).toBeCloseTo(50);
    expect(r.points[1][1]).toBeCloseTo(0);
  });

  it("handles chains: a 20 x 20 chain square is 40.0 acres", () => {
    const r = traverse([
      { bearing: "N", distance: 20, unit: "chains" },
      { bearing: "E", distance: 20, unit: "chains" },
      { bearing: "S", distance: 20, unit: "chains" },
      { bearing: "W", distance: 20, unit: "chains" },
    ]);
    expect(r.areaAcres).toBeCloseTo(40.0, 6);
  });

  it("warns on unreadable calls instead of throwing", () => {
    const r = traverse([{ bearing: "???", distance: 10 }]);
    expect(r.points.length).toBe(1);
    expect(r.warnings[0]).toContain("bearing");
  });

  it("names the calls it skipped by their own numbers", () => {
    const r = traverse([
      { bearing: "N 0 E", distance: 100 },
      { bearing: "", distance: 100 },
      { bearing: "N 90 E", distance: 100 },
      { bearing: "S 0 E", distance: Number.NaN },
      { bearing: "S 0 E", distance: 100 },
    ]);
    expect(r.skippedCalls).toEqual([2, 4]);
    expect(r.warnings.some((w) => w.startsWith("Call 2:"))).toBe(true);
    expect(r.warnings.some((w) => w.startsWith("Call 4:"))).toBe(true);
    expect(r.points).toHaveLength(4);
  });
});

describe("curves", () => {
  const allFinite = (pts: Array<[number, number]>) => pts.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y));

  it("a curve with no bearing of its own continues from the course before it", () => {
    // East 100 ft, then a quarter circle to the right (radius 100): it
    // turns south and ends at (200, -100). Starting it due north instead
    // would end at (200, +100).
    const r = traverse([
      { bearing: "N 90 E", distance: 100 },
      { distance: 0, curve: { radius: 100, arcLength: 157.08, direction: "right" } },
    ]);
    expect(r.points[2][0]).toBeCloseTo(200, 1);
    expect(r.points[2][1]).toBeCloseTo(-100, 1);
    expect(r.warnings.filter((w) => w.startsWith("Call"))).toEqual([]);
  });

  it("reads a delta angle written with degree, minute, and second marks", () => {
    const r = traverse([
      { bearing: "N 90 E", distance: 100 },
      { distance: 0, curve: { radius: 100, delta: "90°00'00\"", direction: "right" } },
    ]);
    expect(r.points[2][0]).toBeCloseTo(200, 6);
    expect(r.points[2][1]).toBeCloseTo(-100, 6);
    const dashed = traverse([
      { bearing: "N 90 E", distance: 100 },
      { distance: 0, curve: { radius: 100, delta: "90-00-00", direction: "left" } },
    ]);
    expect(dashed.points[2][0]).toBeCloseTo(200, 6);
    expect(dashed.points[2][1]).toBeCloseTo(100, 6);
  });

  it("ignores an unreadable delta with a warning that names the call, and never emits NaN", () => {
    // What Number("90°00'00\"") used to produce: NaN, with a chord length
    // and no chord bearing. Every later point became NaN.
    for (const delta of [Number.NaN, "ninety degrees or so"]) {
      const r = traverse([
        { bearing: "N 90 E", distance: 100 },
        { distance: 0, curve: { chordLength: 50, delta, direction: "right" } },
        { bearing: "S 0 E", distance: 100 },
        { bearing: "S 90 W", distance: 100 },
      ]);
      expect(allFinite(r.points)).toBe(true);
      expect(r.skippedCalls).toEqual([2]);
      expect(r.warnings.some((w) => w.startsWith("Call 2:") && w.includes("delta"))).toBe(true);
      expect(Number.isFinite(r.areaAcres)).toBe(true);
      expect(Number.isFinite(r.closureDistanceFt)).toBe(true);
    }
  });

  it("ignores curve figures that are not numbers and says which call", () => {
    const r = traverse([
      { bearing: "N 90 E", distance: 100 },
      { distance: 0, curve: { radius: Number.NaN, arcLength: 157.08, chordBearing: "S 45 E", chordLength: 141.42, direction: "right" } },
    ]);
    expect(allFinite(r.points)).toBe(true);
    expect(r.points[2][0]).toBeCloseTo(200, 1);
    expect(r.points[2][1]).toBeCloseTo(-100, 1);
    expect(r.warnings.some((w) => w.startsWith("Call 2:") && w.includes("radius"))).toBe(true);
  });

  it("carries the true outgoing tangent after a curve, not its chord bearing", () => {
    // East 100, a quarter circle right (now heading south at (200, -100)),
    // then another quarter circle right with no bearing: it must start
    // due south and end heading west at (100, -200). Starting it along
    // the first curve's chord (S 45 E) would end at (200, -241.4).
    const r = traverse([
      { bearing: "N 90 E", distance: 100 },
      { distance: 0, curve: { radius: 100, delta: 90, direction: "right" } },
      { distance: 0, curve: { radius: 100, delta: 90, direction: "right" } },
    ]);
    expect(r.points[3][0]).toBeCloseTo(100, 6);
    expect(r.points[3][1]).toBeCloseTo(-200, 6);
  });

  it("works out the outgoing tangent of a curve given by its chord and radius", () => {
    const r = traverse([
      { bearing: "N 90 E", distance: 100 },
      { distance: 0, curve: { radius: 100, chordBearing: "S 45 E", chordLength: 141.42136, direction: "right" } },
      { distance: 0, curve: { radius: 100, delta: 90, direction: "right" } },
    ]);
    expect(r.points[3][0]).toBeCloseTo(100, 3);
    expect(r.points[3][1]).toBeCloseTo(-200, 3);
    expect(r.warnings.filter((w) => w.startsWith("Call"))).toEqual([]);
  });

  it("warns when the curve before gives only a chord, so the start direction is a guess", () => {
    const r = traverse([
      { bearing: "N 90 E", distance: 100 },
      { distance: 0, curve: { chordBearing: "S 45 E", chordLength: 141.42, direction: "right" } },
      { distance: 0, curve: { radius: 100, delta: 90, direction: "right" } },
    ]);
    expect(r.warnings.some((w) => w.startsWith("Call 3:") && w.includes("approximate"))).toBe(true);
  });

  it("warns when a chord bearing is written but cannot be read", () => {
    const r = traverse([
      { bearing: "N 90 E", distance: 100 },
      { distance: 0, curve: { radius: 100, delta: 90, chordBearing: "southeasterly", direction: "right" } },
    ]);
    expect(r.warnings.some((w) => w.startsWith("Call 2:") && w.includes("chord bearing"))).toBe(true);
  });
});

describe("parseAngle", () => {
  it("reads central angles the way deeds write them", () => {
    expect(parseAngle("90°00'00\"")).toBeCloseTo(90, 9);
    expect(parseAngle("12°30'15\"")).toBeCloseTo(12.504167, 5);
    expect(parseAngle("12-30-15")).toBeCloseTo(12.504167, 5);
    expect(parseAngle("45.5")).toBeCloseTo(45.5, 9);
    expect(parseAngle("90 degrees 00 minutes 00 seconds")).toBeCloseTo(90, 9);
    expect(parseAngle("Delta = 12°30'")).toBeCloseTo(12.5, 9);
    expect(parseAngle(45)).toBe(45);
    expect(parseAngle("about a quarter turn")).toBeNull();
    expect(parseAngle(Number.NaN)).toBeNull();
  });
});

describe("number formats in messages", () => {
  it("prints feet with commas", () => {
    const r = traverse([
      { bearing: "N 0 E", distance: 5000 },
      { bearing: "N 90 E", distance: 5000 },
      { bearing: "S 0 E", distance: 3500 },
      { bearing: "S 90 W", distance: 5000 },
    ]);
    expect(formatClosure(r)).toBe("Closure 1,500.0 ft, 1:12");
    expect(r.warnings.join(" ")).toContain("1,500.0 ft");
  });
});

describe("toGeoJSON", () => {
  const pob: [number, number] = [-87.6, 34.7];
  const pts: Array<[number, number]> = [[0, 0], [0, 1000], [1000, 1000], [1000, 0]];

  it("places points north and east of the POB and closes the ring", () => {
    const poly = toGeoJSON(pts, pob);
    const ring = poly.coordinates[0];
    expect(ring.length).toBe(5);
    expect(ring[0]).toEqual(ring[4]);
    expect(ring[1][1]).toBeGreaterThan(pob[1]); // north
    expect(ring[1][0]).toBeCloseTo(pob[0], 9);
    expect(ring[2][0]).toBeGreaterThan(pob[0]); // east
    // 1000 ft north = 304.8 m over the length of a degree of latitude AT
    // 34.7 north (about 110,935 m), not the equator's 110,574 m.
    expect(ring[1][1] - pob[1]).toBeCloseTo(304.8 / seriesMetersPerDegree(34.7).lat, 9);
  });

  // The standard series for the length of a degree on the WGS84
  // ellipsoid (a different formula from the closed form in traverse.ts,
  // so the two check each other).
  function seriesMetersPerDegree(latDeg: number): { lat: number; lon: number } {
    const p = (latDeg * Math.PI) / 180;
    return {
      lat: 111132.954 - 559.822 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p) - 0.0023 * Math.cos(6 * p),
      lon: 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p) + 0.118 * Math.cos(5 * p),
    };
  }

  it("uses the length of a degree at the point of beginning's latitude", () => {
    for (const lat of [0, 25, 33, 34.7, 45, 60]) {
      const m = metersPerDegree(lat);
      const s = seriesMetersPerDegree(lat);
      expect(Math.abs(m.lat - s.lat)).toBeLessThan(0.05);
      expect(Math.abs(m.lon - s.lon)).toBeLessThan(0.05);
    }
    // Known values: 110,574 m and 111,320 m at the equator.
    expect(metersPerDegree(0).lat).toBeCloseTo(110574.3, 0);
    expect(metersPerDegree(0).lon).toBeCloseTo(111319.5, 0);
  });

  it("a one-mile north call at 33 north lands one mile away, not 5,295.8 ft", () => {
    const at33: [number, number] = [-87.5, 33];
    const ring = toGeoJSON([[0, 0], [0, 5280], [5280, 5280], [5280, 0]], at33).coordinates[0];
    const s = seriesMetersPerDegree(33);
    const northFt = ((ring[1][1] - at33[1]) * s.lat) / 0.3048;
    const eastFt = ((ring[3][0] - at33[0]) * s.lon) / 0.3048;
    expect(northFt).toBeCloseTo(5280, 1);
    expect(eastFt).toBeCloseTo(5280, 1);
    // One square mile is 640 acres; the equator constants made it about 642.6.
    const acres = (northFt * eastFt) / 43560;
    expect(acres).toBeCloseTo(640, 1);
  });

  it("rotates clockwise about the POB", () => {
    const poly = toGeoJSON(pts, pob, 90);
    const ring = poly.coordinates[0];
    // The point that was due north is now due east.
    expect(ring[1][1]).toBeCloseTo(pob[1], 9);
    expect(ring[1][0]).toBeGreaterThan(pob[0]);
    expect(ring[0]).toEqual([pob[0], pob[1]]);
  });
});
