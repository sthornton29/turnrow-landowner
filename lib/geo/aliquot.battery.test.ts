import { describe, expect, it } from "vitest";
import turfArea from "@turf/area";
import type { Polygon } from "geojson";
import { aliquotUV, parseAliquot, resolveDescription } from "./aliquot";

// The right-to-left rule: "A of B" means B is the larger division and A
// subdivides it. Every case below asserts the UV rectangle (u west to
// east, v south to north) so a parser regression shows as the wrong
// corner, not a vague acreage.

// Unit square section (degrees scaled small so turf area stays sane).
const unitSection: Polygon = {
  type: "Polygon",
  coordinates: [[[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]]],
};
const wholeAcres = turfArea(unitSection) / 4046.8564224;

describe("aliquot parser battery", () => {
  it("quarter-quarters in every corner", () => {
    expect(aliquotUV(["NE", "NE"])).toEqual([0.75, 1, 0.75, 1]);
    expect(aliquotUV(["NW", "NE"])).toEqual([0.5, 0.75, 0.75, 1]);
    expect(aliquotUV(["SW", "SW"])).toEqual([0, 0.25, 0, 0.25]);
    expect(aliquotUV(["SE", "SW"])).toEqual([0.25, 0.5, 0, 0.25]);
    expect(aliquotUV(["NW", "SE"])).toEqual([0.5, 0.75, 0.25, 0.5]);
  });

  it("halves of quarters read right to left", () => {
    // E1/2 of NW1/4: the NW quarter is u 0..0.5, v 0.5..1; its east half
    // is u 0.25..0.5.
    expect(aliquotUV(["E", "NW"])).toEqual([0.25, 0.5, 0.5, 1]);
    expect(aliquotUV(["S", "NE"])).toEqual([0.5, 1, 0.5, 0.75]);
    expect(aliquotUV(["N", "SW"])).toEqual([0, 0.5, 0.25, 0.5]);
    expect(aliquotUV(["W", "SE"])).toEqual([0.5, 0.75, 0, 0.5]);
  });

  it("stacked three-deep chains", () => {
    // NE1/4 of NW1/4 of SE1/4: SE quarter (0.5..1, 0..0.5), its NW
    // quarter-quarter (0.5..0.75, 0.25..0.5), its NE sixteenth.
    expect(aliquotUV(["NE", "NW", "SE"])).toEqual([0.625, 0.75, 0.375, 0.5]);
    expect(parseAliquot("NE1/4 of NW1/4 of SE1/4 of Section 12").parts).toEqual([["NE", "NW", "SE"]]);
    // Halves inside: S1/2 of N1/2 of NE1/4 = the second eighth strip.
    expect(aliquotUV(["S", "N", "NE"])).toEqual([0.5, 1, 0.75, 0.875]);
  });

  it("reads the many ways people write the same part", () => {
    const forms = [
      "NW1/4 of SE1/4",
      "NW 1/4 of the SE 1/4",
      "NW¼ of SE¼",
      "Northwest Quarter of the Southeast Quarter",
      "NW/4 of SE/4",
      "NWSE",
      "the northwest quarter of southeast quarter",
    ];
    for (const f of forms) {
      expect(parseAliquot(`${f} of Section 12, T4S R8W`).parts, f).toEqual([["NW", "SE"]]);
    }
    expect(parseAliquot("East Half of the Northwest Quarter, Section 3, T4S, R8W").parts).toEqual([["E", "NW"]]);
    expect(parseAliquot("S1/2 of NE1/4 Sec. 3 T 4 S R 8 W").parts).toEqual([["S", "NE"]]);
  });

  it("multi-part lists with and", () => {
    const p = parseAliquot("the N1/2 of the NE1/4 and the SE1/4 of the NE1/4 of Section 5, T4S R8W");
    expect(p.parts).toEqual([["N", "NE"], ["SE", "NE"]]);
    const r = resolveDescription(p, unitSection);
    // N1/2 of NE1/4 = 1/8 of the section, SE1/4 of NE1/4 = 1/16.
    expect(r.acres / wholeAcres).toBeCloseTo(1 / 8 + 1 / 16, 3);
    const q = parseAliquot("W1/2 of NE1/4 and NW1/4 of Section 5, T4S R8W");
    expect(q.parts).toEqual([["W", "NE"], ["NW"]]);
    expect(resolveDescription(q, unitSection).acres / wholeAcres).toBeCloseTo(1 / 8 + 1 / 4, 3);
  });

  it("several parcels in one description, each with its own section", () => {
    const text =
      "Parcel 1: the SW1/4 of the SW1/4 of Section 12, T4S R8W. Parcel 2: the E1/2 of the NE1/4 of Section 13, T4S R8W.";
    const pieces = text.split(/Parcel \d+:/i).map((s) => s.trim()).filter(Boolean);
    expect(pieces).toHaveLength(2);
    expect(parseAliquot(pieces[0]).parts).toEqual([["SW", "SW"]]);
    expect(parseAliquot(pieces[0]).section).toBe(12);
    expect(parseAliquot(pieces[1]).parts).toEqual([["E", "NE"]]);
    expect(parseAliquot(pieces[1]).section).toBe(13);
  });

  it("less and except cuts an aliquot exception and flags a prose one", () => {
    const p = parseAliquot("the NE1/4 of Section 9, T4S R8W, less and except the SE1/4 of the NE1/4");
    expect(p.parts).toEqual([["NE"]]);
    expect(p.exceptionParts).toEqual([["SE", "NE"]]);
    const r = resolveDescription(p, unitSection);
    expect(r.acres / wholeAcres).toBeCloseTo(1 / 4 - 1 / 16, 3);
    const q = parseAliquot("the NE1/4 of Section 9, T4S R8W, less and except one acre around the cemetery");
    expect(q.exceptionParts).toEqual([]);
    expect(q.warnings.join(" ")).toMatch(/cut by hand/);
  });

  it("section, township, and range with their directions", () => {
    const p = parseAliquot("NW1/4 of SE1/4 of Section 12, Township 4 South, Range 8 West");
    expect(p.section).toBe(12);
    expect(p.township).toEqual({ num: 4, dir: "S" });
    expect(p.range).toEqual({ num: 8, dir: "W" });
    const q = parseAliquot("NW1/4 of SE1/4 Sec 12 T4N R8E");
    expect(q.township).toEqual({ num: 4, dir: "N" });
    expect(q.range).toEqual({ num: 8, dir: "E" });
  });

  it("a wrong order would land in a different corner", () => {
    // Guard against a regression that applied the chain smallest-first.
    expect(aliquotUV(["NW", "SE"])).not.toEqual(aliquotUV(["SE", "NW"]));
    expect(aliquotUV(["SE", "NW"])).toEqual([0.25, 0.5, 0.5, 0.75]);
  });
});
