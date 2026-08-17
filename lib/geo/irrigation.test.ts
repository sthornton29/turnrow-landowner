import { describe, expect, it } from "vitest";
import type { Polygon } from "geojson";
import { irrigatedAcres } from "./irrigation";
import { destination, pivotPolygon } from "./pivot";
import { approxAcres, toMultiPolygon } from "./normalize";

const CENTER: [number, number] = [-87.0, 34.5];

function circle(center: [number, number], radiusFt: number): Polygon {
  return pivotPolygon({
    center,
    radiusFt,
    fullCircle: true,
    startBearingDeg: null,
    endBearingDeg: null,
  });
}

// A square field centered on CENTER, side in feet.
function squareField(sideFt: number): Polygon {
  const half = (sideFt / 2) * 0.3048;
  const nw = destination(CENTER, Math.hypot(half, half), 315) as [number, number];
  const ne = destination(CENTER, Math.hypot(half, half), 45) as [number, number];
  const se = destination(CENTER, Math.hypot(half, half), 135) as [number, number];
  const sw = destination(CENTER, Math.hypot(half, half), 225) as [number, number];
  return { type: "Polygon", coordinates: [[nw, ne, se, sw, nw]] };
}

describe("irrigatedAcres", () => {
  it("a field fully inside the circle is fully irrigated", () => {
    const field = squareField(1000); // well inside a 1300 ft radius
    const fieldAcres = approxAcres(toMultiPolygon(field)!);
    const acres = irrigatedAcres(field, [circle(CENTER, 1300)]);
    expect(Math.abs(acres - fieldAcres) / fieldAcres).toBeLessThan(0.01);
  });

  it("partial overlap counts only the covered part", () => {
    // Square inscribing the circle: irrigated = circle area, dryland = corners.
    const field = squareField(2600); // side = diameter of the 1300 ft circle
    const fieldAcres = approxAcres(toMultiPolygon(field)!);
    const circleAcres = (Math.PI * 1300 * 1300) / 43560;
    const acres = irrigatedAcres(field, [circle(CENTER, 1300)]);
    expect(Math.abs(acres - circleAcres) / circleAcres).toBeLessThan(0.02);
    expect(acres).toBeLessThan(fieldAcres);
  });

  it("two overlapping pivots on one field count once", () => {
    const field = squareField(1000);
    const fieldAcres = approxAcres(toMultiPolygon(field)!);
    // Two big circles whose union covers the whole field; naive summing
    // would double-count the overlap.
    const second = destination(CENTER, 200, 90) as [number, number];
    const acres = irrigatedAcres(field, [circle(CENTER, 1300), circle(second, 1300)]);
    expect(Math.abs(acres - fieldAcres) / fieldAcres).toBeLessThan(0.01);
  });

  it("no coverage means zero", () => {
    expect(irrigatedAcres(squareField(1000), [])).toBe(0);
    expect(irrigatedAcres(null, [circle(CENTER, 1300)])).toBe(0);
  });
});
