import { describe, expect, it } from "vitest";
import type { Polygon } from "geojson";
import turfArea from "@turf/area";
import {
  aliquotUV,
  parseAliquot,
  resolveDescription,
  sectionCorners,
  subdivideSection,
} from "./aliquot";

const unitSquare: Polygon = {
  type: "Polygon",
  coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
};

// A near-640-acre section near Lawrence County, Alabama: one mile is
// about 0.01449 degrees of latitude and 0.01763 degrees of longitude
// at 34.7 N.
const MILE_LAT = 1609.344 / 110574;
const MILE_LON = 1609.344 / (111320 * Math.cos((34.7 * Math.PI) / 180));
const section: Polygon = {
  type: "Polygon",
  coordinates: [[
    [-87.6, 34.7],
    [-87.6 + MILE_LON, 34.7],
    [-87.6 + MILE_LON, 34.7 + MILE_LAT],
    [-87.6, 34.7 + MILE_LAT],
    [-87.6, 34.7],
  ]],
};
const acresOf = (g: Polygon | import("geojson").MultiPolygon) =>
  turfArea({ type: "Feature", properties: {}, geometry: g }) / 4046.8564224;

describe("parseAliquot", () => {
  it("reads the Alabama-style chain with section, township, range", () => {
    const p = parseAliquot("NW1/4 of SE1/4 of Section 12, Township 4 South, Range 8 West");
    expect(p.parts).toEqual([["NW", "SE"]]);
    expect(p.section).toBe(12);
    expect(p.township).toEqual({ num: 4, dir: "S" });
    expect(p.range).toEqual({ num: 8, dir: "W" });
    expect(p.exceptions).toEqual([]);
    expect(p.warnings).toEqual([]);
  });

  it("accepts abbreviations and symbols", () => {
    expect(parseAliquot("NW¼ of the SE¼, Sec. 12, T4S, R8W").parts).toEqual([["NW", "SE"]]);
    expect(parseAliquot("NW 1/4 of SE 1/4 Sec 12 T 4 S R 8 W").township).toEqual({ num: 4, dir: "S" });
    expect(parseAliquot("NW/4 of SE/4 of Section 12").parts).toEqual([["NW", "SE"]]);
    expect(parseAliquot("NWSE of Section 12").parts).toEqual([["NW", "SE"]]);
    expect(
      parseAliquot("The Northwest Quarter of the Southeast Quarter of Section 12").parts
    ).toEqual([["NW", "SE"]]);
  });

  it("reads halves and lists", () => {
    expect(parseAliquot("S1/2 of NE1/4 of Section 3").parts).toEqual([["S", "NE"]]);
    expect(parseAliquot("E1/2 of Section 3").parts).toEqual([["E"]]);
    const p = parseAliquot("W1/2 of NE1/4 and NW1/4 of Section 3, T5N, R2E");
    expect(p.parts).toEqual([["W", "NE"], ["NW"]]);
  });

  it("captures exceptions and parses aliquot ones", () => {
    const p = parseAliquot(
      "NE1/4 of Section 9, T4S, R8W, less and except the NE1/4 of NE1/4 of said Section 9"
    );
    expect(p.parts).toEqual([["NE"]]);
    expect(p.exceptions.length).toBe(1);
    expect(p.exceptionParts).toEqual([["NE", "NE"]]);
  });

  it("flags non-aliquot exceptions and lots", () => {
    const p = parseAliquot("SW1/4 of Section 9, T4S R8W, except a 1 acre cemetery");
    expect(p.exceptionParts).toEqual([]);
    expect(p.warnings.some((w) => w.includes("by hand"))).toBe(true);
    const lots = parseAliquot("Lots 3 and 4 of Section 6, T4S, R8W");
    expect(lots.lots).toEqual([3, 4]);
    expect(lots.warnings.some((w) => w.includes("plat"))).toBe(true);
  });

  it("warns when nothing is recognized", () => {
    const p = parseAliquot("Beginning at an iron pin thence N 45 E 100 feet");
    expect(p.parts).toEqual([]);
    expect(p.warnings[0]).toContain("No aliquot parts");
  });
});

