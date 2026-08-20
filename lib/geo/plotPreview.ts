// Small helpers for the "plot boundary from a document" flow: closure
// grading, polygon union, centroid, and nearest-vertex quick picks for
// pinning a point of beginning. Pure; unit-tested.

import type { Feature, Geometry, MultiPolygon, Polygon, Position } from "geojson";
import turfUnion from "@turf/union";
import { toMultiPolygon } from "./normalize";

export type ClosureGrade = "good" | "fair" | "poor" | "closed";

// Surveying convention: 1:5000 or better is a clean closure for rural
// work; 1:1000 to 1:5000 is usable with care; worse than 1:1000 means a
// misread call or a bad description.
export function closureGrade(ratio: number): ClosureGrade {
  if (ratio === Infinity) return "closed";
  if (ratio >= 5000) return "good";
  if (ratio >= 1000) return "fair";
  return "poor";
}

export function unionAll(
  geoms: Array<Polygon | MultiPolygon | null | undefined>
): MultiPolygon | null {
  let acc: Polygon | MultiPolygon | null = null;
  for (const g of geoms) {
    if (!g) continue;
    if (!acc) {
      acc = g;
      continue;
    }
    const merged: Feature<Polygon | MultiPolygon> | null = turfUnion({
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: {}, geometry: acc },
        { type: "Feature", properties: {}, geometry: g },
      ],
    });
    if (merged) acc = merged.geometry;
  }
  return acc ? toMultiPolygon(acc) : null;
}

// Vertex-average centroid (good enough to start a POB near the land).
export function centroidOf(g: Geometry | null | undefined): [number, number] | null {
  const pts = vertices(g);
  if (pts.length === 0) return null;
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p[0];
    y += p[1];
  }
  return [x / pts.length, y / pts.length];
}

export function vertices(g: Geometry | null | undefined): Position[] {
  if (!g) return [];
  switch (g.type) {
    case "Point":
      return [g.coordinates];
    case "MultiPoint":
    case "LineString":
      return g.coordinates;
    case "MultiLineString":
    case "Polygon":
      return g.coordinates.flat();
    case "MultiPolygon":
      return g.coordinates.flat(2);
    case "GeometryCollection":
      return g.geometries.flatMap(vertices);
    default:
      return [];
  }
}

// Distinct boundary vertices nearest a point, for "use property corner"
// quick picks. Planar distance in degrees is fine for ranking.
export function nearestVertices(
  g: Geometry | null | undefined,
  center: [number, number],
  count = 6
): Array<{ coord: [number, number]; distanceDeg: number }> {
  const seen = new Set<string>();
  const out: Array<{ coord: [number, number]; distanceDeg: number }> = [];
  for (const p of vertices(g)) {
    const key = `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      coord: [p[0], p[1]],
      distanceDeg: Math.hypot(p[0] - center[0], p[1] - center[1]),
    });
  }
  out.sort((a, b) => a.distanceDeg - b.distanceDeg);
  return out.slice(0, count);
}

// Compass label for a corner relative to a centroid (NW corner, SE corner).
export function cornerLabel(coord: [number, number], centroid: [number, number]): string {
  const ns = coord[1] >= centroid[1] ? "N" : "S";
  const ew = coord[0] >= centroid[0] ? "E" : "W";
  return `${ns}${ew} corner`;
}
