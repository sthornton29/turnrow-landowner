// Parametric pivot coverage circles: pure math from (center, radius,
// sweep) to a polygon, plus the handle-drag helpers. Bearings use the
// compass convention: 0 = north, clockwise; a partial circle sweeps
// CLOCKWISE from start_bearing to end_bearing. The polygon is always
// DERIVED from these parameters and regenerated on every edit; pivot
// circles are never vertex-edited. Unit tests in pivot.test.ts.

import type { Polygon, Position } from "geojson";

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

// Read stored pivot details back into params (null when incomplete).
export function paramsFromDetails(
  details: Record<string, unknown> | null | undefined
): PivotParams | null {
  if (!details) return null;
  const lon = Number(details.center_lon);
  const lat = Number(details.center_lat);
  const radiusFt = Number(details.wetted_length_ft);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || !(radiusFt > 0)) return null;
  const full = details.full_circle !== false; // default full
  const start = Number(details.start_bearing_deg);
  const end = Number(details.end_bearing_deg);
  return {
    center: [lon, lat],
    radiusFt,
    fullCircle: full,
    startBearingDeg: !full && Number.isFinite(start) ? start : null,
    endBearingDeg: !full && Number.isFinite(end) ? end : null,
  };
}
