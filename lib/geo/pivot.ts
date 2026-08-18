// Parametric pivot coverage shapes: pure math from parameters to a
// polygon, plus the handle-drag helpers. Bearings use the compass
// convention: 0 = north, clockwise; a partial circle sweeps CLOCKWISE
// from start_bearing to end_bearing. The geometry is always DERIVED
// from the parameters and regenerated on every edit; pivot shapes are
// never vertex-edited (except via the one-way custom-shape escape
// hatch). The COMPOSITE model covers real machines: extension zones
// (end guns, corner arms, benders: a sector at a longer radius unioned
// on), skip sectors (obstacle wraps, differenced out), cutout polygons
// (pond/road: watered but not plantable, cut as holes), towable
// positions (several separate circles, one machine), and lateral moves
// (a travel path swept by the machine length). Unit tests in
// pivot.test.ts.

import type { Feature, MultiPolygon, Polygon, Position } from "geojson";
import turfUnion from "@turf/union";
import turfDifference from "@turf/difference";
import turfArea from "@turf/area";

export interface PivotParams {
  center: [number, number]; // lon, lat
  radiusFt: number;
  fullCircle: boolean;
  startBearingDeg: number | null; // null when full
  endBearingDeg: number | null;
}

const FT_TO_M = 0.3048;
const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LON_EQ = 111320;

// Planar offset approximation: plenty accurate at pivot scale (a
// half-mile radius errs by inches).
export function destination(
  center: [number, number],
  distanceM: number,
  bearingDeg: number
): Position {
  const rad = (bearingDeg * Math.PI) / 180;
  const latRad = (center[1] * Math.PI) / 180;
  return [
    center[0] + (distanceM * Math.sin(rad)) / (M_PER_DEG_LON_EQ * Math.cos(latRad)),
    center[1] + (distanceM * Math.cos(rad)) / M_PER_DEG_LAT,
  ];
}

export function distanceFt(center: [number, number], point: [number, number]): number {
  const latRad = (center[1] * Math.PI) / 180;
  const dx = (point[0] - center[0]) * M_PER_DEG_LON_EQ * Math.cos(latRad);
  const dy = (point[1] - center[1]) * M_PER_DEG_LAT;
  return Math.hypot(dx, dy) / FT_TO_M;
}

// Compass bearing from the center to a point (0 = north, clockwise).
// Uses the same meter conversions as destination() so the two invert
// each other exactly.
export function bearingTo(center: [number, number], point: [number, number]): number {
  const latRad = (center[1] * Math.PI) / 180;
  const dx = (point[0] - center[0]) * M_PER_DEG_LON_EQ * Math.cos(latRad);
  const dy = (point[1] - center[1]) * M_PER_DEG_LAT;
  const deg = (Math.atan2(dx, dy) * 180) / Math.PI;
  return (deg + 360) % 360;
}

// Clockwise sweep from start to end; equal bearings mean a full 360.
export function sweepDegrees(startDeg: number, endDeg: number): number {
  const sweep = (((endDeg - startDeg) % 360) + 360) % 360;
  return sweep === 0 ? 360 : sweep;
}

// Light snapping to the common sweeps: if the sweep lands within
// tolerance of 90/180/270, nudge the END bearing onto it. Free angles
// otherwise.
export function snapEndBearing(
  startDeg: number,
  endDeg: number,
  toleranceDeg = 3
): number {
  const sweep = sweepDegrees(startDeg, endDeg);
  for (const target of [90, 180, 270]) {
    if (Math.abs(sweep - target) <= toleranceDeg) {
      return (startDeg + target) % 360;
    }
  }
  return (endDeg + 360) % 360;
}

// Circle for full pivots, sector wedge for partials, at least 64 steps
// around a full circle (partials get a proportional share, minimum 8).
export function pivotPolygon(params: PivotParams, steps = 64): Polygon {
  const radiusM = params.radiusFt * FT_TO_M;
  if (
    params.fullCircle ||
    params.startBearingDeg === null ||
    params.endBearingDeg === null
  ) {
    const ring: Position[] = [];
    for (let i = 0; i <= steps; i++) {
      ring.push(destination(params.center, radiusM, (i * 360) / steps));
    }
    ring[ring.length - 1] = ring[0];
    return { type: "Polygon", coordinates: [ring] };
  }
  const sweep = sweepDegrees(params.startBearingDeg, params.endBearingDeg);
  const arcSteps = Math.max(8, Math.ceil((steps * sweep) / 360));
  const ring: Position[] = [params.center];
  for (let i = 0; i <= arcSteps; i++) {
    ring.push(
      destination(
        params.center,
        radiusM,
        params.startBearingDeg + (i * sweep) / arcSteps
      )
    );
  }
  ring.push(params.center);
  return { type: "Polygon", coordinates: [ring] };
}

