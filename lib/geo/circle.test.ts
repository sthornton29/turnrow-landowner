import { describe, expect, it } from "vitest";
import turfArea from "@turf/area";
import {
  circleAcres,
  circleAreaSqFt,
  circleFromDetails,
  circlePolygon,
  circleUpdateForDetails,
  detailsFromCircle,
  diameterFromRimPoint,
  formatFootprint,
  rimPoint,
} from "./circle";

const center: [number, number] = [-87.6, 34.7];

describe("circle footprint geometry", () => {
  it("polygon area matches pi r squared within 1 percent", () => {
    const poly = circlePolygon({ center, diameterFt: 60 });
    const sqm = turfArea({ type: "Feature", properties: {}, geometry: poly });
    const sqft = sqm * 10.7639;
    const expected = circleAreaSqFt(60);
    expect(Math.abs(sqft - expected) / expected).toBeLessThan(0.01);
    expect(poly.coordinates[0][0]).toEqual(poly.coordinates[0].at(-1));
  });

  it("acres follow from the diameter", () => {
    expect(circleAcres(48)).toBeCloseTo(0.0415, 3);
    expect(circleAcres(235.5)).toBeCloseTo(1.0, 2);
  });

  it("rim handle drags set the diameter (round trip)", () => {
    const params = { center, diameterFt: 90 };
    const rim = rimPoint(params);
    expect(diameterFromRimPoint(center, rim)).toBe(90);
    expect(diameterFromRimPoint(center, center)).toBe(4); // clamped minimum
  });
});

describe("circle details round trip and diameter sync", () => {
  it("writes and reads the details shape", () => {
    const d = detailsFromCircle({ center: [-87.123456789, 34.1], diameterFt: 48.04 });
    expect(d.footprint_shape).toBe("circle");
    expect(d.diameter_ft).toBe(48);
    const back = circleFromDetails(d);
    expect(back?.diameterFt).toBe(48);
    expect(back?.center[0]).toBeCloseTo(-87.1234568, 6);
  });

  it("ignores assets without a circle footprint", () => {
    expect(circleFromDetails({ diameter_ft: 48 })).toBeNull();
    expect(circleFromDetails({ footprint_shape: "circle", diameter_ft: 48 })).toBeNull();
    expect(circleFromDetails(null)).toBeNull();
  });

  it("typing a new diameter_ft on the form regenerates the polygon", () => {
    const before = detailsFromCircle({ center, diameterFt: 48 });
    const update = circleUpdateForDetails(before, { ...before, diameter_ft: 60 });
    expect(update?.params.diameterFt).toBe(60);
    const sqm = turfArea({ type: "Feature", properties: {}, geometry: update!.polygon });
    expect(Math.abs(sqm * 10.7639 - circleAreaSqFt(60)) / circleAreaSqFt(60)).toBeLessThan(0.01);
  });

  it("an unchanged diameter writes no geometry", () => {
    const before = detailsFromCircle({ center, diameterFt: 48 });
    expect(circleUpdateForDetails(before, { ...before })).toBeNull();
    expect(circleUpdateForDetails(before, { ...before, diameter_ft: "48" })).toBeNull();
    expect(circleUpdateForDetails(before, { ...before, diameter_ft: "" })).toBeNull();
    expect(circleUpdateForDetails({ diameter_ft: 48 }, { diameter_ft: 60 })).toBeNull();
  });
});

describe("footprint formatting", () => {
  const acres = (a: number) => a.toFixed(1);
  const num = (n: number) => n.toLocaleString("en-US");
  it("reads in square feet under half an acre, acres above", () => {
    expect(formatFootprint(1810, acres, num)).toBe("1,810 sq ft");
    expect(formatFootprint(43560 * 0.49, acres, num)).toMatch(/sq ft$/);
    expect(formatFootprint(43560 * 0.5, acres, num)).toBe("0.5 acres");
    expect(formatFootprint(43560 * 2.26, acres, num)).toBe("2.3 acres");
  });
});
