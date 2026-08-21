import { describe, expect, it } from "vitest";
import {
  formatClosure,
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
    // 1000 ft north = 304.8 m / 110574 m per degree
    expect(ring[1][1] - pob[1]).toBeCloseTo(304.8 / 110574, 9);
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
