// Spatial reference guard for county GIS responses. We always request
// outSR=4326, but a misbehaving ArcGIS server can ignore it and return
// Web Mercator (wkid 102100/3857) coordinates, which would import as
// garbage geometry. These pure functions detect and repair that.
// Unit tests live in lib/geo/spatialRef.test.ts.

import type { Geometry, Position } from "geojson";

const EARTH_RADIUS_M = 6378137;

// Latitude/longitude coordinates can never exceed these bounds; Web
// Mercator coordinates for real land are in the millions of meters.
export function isPlausiblyLatLon(geometry: Geometry): boolean {
  let ok = true;
  visitPositions(geometry, ([x, y]) => {
    if (Math.abs(x) > 180 || Math.abs(y) > 90) ok = false;
  });
  return ok;
}

function mercatorToLonLat([x, y]: Position): Position {
  const lon = (x / EARTH_RADIUS_M) * (180 / Math.PI);
  const lat =
    (2 * Math.atan(Math.exp(y / EARTH_RADIUS_M)) - Math.PI / 2) * (180 / Math.PI);
  return [lon, lat];
}

// Returns a new geometry with every coordinate converted from Web
// Mercator meters to WGS84 degrees.
export function webMercatorToWgs84(geometry: Geometry): Geometry {
  return mapPositions(geometry, mercatorToLonLat);
}

// If the geometry is not plausibly lat/lon, assume Web Mercator and
// reproject. Returns the geometry to use plus whether a repair happened.
export function ensureWgs84(geometry: Geometry): {
  geometry: Geometry;
  reprojected: boolean;
} {
  if (isPlausiblyLatLon(geometry)) return { geometry, reprojected: false };
  return { geometry: webMercatorToWgs84(geometry), reprojected: true };
}

function visitPositions(geometry: Geometry, visit: (p: Position) => void): void {
  if (geometry.type === "GeometryCollection") {
    for (const g of geometry.geometries) visitPositions(g, visit);
    return;
  }
  const walk = (coords: unknown): void => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === "number") {
      visit(coords as Position);
      return;
    }
    for (const c of coords) walk(c);
  };
  walk(geometry.coordinates);
}

function mapPositions(
  geometry: Geometry,
  transform: (p: Position) => Position
): Geometry {
  if (geometry.type === "GeometryCollection") {
    return {
      ...geometry,
      geometries: geometry.geometries.map((g) => mapPositions(g, transform)),
    };
  }
  const walk = (coords: unknown): unknown => {
    if (!Array.isArray(coords)) return coords;
    if (typeof coords[0] === "number") return transform(coords as Position);
    return coords.map(walk);
  };
  return {
    ...geometry,
    coordinates: walk(geometry.coordinates),
  } as Geometry;
}
