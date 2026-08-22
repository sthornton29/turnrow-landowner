import { describe, expect, it } from "vitest";
import type { Geometry } from "geojson";
import { drawAreaReadout, shapeAcres } from "./drawArea";

// Roughly 100 acres: 0.00636 deg of longitude by 0.00572 deg of latitude
// near 34.65 N (Lawrence County).
const square = (x0: number, y0: number, w = 0.00636, h = 0.00572): Geometry => ({
  type: "Polygon",
  coordinates: [[[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h], [x0, y0]]],
});

describe("drawAreaReadout", () => {
  it("reports each completed shape's own acres and the total", () => {
    const a = square(-87.31, 34.65);
    const b = square(-87.30, 34.65, 0.00318, 0.00572); // half the size
    const r = drawAreaReadout([{ id: "a", geometry: a }, { id: "b", geometry: b }], new Set(["a", "b"]));
    expect(r.active).toBeNull();
    expect(r.completed.map((s) => s.id)).toEqual(["a", "b"]);
    expect(r.completed[0].acres).toBeGreaterThan(90);
    expect(r.completed[1].acres).toBeCloseTo(r.completed[0].acres / 2, 0);
    expect(r.total).toBeCloseTo(r.completed[0].acres + r.completed[1].acres, 6);
  });
  it("tracks the in-progress shape separately from completed ones", () => {
    const done = square(-87.31, 34.65);
    // Two points with the cursor-follow duplicate: not a shape yet.
    const twoPoints: Geometry = { type: "Polygon", coordinates: [[[-87.3, 34.65], [-87.294, 34.65], [-87.294, 34.65], [-87.3, 34.65]]] };
    let r = drawAreaReadout([{ id: "done", geometry: done }, { id: "live", geometry: twoPoints }], new Set(["done"]));
    expect(r.active).toBeNull();
    expect(r.completed).toHaveLength(1);
    // Third point placed: the active shape has its own acres, which grow
    // as the fourth point lands, and never include the completed shape.
    const tri: Geometry = { type: "Polygon", coordinates: [[[-87.3, 34.65], [-87.29364, 34.65], [-87.29364, 34.65572], [-87.29364, 34.65572], [-87.3, 34.65]]] };
    r = drawAreaReadout([{ id: "done", geometry: done }, { id: "live", geometry: tri }], new Set(["done"]));
    expect(r.active?.id).toBe("live");
    const triAcres = r.active!.acres;
    expect(triAcres).toBeGreaterThan(0);
    expect(triAcres).toBeLessThan(r.completed[0].acres);
    const quad = square(-87.3, 34.65);
    r = drawAreaReadout([{ id: "done", geometry: done }, { id: "live", geometry: quad }], new Set(["done"]));
    expect(r.active!.acres).toBeGreaterThan(triAcres);
    expect(r.active!.acres).toBeCloseTo(r.completed[0].acres, 0);
    expect(r.total).toBeCloseTo(r.completed[0].acres + r.active!.acres, 6);
  });
  it("gives a line no area", () => {
    const line: Geometry = { type: "LineString", coordinates: [[-87.3, 34.65], [-87.29, 34.66]] };
    expect(shapeAcres(line)).toBe(0);
    const r = drawAreaReadout([{ id: "l", geometry: line }], new Set());
    expect(r.active).toBeNull();
    expect(r.total).toBe(0);
  });
});
