import type {
  Feature,
  FeatureCollection,
  Geometry,
  MultiPolygon,
  Polygon,
  Position,
} from "geojson";

// The database stores every boundary as a MultiPolygon. This converts any
// polygon-bearing geometry (Polygon, MultiPolygon, GeometryCollection) into
// one, and returns null for non-areal geometry (points, lines).
export function toMultiPolygon(geometry: Geometry | null | undefined): MultiPolygon | null {
  if (!geometry) return null;
  switch (geometry.type) {
    case "Polygon":
      return { type: "MultiPolygon", coordinates: [geometry.coordinates] };
    case "MultiPolygon":
      return geometry.coordinates.length > 0 ? geometry : null;
    case "GeometryCollection": {
      const polys: Position[][][] = [];
      for (const g of geometry.geometries) {
        const mp = toMultiPolygon(g);
        if (mp) polys.push(...mp.coordinates);
      }
      return polys.length > 0 ? { type: "MultiPolygon", coordinates: polys } : null;
    }
    default:
      return null;
  }
}

// Bounding box [west, south, east, north] across a set of geometries.
export function bboxOf(
  geometries: Array<MultiPolygon | Polygon | null | undefined>
): [number, number, number, number] | null {
  let west = Infinity,
    south = Infinity,
    east = -Infinity,
    north = -Infinity;
  let found = false;

  const visit = (coords: unknown): void => {
    if (Array.isArray(coords)) {
      if (typeof coords[0] === "number" && typeof coords[1] === "number") {
        const [x, y] = coords as [number, number];
        west = Math.min(west, x);
        south = Math.min(south, y);
        east = Math.max(east, x);
        north = Math.max(north, y);
        found = true;
      } else {
        for (const c of coords) visit(c);
      }
    }
  };

  for (const g of geometries) {
    if (g) visit(g.coordinates);
  }
  return found ? [west, south, east, north] : null;
}

// Approximate centroid (average of the outer ring's vertices) for labels.
export function labelPointOf(mp: MultiPolygon): [number, number] | null {
  // Use the largest polygon's outer ring.
  let best: Position[] | null = null;
  let bestLen = -1;
  for (const poly of mp.coordinates) {
    const ring = poly[0];
    if (ring && ring.length > bestLen) {
      best = ring;
      bestLen = ring.length;
    }
  }
  if (!best || best.length === 0) return null;
  let sx = 0,
    sy = 0;
  for (const [x, y] of best) {
    sx += x;
    sy += y;
  }
  return [sx / best.length, sy / best.length];
}

// Quick client-side acreage estimate (spherical approximation, same method
// Mapbox/Turf use). The authoritative number is computed by PostGIS on save.
export function approxAcres(mp: MultiPolygon): number {
  const RAD = Math.PI / 180;
  const R = 6378137;
  let total = 0;
  for (const poly of mp.coordinates) {
    poly.forEach((ring, ringIndex) => {
      let sum = 0;
      for (let i = 0; i < ring.length - 1; i++) {
        const [x1, y1] = ring[i];
        const [x2, y2] = ring[i + 1];
        sum += (x2 - x1) * RAD * (2 + Math.sin(y1 * RAD) + Math.sin(y2 * RAD));
      }
      const area = Math.abs((sum * R * R) / 2);
      total += ringIndex === 0 ? area : -area;
    });
  }
  return Math.max(total, 0) / 4046.8564224;
}

export function emptyFeatureCollection(): FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

export function makeFeature(
  geometry: Geometry,
  properties: Record<string, unknown>
): Feature {
  return { type: "Feature", geometry, properties };
}
