import { describe, expect, it } from "vitest";
import turfArea from "@turf/area";
import {
  COURTLAND_FIXTURES,
  baldwinFlippedSec31,
  courtlandSec12,
  courtlandSouthSec31,
  townCreekSec16,
} from "./fixtures/plss-courtland";
import { aliquotUV, parseAliquot, resolveDescription, subdivideSection } from "./aliquot";
import { countyMatches } from "../countyLookup";
import { meridiansForCounty } from "../plssMeridians";
import { buildPlssWhere, parsePlssId } from "../plss";

const centroid = (ring: number[][]): [number, number] => {
  const pts = ring.slice(0, -1);
  return [
    pts.reduce((a, p) => a + p[0], 0) / pts.length,
    pts.reduce((a, p) => a + p[1], 0) / pts.length,
  ];
};
const acres = (g: Parameters<typeof turfArea>[0]) => turfArea(g) / 4046.8564224;

describe("Courtland ground truth (Huntsville meridian, Lawrence County)", () => {
  it("section 31 of T4S R7W sits just south of Courtland", () => {
    const [lon, lat] = centroid(courtlandSouthSec31.polygon.coordinates[0]);
    // Courtland is at about 34.67 N, -87.31 W; this section is the next
    // mile south. Box: 34.64..34.68 N, -87.33..-87.29 W.
    expect(lat).toBeGreaterThan(34.64);
    expect(lat).toBeLessThan(34.68);
    expect(lon).toBeGreaterThan(-87.33);
    expect(lon).toBeLessThan(-87.29);
    expect(acres(courtlandSouthSec31.polygon)).toBeGreaterThan(600);
    expect(acres(courtlandSouthSec31.polygon)).toBeLessThan(680);
  });

  it("section 12 of T4S R8W and section 16 of T5S R9W are where the map says", () => {
    const [lon12, lat12] = centroid(courtlandSec12.polygon.coordinates[0]);
    expect(lat12).toBeCloseTo(34.717, 1);
    expect(lon12).toBeCloseTo(-87.325, 1);
    const [lon16, lat16] = centroid(townCreekSec16.polygon.coordinates[0]);
    expect(lat16).toBeCloseTo(34.619, 1);
    expect(lon16).toBeCloseTo(-87.483, 1);
    for (const f of COURTLAND_FIXTURES) {
      expect(parsePlssId(f.plssid)?.meridian).toBe("16");
      expect(meridiansForCounty("AL", f.county).primary).toBe("HU");
    }
  });

  it("the deed county pins the meridian the query uses", () => {
    const where = buildPlssWhere({
      state: "AL",
      township: { num: 4, dir: "S" },
      range: { num: 7, dir: "W" },
      section: 31,
      meridian: meridiansForCounty("AL", "Lawrence").primary,
    });
    expect(where).toContain("AL16004_S007_W_");
    expect(where).toContain("FRSTDIVNO = '31'");
  });

  it("a quarter-quarter of section 31 is one sixteenth of it", () => {
    const parsed = parseAliquot("NW1/4 of SE1/4 of Section 31, T4S R7W");
    expect(parsed.parts).toEqual([["NW", "SE"]]);
    expect(aliquotUV(parsed.parts[0])).toEqual([0.5, 0.75, 0.25, 0.5]);
    const resolved = resolveDescription(parsed, courtlandSouthSec31.polygon);
    expect(resolved.polygon).not.toBeNull();
    const whole = acres(courtlandSouthSec31.polygon);
    expect(resolved.acres / whole).toBeCloseTo(1 / 16, 2);
    const quarter = subdivideSection(courtlandSouthSec31.polygon, ["SE"]);
    expect(acres(quarter) / whole).toBeCloseTo(1 / 4, 2);
  });
});

describe("the direction-flip failure the county gate catches", () => {
  it("R7W misread as R7E resolves under St. Stephens in Baldwin County, 280 miles away", () => {
    const [, lat] = centroid(baldwinFlippedSec31.polygon.coordinates[0]);
    expect(lat).toBeLessThan(31);
    expect(parsePlssId(baldwinFlippedSec31.plssid)?.meridian).toBe("25");
    // Pinned to the Lawrence County meridian, the flipped query cannot
    // even reach that section: its PLSSID pattern names Huntsville.
    const where = buildPlssWhere({
      state: "AL",
      township: { num: 4, dir: "S" },
      range: { num: 7, dir: "E" },
      section: 31,
      meridian: "HU",
    });
    expect(where).toContain("AL16004_S007_E_");
    expect(baldwinFlippedSec31.plssid.startsWith("AL25")).toBe(true);
    // And if it somehow did, the county gate flags it.
    expect(countyMatches("Lawrence", baldwinFlippedSec31.county)).toBe(false);
  });

  it("refuses to query without a meridian", () => {
    expect(() =>
      buildPlssWhere({
        state: "AL",
        township: { num: 4, dir: "S" },
        range: { num: 7, dir: "W" },
        section: 31,
        meridian: null,
      })
    ).toThrow(/meridian/i);
  });
});
