// Small helpers for the "plot boundary from a document" flow: closure
// grading, polygon union, centroid, and nearest-vertex quick picks for
// pinning a point of beginning. Pure; unit-tested.

import type { Feature, Geometry, MultiPolygon, Polygon, Position } from "geojson";
import turfUnion from "@turf/union";
import { toMultiPolygon } from "./normalize";
import type { AliquotPart, AliquotToken } from "./aliquot";

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

// ---------------------------------------------------------------- gates

// A resolution farther than this from every boundary the org already
// has gets a prominent warning (new land exists; a wrong meridian or a
// flipped direction is far likelier). One constant, one place.
export const PLOT_DISTANCE_WARN_MILES = 25;

export function haversineMiles(a: [number, number], b: [number, number]): number {
  const R = 3958.7613;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const la1 = toRad(a[1]);
  const la2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Nearest vertex of any named boundary to a point, in miles.
export function nearestBoundary(
  point: [number, number],
  items: Array<{ name: string; geometry: Geometry | null | undefined }>
): { name: string; miles: number } | null {
  let best: { name: string; miles: number } | null = null;
  for (const item of items) {
    for (const v of vertices(item.geometry)) {
      const miles = haversineMiles(point, v as [number, number]);
      if (!best || miles < best.miles) best = { name: item.name, miles };
    }
  }
  return best ? { name: best.name, miles: Math.round(best.miles * 10) / 10 } : null;
}

// ---------------------------------------------------------------- chain text

export const ALIQUOT_TOKENS: AliquotToken[] = ["NE", "NW", "SE", "SW", "N", "S", "E", "W"];

export function tokenLabel(tok: AliquotToken): string {
  return tok.length === 2 ? `${tok}1/4` : `${tok}1/2`;
}

// Smallest-first chain -> "NW1/4 of SE1/4"; several parts joined by and.
export function partsToText(parts: AliquotPart[]): string {
  return parts
    .filter((p) => p.length > 0)
    .map((p) => p.map(tokenLabel).join(" of "))
    .join(" and ");
}

// Largest-first reading of a chain for display: "SE1/4, then its NW1/4".
export function chainLargestFirst(part: AliquotPart): AliquotToken[] {
  return [...part].reverse();
}
