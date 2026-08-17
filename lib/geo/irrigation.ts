// Irrigated-acres intersection math: area of an ag field's boundary
// intersected with the UNION of irrigation coverage polygons (pivot
// plantable shapes and lateral strips). The database column
// fields.irrigated_acres is derived by the SAME rule in PostGIS
// (recompute_field_irrigation, migration 0014) and is the source of
// truth; this pure mirror exists for unit tests and any client-side
// previews. Union first, so several pivots overlapping one field count
// once.

import type { Feature, MultiPolygon, Polygon } from "geojson";
import turfUnion from "@turf/union";
import turfIntersect from "@turf/intersect";
import turfArea from "@turf/area";

const ACRES_PER_SQM = 1 / 4046.8564224;

function asFeature(g: Polygon | MultiPolygon): Feature<Polygon | MultiPolygon> {
  return { type: "Feature", properties: {}, geometry: g };
}

export function irrigatedAcres(
  fieldBoundary: Polygon | MultiPolygon | null,
  coverages: Array<Polygon | MultiPolygon>
): number {
  if (!fieldBoundary || coverages.length === 0) return 0;
  let union: Polygon | MultiPolygon | null = null;
  for (const c of coverages) {
    if (!union) {
      union = c;
      continue;
    }
    const merged: Feature<Polygon | MultiPolygon> | null = turfUnion({
      type: "FeatureCollection",
      features: [asFeature(union), asFeature(c)],
    });
    if (merged) union = merged.geometry;
  }
  if (!union) return 0;
  const intersection = turfIntersect({
    type: "FeatureCollection",
    features: [asFeature(fieldBoundary), asFeature(union)],
  });
  if (!intersection) return 0;
  return turfArea(intersection) * ACRES_PER_SQM;
}
