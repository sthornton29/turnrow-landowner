// Parametric circular footprints for assets (grain bins first; any
// round structure, tank pad, or round pond is fair game). Stored as
// center + diameter in the asset's details; the polygon is DERIVED and
// regenerated on every edit, never vertex-edited (the pivot pattern).
// For grain bins the diameter IS the bin's diameter_ft spec, so the
// circle editor and the asset form edit the same number two ways.

import type { Polygon } from "geojson";
import { destination, distanceFt } from "./pivot";

export interface CircleParams {
  center: [number, number]; // lon, lat
  diameterFt: number;
}

export const FOOTPRINT_SHAPE_KEY = "footprint_shape";
export const MIN_CIRCLE_DIAMETER_FT = 4;
export const DEFAULT_CIRCLE_DIAMETER_FT = 48; // a common bin size

const FT_TO_M = 0.3048;
const SQFT_PER_ACRE = 43560;

export function circlePolygon(params: CircleParams, steps = 48): Polygon {
  const radiusM = (params.diameterFt / 2) * FT_TO_M;
  const ring = [];
  for (let i = 0; i < steps; i++) {
    ring.push(destination(params.center, radiusM, (i * 360) / steps));
  }
  ring.push(ring[0]);
  return { type: "Polygon", coordinates: [ring] };
}

// Planar area of the true circle (what the user expects to read), not
// the polygon approximation.
export function circleAreaSqFt(diameterFt: number): number {
  const r = diameterFt / 2;
  return Math.PI * r * r;
}

export function circleAcres(diameterFt: number): number {
  return circleAreaSqFt(diameterFt) / SQFT_PER_ACRE;
}

// Diameter from a dragged rim handle.
export function diameterFromRimPoint(
  center: [number, number],
  rim: [number, number]
): number {
  return Math.max(MIN_CIRCLE_DIAMETER_FT, Math.round(distanceFt(center, rim) * 2));
}

// Rim handle position (east of center) for the editor.
export function rimPoint(params: CircleParams): [number, number] {
  const p = destination(params.center, (params.diameterFt / 2) * FT_TO_M, 90);
  return [p[0], p[1]];
}

// Read stored details back into params (null when the asset is not a
// circle footprint or the numbers are incomplete).
export function circleFromDetails(
  details: Record<string, unknown> | null | undefined
): CircleParams | null {
  if (!details || details[FOOTPRINT_SHAPE_KEY] !== "circle") return null;
  const lon = Number(details.center_lon);
  const lat = Number(details.center_lat);
  const d = Number(details.diameter_ft);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || !(d > 0)) return null;
  return { center: [lon, lat], diameterFt: d };
}

// Write params into the details shape (merged over existing details by
// the caller). diameter_ft is the shared key: for grain bins it is the
// spec field on the asset form, so typing there and dragging here
// change the same number.
export function detailsFromCircle(params: CircleParams): Record<string, unknown> {
  return {
    [FOOTPRINT_SHAPE_KEY]: "circle",
    center_lon: Math.round(params.center[0] * 1e7) / 1e7,
    center_lat: Math.round(params.center[1] * 1e7) / 1e7,
    diameter_ft: Math.round(params.diameterFt * 10) / 10,
  };
}

// Two-way sync from the FORM side: when a circle footprint exists and
// the typed diameter_ft differs from the stored circle, the polygon
// must be regenerated. Returns the new polygon, or null when nothing
// about the circle changed (no geometry write needed).
export function circleUpdateForDetails(
  previous: Record<string, unknown> | null | undefined,
  next: Record<string, unknown>
): { params: CircleParams; polygon: Polygon } | null {
  const before = circleFromDetails(previous);
  if (!before) return null;
  const typed = Number(next.diameter_ft);
  if (!(typed > 0) || Math.abs(typed - before.diameterFt) < 0.05) return null;
  const params = { center: before.center, diameterFt: typed };
  return { params, polygon: circlePolygon(params) };
}

// Footprint size as a human line: square feet under about half an
// acre (a bin pad reads in sq ft), acres above that.
export function formatFootprint(
  sqFt: number,
  fmtAcres: (a: number) => string,
  fmtNumber: (n: number) => string
): string {
  const acres = sqFt / SQFT_PER_ACRE;
  return acres < 0.5 ? `${fmtNumber(Math.round(sqFt))} sq ft` : `${fmtAcres(acres)} acres`;
}