describe("aliquotUV", () => {
  it("computes the rectangle for quarter-quarters, halves, and quarters", () => {
    expect(aliquotUV(["NW", "SE"])).toEqual([0.5, 0.75, 0.25, 0.5]);
    expect(aliquotUV(["S", "NE"])).toEqual([0.5, 1, 0.5, 0.75]);
    expect(aliquotUV(["E"])).toEqual([0.5, 1, 0, 1]);
    expect(aliquotUV(["NE"])).toEqual([0.5, 1, 0.5, 1]);
    expect(aliquotUV(["SW", "SW"])).toEqual([0, 0.25, 0, 0.25]);
  });
});

describe("subdivideSection", () => {
  it("finds the corners of a ring", () => {
    const c = sectionCorners(unitSquare);
    expect(c.nw).toEqual([0, 1]);
    expect(c.ne).toEqual([1, 1]);
    expect(c.se).toEqual([1, 0]);
    expect(c.sw).toEqual([0, 0]);
  });

  it("a quarter-quarter of the unit square has area 1/16", () => {
    const q = subdivideSection(unitSquare, ["NW", "SE"]);
    const ring = q.coordinates[0];
    // shoelace
    let sum = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    }
    expect(Math.abs(sum) / 2).toBeCloseTo(1 / 16, 10);
    // It sits in the SE quarter's NW corner: x in [0.5,0.75], y in [0.25,0.5]
    for (const [x, y] of ring) {
      expect(x).toBeGreaterThanOrEqual(0.5);
      expect(x).toBeLessThanOrEqual(0.75);
      expect(y).toBeGreaterThanOrEqual(0.25);
      expect(y).toBeLessThanOrEqual(0.5);
    }
  });

  it("a real section gives 40 and 160 acres", () => {
    const full = acresOf(section);
    expect(full).toBeGreaterThan(635);
    expect(full).toBeLessThan(645);
    // Quarter-quarter = 1/16 of the section, quarter = 1/4 (within 0.5%).
    expect(acresOf(subdivideSection(section, ["NW", "SE"])) / (full / 16)).toBeCloseTo(1, 2);
    expect(acresOf(subdivideSection(section, ["NE"])) / (full / 4)).toBeCloseTo(1, 2);
    expect(Math.round(acresOf(subdivideSection(section, ["NW", "SE"])) * 10) / 10).toBeCloseTo(40.2, 0);
  });

  it("interpolates inside a skewed quadrilateral", () => {
    const skew: Polygon = {
      type: "Polygon",
      coordinates: [[[0, 0], [1, 0.1], [1.1, 1.1], [0.1, 1], [0, 0]]],
    };
    const q = subdivideSection(skew, ["SW"]);
    expect(q.coordinates[0][3]).toEqual([0, 0]); // sw corner stays
    const ne = q.coordinates[0][1];
    expect(ne[0]).toBeCloseTo(0.55, 6);
    expect(ne[1]).toBeCloseTo(0.55, 6);
  });
});

describe("resolveDescription", () => {
  it("unions parts: W1/2 of NE1/4 and NW1/4 is 240 acres", () => {
    const parsed = parseAliquot("W1/2 of NE1/4 and NW1/4 of Section 3, T5N, R2E");
    const r = resolveDescription(parsed, section);
    expect(r.polygon).not.toBeNull();
    expect(r.acres / (acresOf(section) * (240 / 640))).toBeCloseTo(1, 2);
  });

  it("subtracts aliquot exceptions", () => {
    const parsed = parseAliquot("NE1/4 of Section 9, T4S, R8W, less and except the NE1/4 of NE1/4");
    const r = resolveDescription(parsed, section);
    expect(r.acres / (acresOf(section) * (120 / 640))).toBeCloseTo(1, 2);
  });

  it("approximates lots with a note", () => {
    const parsed = parseAliquot("Lot 3 of Section 6, T4S, R8W");
    const r = resolveDescription(parsed, section);
    expect(r.acres / (acresOf(section) / 16)).toBeCloseTo(1, 2);
    expect(r.notes.some((n) => n.startsWith("Lot 3 approximated"))).toBe(true);
  });

  it("returns null when nothing to plot", () => {
    const r = resolveDescription(parseAliquot("thence north"), section);
    expect(r.polygon).toBeNull();
  });
});
