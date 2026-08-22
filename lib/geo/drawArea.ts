import type { Geometry, MultiPolygon, Position } from "geojson";
import { approxAcres } from "@/lib/geo/normalize";

// Per-shape acreage while drawing. mapbox-gl-draw keeps every shape on
// the canvas as its own feature, including the one in progress (whose
// ring carries a trailing duplicate vertex that follows the cursor), so
// the readout can say "this shape is X acres" for each one and never
// fold the shape being drawn into the completed ones.

export function shapeAcres(geometry: Geometry | null | undefined): number {
  if (!geometry) return 0;
  if (geometry.type === "Polygon") return approxAcres({ type: "MultiPolygon", coordinates: [geometry.coordinates] });
  if (geometry.type === "MultiPolygon") return approxAcres(geometry as MultiPolygon);
  return 0;
}

// Distinct vertices of the outer ring (the closing point and the
// cursor-follow duplicate do not count).
function distinctVertices(geometry: Geometry): number {
  const ring: Position[] | undefined =
    geometry.type === "Polygon" ? geometry.coordinates[0] : geometry.type === "MultiPolygon" ? geometry.coordinates[0]?.[0] : undefined;
  if (!ring) return 0;
  const seen = new Set(ring.map((p) => `${p[0]},${p[1]}`));
  return seen.size;
}

export interface ShapeArea {
  id: string;
  acres: number;
}

export interface DrawAreaReadout {
  // The shape being drawn right now, once it has three distinct points.
  active: ShapeArea | null;
  // Every completed shape, in draw order.
  completed: ShapeArea[];
  total: number;
}

export function drawAreaReadout(
  features: Array<{ id: string | number | undefined; geometry: Geometry }>,
  completedIds: Set<string>
): DrawAreaReadout {
  const completed: ShapeArea[] = [];
  let active: ShapeArea | null = null;
  for (const f of features) {
    const id = String(f.id ?? "");
    if (completedIds.has(id)) {
      completed.push({ id, acres: shapeAcres(f.geometry) });
      continue;
    }
    if (active) continue;
    if (distinctVertices(f.geometry) >= 3) active = { id, acres: shapeAcres(f.geometry) };
  }
  const total = completed.reduce((a, s) => a + s.acres, 0) + (active?.acres ?? 0);
  return { active, completed, total };
}
