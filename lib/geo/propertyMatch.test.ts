import { describe, expect, it } from "vitest";
import type { MultiPolygon, Polygon } from "geojson";
import { pointInMultiPolygon, suggestPropertyId } from "./propertyMatch";

const square = (
  west: number,
  south: number,
  east: number,
  north: number
): MultiPolygon => ({
  type: "MultiPolygon",
  coordinates: [
    [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  ],
});

// Property A: 0..10, Property B: 10..20 (side by side).
const propA = { id: "a", boundary: square(0, 0, 10, 10) };
const propB = { id: "b", boundary: square(10, 0, 20, 10) };

describe("pointInMultiPolygon", () => {
  it("detects inside and outside", () => {
    expect(pointInMultiPolygon([5, 5], propA.boundary)).toBe(true);
    expect(pointInMultiPolygon([15, 5], propA.boundary)).toBe(false);
  });

  it("respects holes", () => {
    const withHole: MultiPolygon = {
      type: "MultiPolygon",
      coordinates: [
        [
          square(0, 0, 10, 10).coordinates[0][0],
          square(4, 4, 6, 6).coordinates[0][0],
        ],
      ],
    };
    expect(pointInMultiPolygon([5, 5], withHole)).toBe(false);
    expect(pointInMultiPolygon([2, 2], withHole)).toBe(true);
  });
});

describe("suggestPropertyId", () => {
  it("picks the property containing a field", () => {
    const field: Polygon = square(2, 2, 4, 4).coordinates[0] && {
      type: "Polygon",
      coordinates: square(2, 2, 4, 4).coordinates[0],
    };
    expect(suggestPropertyId(field, [propA, propB])).toBe("a");
  });

  it("picks the majority side for a straddling field", () => {
    // Mostly inside B: spans 8..16, label point at 12.
    const field: Polygon = {
      type: "Polygon",
      coordinates: square(8, 2, 16, 4).coordinates[0],
    };
    expect(suggestPropertyId(field, [propA, propB])).toBe("b");
  });

  it("returns null when nothing contains the feature", () => {
    const field: Polygon = {
      type: "Polygon",
      coordinates: square(40, 40, 44, 44).coordinates[0],
    };
    expect(suggestPropertyId(field, [propA, propB])).toBeNull();
  });

  it("matches points and lines too", () => {
    expect(
      suggestPropertyId({ type: "Point", coordinates: [3, 3] }, [propA, propB])
    ).toBe("a");
    expect(
      suggestPropertyId(
        {
          type: "LineString",
          coordinates: [
            [11, 1],
            [15, 5],
            [19, 9],
          ],
        },
        [propA, propB]
      )
    ).toBe("b");
  });

  it("skips properties without boundaries", () => {
    expect(
      suggestPropertyId({ type: "Point", coordinates: [3, 3] }, [
        { id: "empty", boundary: null },
        propA,
      ])
    ).toBe("a");
  });
});