// ---------------------------------------------------------------------
// Composite model: base circle/sector + manually drawn add/cut polygons
// (adds cover corner arms, end guns, and odd reaches; cuts cover ponds,
// waterways, and obstacles).
// ---------------------------------------------------------------------

export interface CompositePivotParams extends PivotParams {
  addPolygons: Polygon[]; // unioned into the coverage
  cutPolygons: Polygon[]; // differenced out (watered but not plantable)
}

const ACRES_PER_SQM = 1 / 4046.8564224;

function asFeature(g: Polygon | MultiPolygon): Feature<Polygon | MultiPolygon> {
  return { type: "Feature", properties: {}, geometry: g };
}

function unionAll(
  geoms: Array<Polygon | MultiPolygon>
): Polygon | MultiPolygon | null {
  let acc: Polygon | MultiPolygon | null = null;
  for (const g of geoms) {
    if (!acc) {
      acc = g;
      continue;
    }
    const merged: Feature<Polygon | MultiPolygon> | null = turfUnion({
      type: "FeatureCollection",
      features: [asFeature(acc), asFeature(g)],
    });
    if (merged) acc = merged.geometry;
  }
  return acc;
}

function differenceAll(
  base: Polygon | MultiPolygon,
  cuts: Array<Polygon | MultiPolygon>
): Polygon | MultiPolygon | null {
  let acc: Polygon | MultiPolygon | null = base;
  for (const cut of cuts) {
    if (!acc) return null;
    const result = turfDifference({
      type: "FeatureCollection",
      features: [asFeature(acc), asFeature(cut)],
    });
    acc = result ? result.geometry : null;
  }
  return acc;
}

export function acresOfGeometry(g: Polygon | MultiPolygon | null): number {
  if (!g) return 0;
  return turfArea(asFeature(g)) * ACRES_PER_SQM;
}

// The full composite: base plus drawn add polygons (gross watered),
// minus drawn cut polygons (plantable). Returns both geometries and
// both acre numbers; plantable is the headline coverage.
export function compositePivotGeometry(params: CompositePivotParams): {
  watered: Polygon | MultiPolygon;
  plantable: Polygon | MultiPolygon;
  grossAcres: number;
  plantableAcres: number;
} {
  const watered =
    unionAll([pivotPolygon(params), ...params.addPolygons]) ?? pivotPolygon(params);
  const plantable = differenceAll(watered, params.cutPolygons) ?? watered;
  return {
    watered,
    plantable,
    grossAcres: acresOfGeometry(watered),
    plantableAcres: acresOfGeometry(plantable),
  };
}

// ---------------------------------------------------------------------
// Details (jsonb) serialization, snake_case like the stored scalars
// ---------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */

function polygonList(raw: unknown): Polygon[] {
  return (Array.isArray(raw) ? raw : [])
    .map((rings: any): Polygon | null =>
      Array.isArray(rings) ? { type: "Polygon", coordinates: rings } : null
    )
    .filter((p: Polygon | null): p is Polygon => p !== null);
}

// Read stored pivot details back into composite params (null when
// incomplete). Rows saved before migration 0015 stored cut polygons
// under 'cutouts'; both keys read.
export function compositeFromDetails(
  details: Record<string, unknown> | null | undefined
): CompositePivotParams | null {
  if (!details) return null;
  const lon = Number(details.center_lon);
  const lat = Number(details.center_lat);
  const radiusFt = Number(details.wetted_length_ft);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || !(radiusFt > 0)) return null;
  const full = details.full_circle !== false;
  const start = Number(details.start_bearing_deg);
  const end = Number(details.end_bearing_deg);
  return {
    center: [lon, lat],
    radiusFt,
    fullCircle: full,
    startBearingDeg: !full && Number.isFinite(start) ? start : null,
    endBearingDeg: !full && Number.isFinite(end) ? end : null,
    addPolygons: polygonList(details.add_polygons),
    cutPolygons: polygonList(details.cut_polygons ?? details.cutouts),
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// Write composite params into the details shape (merged over existing
// details by the caller). Base radius stays wetted_length_ft (it
// doubles as the machine's spec field on the asset form).
export function detailsFromComposite(
  params: CompositePivotParams
): Record<string, unknown> {
  return {
    center_lon: Math.round(params.center[0] * 1e6) / 1e6,
    center_lat: Math.round(params.center[1] * 1e6) / 1e6,
    wetted_length_ft: Math.round(params.radiusFt),
    full_circle: params.fullCircle,
    start_bearing_deg: params.fullCircle ? null : params.startBearingDeg,
    end_bearing_deg: params.fullCircle ? null : params.endBearingDeg,
    add_polygons: params.addPolygons.map((p) => p.coordinates),
    cut_polygons: params.cutPolygons.map((p) => p.coordinates),
  };
}

// Read stored pivot details back into base params (null when
// incomplete). Kept for callers that only need the base circle.
export function paramsFromDetails(
  details: Record<string, unknown> | null | undefined
): PivotParams | null {
  return compositeFromDetails(details);
}
