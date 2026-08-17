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
// Composite model
// ---------------------------------------------------------------------

export interface ExtensionZone {
  startBearingDeg: number;
  endBearingDeg: number;
  outerRadiusFt: number; // reach within the zone (end gun, corner arm)
}

export interface SkipZone {
  startBearingDeg: number;
  endBearingDeg: number; // wedge never watered (barn, pond, road wrap)
}

export interface PivotPosition extends PivotParams {
  extensions: ExtensionZone[];
  skips: SkipZone[];
}

export interface CompositePivotParams extends PivotPosition {
  cutouts: Polygon[]; // watered but not plantable; cut as holes
  positions: PivotPosition[]; // towable: additional positions
}

const ACRES_PER_SQM = 1 / 4046.8564224;

function asFeature(g: Polygon | MultiPolygon): Feature<Polygon | MultiPolygon> {
  return { type: "Feature", properties: {}, geometry: g };
}

function sector(
  center: [number, number],
  radiusFt: number,
  startDeg: number | null,
  endDeg: number | null
): Polygon {
  return pivotPolygon({
    center,
    radiusFt,
    fullCircle: startDeg === null || endDeg === null,
    startBearingDeg: startDeg,
    endBearingDeg: endDeg,
  });
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

// One position's watered shape: base circle/sector, union each
// extension sector at its longer radius, then difference each skip
// wedge (cut past the longest reach so skips also cut extensions).
export function positionGeometry(pos: PivotPosition): Polygon | MultiPolygon {
  let geom: Polygon | MultiPolygon = pivotPolygon(pos);
  for (const ext of pos.extensions) {
    if (!(ext.outerRadiusFt > pos.radiusFt)) continue; // shorter adds nothing
    const merged: Polygon | MultiPolygon | null = unionAll([
      geom,
      sector(pos.center, ext.outerRadiusFt, ext.startBearingDeg, ext.endBearingDeg),
    ]);
    if (merged) geom = merged;
  }
  const maxReach = Math.max(pos.radiusFt, ...pos.extensions.map((e) => e.outerRadiusFt), 0);
  const skipCuts = pos.skips.map((s) =>
    sector(pos.center, maxReach * 1.02, s.startBearingDeg, s.endBearingDeg)
  );
  const cutResult = differenceAll(geom, skipCuts);
  return cutResult ?? geom;
}

export function acresOfGeometry(g: Polygon | MultiPolygon | null): number {
  if (!g) return 0;
  return turfArea(asFeature(g)) * ACRES_PER_SQM;
}

// The full composite: all positions unioned (gross watered), cutouts
// cut as holes (plantable). Returns both geometries and both acre
// numbers; plantable is the headline coverage.
export function compositePivotGeometry(params: CompositePivotParams): {
  watered: Polygon | MultiPolygon;
  plantable: Polygon | MultiPolygon;
  grossAcres: number;
  plantableAcres: number;
} {
  const watered =
    unionAll([params, ...params.positions].map(positionGeometry)) ??
    pivotPolygon(params);
  const plantable = differenceAll(watered, params.cutouts) ?? watered;
  return {
    watered,
    plantable,
    grossAcres: acresOfGeometry(watered),
    plantableAcres: acresOfGeometry(plantable),
  };
}

// ---------------------------------------------------------------------
// Lateral / linear moves: the travel path swept by the machine length
// (half each side of the drawn center track), flat ends. Segment
// rectangles plus joint disks at interior vertices, unioned.
// ---------------------------------------------------------------------

export function lateralPolygon(
  path: Position[],
  machineLengthFt: number
): Polygon | MultiPolygon | null {
  if (path.length < 2 || !(machineLengthFt > 0)) return null;
  const halfM = (machineLengthFt / 2) * FT_TO_M;
  const latRad = ((path[0][1] as number) * Math.PI) / 180;
  const mPerLon = M_PER_DEG_LON_EQ * Math.cos(latRad);
  const toXY = (p: Position): [number, number] => [
    (p[0] as number) * mPerLon,
    (p[1] as number) * M_PER_DEG_LAT,
  ];
  const toLonLat = (x: number, y: number): Position => [x / mPerLon, y / M_PER_DEG_LAT];

  const pieces: Polygon[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const [x1, y1] = toXY(path[i]);
    const [x2, y2] = toXY(path[i + 1]);
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len === 0) continue;
    const nx = (-(y2 - y1) / len) * halfM;
    const ny = ((x2 - x1) / len) * halfM;
    pieces.push({
      type: "Polygon",
      coordinates: [[
        toLonLat(x1 + nx, y1 + ny),
        toLonLat(x2 + nx, y2 + ny),
        toLonLat(x2 - nx, y2 - ny),
        toLonLat(x1 - nx, y1 - ny),
        toLonLat(x1 + nx, y1 + ny),
      ]],
    });
  }
  // Joint disks keep angled joins continuous (the machine pivots
  // through the corner); the path ends stay flat.
  for (let i = 1; i < path.length - 1; i++) {
    pieces.push(sector(path[i] as [number, number], machineLengthFt / 2, null, null));
  }
  return unionAll(pieces);
}

