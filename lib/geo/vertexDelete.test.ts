import { describe, expect, it } from "vitest";
import { canDeleteVertices } from "./vertexDelete";

// Rings as GeoJSON hands them over: closed, first point repeated.
const square = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
const triangle = [[5, 5], [6, 5], [6, 6], [5, 5]];
const hole = [[0.2, 0.2], [0.4, 0.2], [0.4, 0.4], [0.2, 0.4], [0.2, 0.2]];

describe("canDeleteVertices", () => {
  it("lets a point go when the ring keeps at least three", () => {
    expect(canDeleteVertices("Polygon", [square], ["0.2"])).toBe(true);
    expect(canDeleteVertices("MultiPolygon", [[square]], ["0.0.1"])).toBe(true);
  });

  it("refuses to take a triangle below three points", () => {
    expect(canDeleteVertices("Polygon", [triangle], ["0.1"])).toBe(false);
    // The small second area of a boundary: deleting from it must not
    // cost the whole boundary.
    expect(canDeleteVertices("MultiPolygon", [[square], [triangle]], ["1.0.2"])).toBe(false);
    expect(canDeleteVertices("MultiPolygon", [[square], [triangle]], ["0.0.2"])).toBe(true);
  });

  it("counts every selected point on the same ring", () => {
    expect(canDeleteVertices("Polygon", [square], ["0.1", "0.2"])).toBe(false);
    // One point from each of two rings is fine when both stay whole.
    expect(canDeleteVertices("Polygon", [square, hole], ["0.1", "1.1"])).toBe(true);
    expect(canDeleteVertices("Polygon", [square, triangle], ["0.1", "1.1"])).toBe(false);
  });

  it("keeps a line at two points or more", () => {
    const line = [[0, 0], [1, 1], [2, 2]];
    expect(canDeleteVertices("LineString", line, ["1"])).toBe(true);
    expect(canDeleteVertices("LineString", line.slice(0, 2), ["1"])).toBe(false);
    expect(canDeleteVertices("MultiLineString", [line, line.slice(0, 2)], ["0.2"])).toBe(true);
    expect(canDeleteVertices("MultiLineString", [line, line.slice(0, 2)], ["1.0"])).toBe(false);
  });

  it("refuses when nothing is selected, the address is wrong, or the shape is a point", () => {
    expect(canDeleteVertices("Polygon", [square], [])).toBe(false);
    expect(canDeleteVertices("Polygon", [square], ["4.1"])).toBe(false);
    expect(canDeleteVertices("Point", [0, 0], ["0"])).toBe(false);
  });
});
