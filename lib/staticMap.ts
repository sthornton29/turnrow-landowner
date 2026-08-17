// Static satellite thumbnails with the record's geometry overlaid, via
// the Mapbox Static Images API. The overlay is a URL-encoded GeoJSON
// feature with simplestyle properties; boundaries are simplified with
// escalating tolerance until the URL fits comfortably under the API's
// ~8KB limit. Returns null when there is nothing drawable.

import type { Geometry, Position } from "geojson";
import turfSimplify from "@turf/simplify";

const KELLY = "#39b54a";
const MAX_GEOJSON_CHARS = 5500; // encoded overlay budget

function round5(pos: Position): Position {
  return [Math.round((pos[0] as number) * 1e5) / 1e5, Math.round((pos[1] as number) * 1e5) / 1e5];
}

function roundCoords(g: Geometry): Geometry {
  const walk = (c: unknown): unknown =>
    Array.isArray(c) && typeof c[0] === "number"
      ? round5(c as Position)
      : Array.isArray(c)
        ? c.map(walk)
        : c;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { ...g, coordinates: walk((g as any).coordinates) } as Geometry;
}

export function staticMapUrl(
  geometry: Geometry | null | undefined,
  opts: { width?: number; height?: number; color?: string } = {}
): string | null {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!geometry || !token) return null;
  const { width = 640, height = 320, color = KELLY } = opts;

  if (geometry.type === "Point") {
    const [lon, lat] = geometry.coordinates as [number, number];
    const pin = `pin-s+${color.slice(1)}(${lon.toFixed(5)},${lat.toFixed(5)})`;
    return `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/${pin}/${lon.toFixed(5)},${lat.toFixed(5)},15/${width}x${height}@2x?access_token=${token}`;
  }

  const isLine = geometry.type.includes("Line");
  const style = isLine
    ? { stroke: color, "stroke-width": 3 }
    : { stroke: color, "stroke-width": 3, fill: color, "fill-opacity": 0.25 };

  // Simplify until the encoded feature fits the URL budget.
  let g = roundCoords(geometry);
  for (const tolerance of [0, 0.00005, 0.0002, 0.001, 0.005]) {
    const candidate =
      tolerance === 0
        ? g
        : (() => {
            try {
              return roundCoords(
                turfSimplify(
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  { type: "Feature", properties: {}, geometry } as any,
                  { tolerance, highQuality: false }
                ).geometry as Geometry
              );
            } catch {
              return g;
            }
          })();
    const feature = JSON.stringify({
      type: "Feature",
      properties: style,
      geometry: candidate,
    });
    if (feature.length <= MAX_GEOJSON_CHARS || tolerance === 0.005) {
      if (feature.length > MAX_GEOJSON_CHARS) return null; // still too big
      const overlay = `geojson(${encodeURIComponent(feature)})`;
      return `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/${overlay}/auto/${width}x${height}@2x?padding=40&access_token=${token}`;
    }
    g = candidate;
  }
  return null;
}
