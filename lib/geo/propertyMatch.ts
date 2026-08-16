// Suggest which property an imported feature belongs to from location
// alone: sample representative points from the feature's geometry and
// score each property boundary by how many samples fall inside it.
// Deterministic and dependency-free; unit tests in propertyMatch.test.ts.

import type { Geometry, MultiPolygon, Position } from "geojson";
import { labelPointOf, toMultiLineString, toMultiPolygon } from "./normalize";

// Ray casting, hole-aware.
export function pointInMultiPolygon(point: Position, mp: MultiPolygon): boolean {
  const [x, y] = point;
  const inRing = (ring: Position[]): boolean => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  };
  for (const poly of mp.coordinates) {
    if (poly.length === 0 || !inRing(poly[0])) continue;
    let inHole = false;
    for (let h = 1; h < poly.length; h++) {
      if (inRing(poly[h])) {
        inHole = true;
        break;
      }
    }
    if (!inHole) return true;
  }
  return false;
}

// Representative points: for polygons the label point (weighted 3x, it
// sits in the interior) plus outer-ring vertices; for lines the
// vertices; for points the point itself. Vertex counts are strided to a
// cap so huge county polygons stay cheap.
const VERTEX_CAP = 60;

function samplePoints(geometry: Geometry): Position[] {
  if (geometry.type === "Point") return [geometry.coordinates];
  if (geometry.type === "MultiPoint") return geometry.coordinates;

  const mp = toMultiPolygon(geometry);
  if (mp) {
    const samples: Position[] = [];
    const label = labelPointOf(mp);
    if (label) samples.push(label, label, label);
    const vertices = mp.coordinates.flatMap((poly) => poly[0] ?? []);
    const stride = Math.max(1, Math.ceil(vertices.length / VERTEX_CAP));
    for (let i = 0; i < vertices.length; i += stride) samples.push(vertices[i]);
    return samples;
  }

  const ml = toMultiLineString(geometry);
  if (ml) {
    const vertices = ml.coordinates.flat();
    const stride = Math.max(1, Math.ceil(vertices.length / VERTEX_CAP));
    const samples: Position[] = [];
    for (let i = 0; i < vertices.length; i += stride) samples.push(vertices[i]);
    return samples;
  }

  return [];
}

// The property containing the majority of the feature's sample points,
// or null when nothing convincingly contains it (the user then assigns
// by hand). A field straddling two properties goes to whichever holds
// more of it.
export function suggestPropertyId(
  geometry: Geometry,
  properties: Array<{ id: string; boundary: MultiPolygon | null }>
): string | null {
  const samples = samplePoints(geometry);
  if (samples.length === 0) return null;
  let bestId: string | null = null;
  let bestScore = 0;
  for (const property of properties) {
    if (!property.boundary) continue;
    let hits = 0;
    for (const sample of samples) {
      if (pointInMultiPolygon(sample, property.boundary)) hits++;
    }
    const score = hits / samples.length;
    if (score > bestScore) {
      bestScore = score;
      bestId = property.id;
    }
  }
  return bestScore >= 0.5 ? bestId : null;
}
