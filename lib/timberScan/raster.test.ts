import { describe, expect, it } from "vitest";
import {
  ACRE_M2,
  classifyGrid,
  cleanPolygons,
  composition,
  compositionSummary,
  despeckle,
  classIndex,
  maskToPolygons,
  polygonAreaM2,
  ringAreaM2,
  type GridPolygon,
} from "./raster";

// Fixture: the classic north Alabama layout on a 40x30 grid (30m px).
// - Pine block A: x 2..18, y 2..27
// - 1px hardwood drain column at x 19 (must survive despeckle + sliver rules)
// - Pine block B: x 20..34, y 2..27, with a wetland corner x 25..34, y 22..27
// - Lone misclassified hardwood pixel inside A at (10,10) -> despeckled
// - Lone non-forest pixel inside B at (30,10) -> despeckled
// - 2x2 non-forest hole in A at (5..6, 5..6) -> filled (< 1 acre)
// - 2x2 pine sliver at (36..37, 2..3), isolated -> dropped (< 2 acres, compact)
const W = 40;
const H = 30;

function buildFixtureCodes(): Uint8Array {
  const codes = new Uint8Array(W * H).fill(176); // grass/pasture
  const fill = (x1: number, y1: number, x2: number, y2: number, code: number) => {
    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) codes[y * W + x] = code;
    }
  };
  fill(2, 2, 18, 27, 142); // pine A
  fill(19, 2, 19, 27, 141); // hardwood drain
  fill(20, 2, 34, 27, 142); // pine B
  fill(25, 22, 34, 27, 190); // wetland corner (inside B's footprint)
  codes[10 * W + 10] = 141; // lone hardwood in A
  codes[10 * W + 30] = 176; // lone gap in B
  fill(5, 5, 6, 6, 176); // small hole in A
  fill(36, 2, 37, 3, 142); // compact pine sliver
  return codes;
}

function fixtureGrid(): { grid: Uint8Array } {
  return { grid: despeckle(classifyGrid(buildFixtureCodes()), W, H) };
}

function classMask(grid: Uint8Array, cls: number) {
  return (x: number, y: number) => grid[y * W + x] === cls;
}

const PINE = classIndex("pine");
const HARDWOOD = classIndex("hardwood");
const WETLAND = classIndex("wetland");

describe("classifyGrid + despeckle", () => {
  it("maps the CDL forest codes and nothing else", () => {
    const grid = classifyGrid(buildFixtureCodes());
    expect(grid[2 * W + 2]).toBe(PINE);
    expect(grid[2 * W + 19]).toBe(HARDWOOD);
    expect(grid[22 * W + 30]).toBe(WETLAND);
    expect(grid[0]).toBe(0); // grass
  });

  it("flips lone misclassified pixels but keeps the 1px drain", () => {
    const { grid } = fixtureGrid();
    expect(grid[10 * W + 10]).toBe(PINE); // lone hardwood absorbed
    expect(grid[10 * W + 30]).toBe(PINE); // lone gap filled
    for (let y = 2; y <= 27; y++) {
      expect(grid[y * W + 19]).toBe(HARDWOOD); // drain intact
    }
    // The 2x2 hole has same-class neighbors, so despeckle leaves it.
    expect(grid[5 * W + 5]).toBe(0);
  });
});

