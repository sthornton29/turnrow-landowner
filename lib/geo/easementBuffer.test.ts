import { describe, expect, it } from "vitest";
import turfArea from "@turf/area";
import type { LineString, MultiLineString } from "geojson";
import { distanceFt } from "./pivot";
import {
  DEFAULT_EASEMENT_WIDTH_FT,
  easementPolygonFromLine,
} from "./easementBuffer";

const SQFT_PER_ACRE = 43560;
const SQM_PER_ACRE = 4046.8564224;

// Roughly one mile east-west near Moulton, Alabama.
const A: [number, number] = [-87.3, 34.48];
const B: [number, number] = [-87.31754, 34.48];
const line: LineString = { type: "LineString", coordinates: [A, B] };

// Buffered strip = length x width plus the two round end caps
// (together one full circle of radius width/2).
function expectedAcres(widthFt: number): number {
  const lengthFt = distanceFt(A, B);
  return (
    (lengthFt * widthFt + Math.PI * (widthFt / 2) ** 2) / SQFT_PER_ACRE
  );
}

function acresOf(geometry: ReturnType<typeof easementPolygonFromLine>): number {
  if (!geometry) throw new Error("no polygon");
  return turfArea({ type: "Feature", properties: {}, geometry }) / SQM_PER_ACRE;
}

describe("easementPolygonFromLine (migration 0017 buffering mirror)", () => {
  it("buffers a centerline to half its width: acres come out length x width", () => {
    const poly = easementPolygonFromLine(line, 100);
    const acres = acresOf(poly);
    expect(acres).toBeGreaterThan(11); // a mile of 100 ft is ~12.1 ac
    expect(Math.abs(acres - expectedAcres(100)) / expectedAcres(100)).toBeLessThan(0.02);
  });

  it("falls back to the 50 ft default when no width was recorded", () => {
    const poly = easementPolygonFromLine(line, null);
    const acres = acresOf(poly);
    expect(
      Math.abs(acres - expectedAcres(DEFAULT_EASEMENT_WIDTH_FT)) /
        expectedAcres(DEFAULT_EASEMENT_WIDTH_FT)
    ).toBeLessThan(0.02);
    expect(easementPolygonFromLine(line, 0)).not.toBeNull();
  });

  it("returns a MultiPolygon and handles multi-segment lines", () => {
    const ml: MultiLineString = {
      type: "MultiLineString",
      coordinates: [
        [A, B],
        [
          [-87.3, 34.5],
          [-87.31754, 34.5],
        ],
      ],
    };
    const poly = easementPolygonFromLine(ml, 80);
    expect(poly?.type).toBe("MultiPolygon");
    // Two disjoint mile-long strips: about double one strip's acres.
    expect(acresOf(poly) / expectedAcres(80)).toBeGreaterThan(1.9);
  });
});
