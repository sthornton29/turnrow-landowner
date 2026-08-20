import turfBuffer from "@turf/buffer";
import type { LineString, MultiLineString, MultiPolygon } from "geojson";
import { toMultiPolygon } from "./normalize";

// Mirrors migration 0017's line-to-polygon conversion so the buffering
// rule stays unit-testable: the old centerline easements became polygon
// strips by buffering to half the recorded corridor width (a true
// ground-distance buffer), falling back to 50 ft when no width was
// recorded. New easements are drawn as boundaries directly; this exists
// for the tests and any future one-off conversions.
export const DEFAULT_EASEMENT_WIDTH_FT = 50;

export function easementPolygonFromLine(
  line: LineString | MultiLineString,
  widthFt: number | null | undefined
): MultiPolygon | null {
  const width =
    widthFt && widthFt > 0 ? widthFt : DEFAULT_EASEMENT_WIDTH_FT;
  try {
    const buffered = turfBuffer(
      { type: "Feature", properties: {}, geometry: line },
      width / 2,
      { units: "feet" }
    );
    return buffered ? toMultiPolygon(buffered.geometry) : null;
  } catch {
    return null;
  }
}