describe("maskToPolygons", () => {
  it("separates diagonally touching pixels (4-connectivity)", () => {
    const isSet = (x: number, y: number) =>
      (x === 0 && y === 0) || (x === 1 && y === 1);
    const polys = maskToPolygons(isSet, 2, 2);
    expect(polys).toHaveLength(2);
  });

  it("finds pine A with its hole, pine B, and the sliver", () => {
    const { grid } = fixtureGrid();
    const polys = maskToPolygons(classMask(grid, PINE), W, H);
    expect(polys).toHaveLength(3);
    const withHole = polys.find((p) => p.holes.length === 1);
    expect(withHole).toBeDefined();
    // Outer ring encloses 17x26 cells; the 2x2 hole is an interior ring.
    expect(ringAreaM2(withHole!.outer)).toBeCloseTo(17 * 26 * 900, 5);
    expect(ringAreaM2(withHole!.holes[0])).toBeCloseTo(4 * 900, 5);
    expect(polygonAreaM2(withHole!)).toBeCloseTo((17 * 26 - 4) * 900, 5);
  });

  it("keeps coincident borders along the pine/hardwood class line", () => {
    const { grid } = fixtureGrid();
    const pine = maskToPolygons(classMask(grid, PINE), W, H);
    const hardwood = maskToPolygons(classMask(grid, HARDWOOD), W, H);
    const segments = (polys: GridPolygon[]) => {
      const set = new Set<string>();
      for (const poly of polys) {
        for (const ring of [poly.outer, ...poly.holes]) {
          for (let i = 0; i < ring.length - 1; i++) {
            const [a, b] = [ring[i], ring[i + 1]].sort(
              (p, q) => p[0] - q[0] || p[1] - q[1]
            );
            set.add(`${a[0]},${a[1]}|${b[0]},${b[1]}`);
          }
        }
      }
      return set;
    };
    const pineSegments = segments(pine);
    const hardwoodSegments = segments(hardwood);
    // Pine A's right border and the drain's left border are the SAME
    // segment (x=19 from y=2 to y=28); likewise x=20 on the other side.
    expect(pineSegments.has("19,2|19,28")).toBe(true);
    expect(hardwoodSegments.has("19,2|19,28")).toBe(true);
    expect(pineSegments.has("20,2|20,28")).toBe(true);
    expect(hardwoodSegments.has("20,2|20,28")).toBe(true);
  });
});

describe("cleanPolygons", () => {
  it("fills the small hole, keeps the elongated drain, drops the sliver", () => {
    const { grid } = fixtureGrid();
    const pine = cleanPolygons(maskToPolygons(classMask(grid, PINE), W, H));
    // Sliver dropped: two pine polygons remain (A and B).
    expect(pine).toHaveLength(2);
    // Hole under an acre was filled.
    expect(pine.every((p) => p.holes.length === 0)).toBe(true);

    const hardwood = cleanPolygons(
      maskToPolygons(classMask(grid, HARDWOOD), W, H)
    );
    // The full drain (5.8 acres) survives on size.
    expect(hardwood).toHaveLength(1);
  });

  it("keeps sub-2-acre elongated drains, drops compact patches", () => {
    // 1x8 px drain: 1.78 acres, length 8x width -> kept.
    const drain = (x: number, y: number) => x === 0 && y >= 0 && y <= 7;
    expect(cleanPolygons(maskToPolygons(drain, 1, 8))).toHaveLength(1);
    // 2x4 px patch: also 1.78 acres but compact -> dropped.
    const patch = (x: number, y: number) => x <= 1 && y <= 3;
    expect(cleanPolygons(maskToPolygons(patch, 2, 4))).toHaveLength(0);
  });
});

describe("composition", () => {
  it("reads the pixel mix inside an arbitrary polygon", () => {
    const { grid } = fixtureGrid();
    // A rectangle over pine B's wetland corner and some pine.
    const poly: GridPolygon = {
      outer: [
        [25, 18],
        [35, 18],
        [35, 28],
        [25, 28],
        [25, 18],
      ],
      holes: [],
    };
    const counts = composition(grid, W, H, poly);
    expect(counts.wetland).toBe(60); // 10x6 wetland corner
    expect(counts.pine).toBe(40); // 10x4 pine above it
    const summary = compositionSummary(counts);
    expect(summary.dominant).toBe("wetland");
    expect(summary.percents[0]).toEqual({ cls: "wetland", percent: 60 });
  });

  it("acreage sanity: pine A is about 98 acres after hole fill", () => {
    const { grid } = fixtureGrid();
    const pine = cleanPolygons(maskToPolygons(classMask(grid, PINE), W, H));
    const areas = pine.map((p) => polygonAreaM2(p) / ACRE_M2).sort((a, b) => a - b);
    expect(areas[1]).toBeCloseTo((17 * 26 * 900) / ACRE_M2, 1); // ~98.3
  });
});