export function lateralGeometry(
  path: Position[],
  machineLengthFt: number,
  cutouts: Polygon[]
): {
  watered: Polygon | MultiPolygon;
  plantable: Polygon | MultiPolygon;
  grossAcres: number;
  plantableAcres: number;
} | null {
  const watered = lateralPolygon(path, machineLengthFt);
  if (!watered) return null;
  const plantable = differenceAll(watered, cutouts) ?? watered;
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

function positionFromRaw(raw: any): PivotPosition | null {
  const lon = Number(raw?.center_lon);
  const lat = Number(raw?.center_lat);
  const radiusFt = Number(raw?.radius_ft ?? raw?.wetted_length_ft);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || !(radiusFt > 0)) return null;
  const full = raw.full_circle !== false;
  const start = Number(raw.start_bearing_deg);
  const end = Number(raw.end_bearing_deg);
  return {
    center: [lon, lat],
    radiusFt,
    fullCircle: full,
    startBearingDeg: !full && Number.isFinite(start) ? start : null,
    endBearingDeg: !full && Number.isFinite(end) ? end : null,
    extensions: (Array.isArray(raw.extensions) ? raw.extensions : [])
      .map((e: any) => ({
        startBearingDeg: Number(e?.start_bearing_deg),
        endBearingDeg: Number(e?.end_bearing_deg),
        outerRadiusFt: Number(e?.outer_radius_ft),
      }))
      .filter(
        (e: ExtensionZone) =>
          Number.isFinite(e.startBearingDeg) &&
          Number.isFinite(e.endBearingDeg) &&
          e.outerRadiusFt > 0
      ),
    skips: (Array.isArray(raw.skips) ? raw.skips : [])
      .map((s: any) => ({
        startBearingDeg: Number(s?.start_bearing_deg),
        endBearingDeg: Number(s?.end_bearing_deg),
      }))
      .filter(
        (s: SkipZone) =>
          Number.isFinite(s.startBearingDeg) && Number.isFinite(s.endBearingDeg)
      ),
  };
}

// Read stored pivot details back into composite params (null when
// incomplete). Pre-composite pivots read as empty zone lists.
export function compositeFromDetails(
  details: Record<string, unknown> | null | undefined
): CompositePivotParams | null {
  if (!details) return null;
  const base = positionFromRaw(details);
  if (!base) return null;
  return {
    ...base,
    cutouts: (Array.isArray(details.cutouts) ? details.cutouts : [])
      .map((rings: any): Polygon | null =>
        Array.isArray(rings) ? { type: "Polygon", coordinates: rings } : null
      )
      .filter((p: Polygon | null): p is Polygon => p !== null),
    positions: (Array.isArray(details.positions) ? details.positions : [])
      .map(positionFromRaw)
      .filter((p: PivotPosition | null): p is PivotPosition => p !== null),
  };
}

function rawFromPosition(pos: PivotPosition, radiusKey: string): Record<string, unknown> {
  return {
    center_lon: Math.round(pos.center[0] * 1e6) / 1e6,
    center_lat: Math.round(pos.center[1] * 1e6) / 1e6,
    [radiusKey]: Math.round(pos.radiusFt),
    full_circle: pos.fullCircle,
    start_bearing_deg: pos.fullCircle ? null : pos.startBearingDeg,
    end_bearing_deg: pos.fullCircle ? null : pos.endBearingDeg,
    extensions: pos.extensions.map((e) => ({
      start_bearing_deg: Math.round(e.startBearingDeg * 10) / 10,
      end_bearing_deg: Math.round(e.endBearingDeg * 10) / 10,
      outer_radius_ft: Math.round(e.outerRadiusFt),
    })),
    skips: pos.skips.map((s) => ({
      start_bearing_deg: Math.round(s.startBearingDeg * 10) / 10,
      end_bearing_deg: Math.round(s.endBearingDeg * 10) / 10,
    })),
  };
}

// Write composite params into the details shape (merged over existing
// details by the caller). Base radius stays wetted_length_ft.
export function detailsFromComposite(
  params: CompositePivotParams
): Record<string, unknown> {
  return {
    ...rawFromPosition(params, "wetted_length_ft"),
    cutouts: params.cutouts.map((c) => c.coordinates),
    positions: params.positions.map((p) => rawFromPosition(p, "radius_ft")),
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// Read stored pivot details back into base params (null when
// incomplete). Kept for callers that only need the base circle.
export function paramsFromDetails(
  details: Record<string, unknown> | null | undefined
): PivotParams | null {
  return compositeFromDetails(details);
}
