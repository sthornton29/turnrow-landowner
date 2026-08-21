import { describe, expect, it } from "vitest";
import {
  centroidOf,
  closureGrade,
  cornerLabel,
  nearestVertices,
  unionAll,
  PLOT_DISTANCE_WARN_MILES,
  haversineMiles,
  nearestBoundary,
  partsToText,
  chainLargestFirst,
} from "./plotPreview";
import type { Polygon } from "geojson";

const square = (x: number, y: number, s: number): Polygon => ({
  type: "Polygon",
  coordinates: [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]],
});

describe("closure grading", () => {
  it("grades by the surveying thresholds", () => {
    expect(closureGrade(Infinity)).toBe("closed");
    expect(closureGrade(12000)).toBe("good");
    expect(closureGrade(5000)).toBe("good");
    expect(closureGrade(2500)).toBe("fair");
    expect(closureGrade(999)).toBe("poor");
  });
});

describe("plot preview helpers", () => {
  it("unions touching squares into one multipolygon and skips nulls", () => {
    const u = unionAll([square(0, 0, 1), null, square(1, 0, 1)]);
    expect(u?.type).toBe("MultiPolygon");
    expect(u?.coordinates.length).toBe(1);
  });

  it("centroid and corner labels", () => {
    const c = centroidOf(square(0, 0, 2));
    expect(c?.[0]).toBeCloseTo(0.8, 5); // vertex average incl. closing point
    expect(cornerLabel([2, 2], [1, 1])).toBe("NE corner");
    expect(cornerLabel([0, 0], [1, 1])).toBe("SW corner");
  });

  it("nearest vertices are distinct and ranked", () => {
    const near = nearestVertices(square(0, 0, 2), [0.1, 0.1], 3);
    expect(near[0].coord).toEqual([0, 0]);
    expect(near.length).toBe(3);
    expect(new Set(near.map((n) => n.coord.join(","))).size).toBe(3);
  });
});

describe("plot gates and chain text", () => {
  it("measures miles to the nearest boundary vertex", () => {
    const courtland: [number, number] = [-87.307, 34.658];
    const baldwin: [number, number] = [-87.4, 30.656];
    expect(haversineMiles(courtland, baldwin)).toBeGreaterThan(270);
    const near = nearestBoundary(courtland, [
      { name: "River Place", geometry: { type: "Point", coordinates: [-87.33, 34.67] } },
      { name: "Far", geometry: { type: "Point", coordinates: baldwin } },
    ]);
    expect(near?.name).toBe("River Place");
    expect(near!.miles).toBeLessThan(PLOT_DISTANCE_WARN_MILES);
    expect(nearestBoundary(courtland, [])).toBeNull();
  });

  it("writes chains back as text, smallest first, largest-first for display", () => {
    expect(partsToText([["NW", "SE"]])).toBe("NW1/4 of SE1/4");
    expect(partsToText([["E", "NW"], ["SE"]])).toBe("E1/2 of NW1/4 and SE1/4");
    expect(chainLargestFirst(["NW", "SE"])).toEqual(["SE", "NW"]);
  });
});
