// Server-side CropScape (USDA NASS Cropland Data Layer) access for
// Timber Scan. Endpoints live-verified 2026-08-16: GetCDLFile returns
// XML with a URL to a GeoTIFF clipped to a bbox in CONUS Albers
// (EPSG:5070, 30m pixels); GetCDLValue was used to verify the forest
// class codes empirically (see raster.ts CDL_TO_CLASS).

import { fromArrayBuffer } from "geotiff";
import proj4 from "proj4";

const CDL_SERVICE = "https://nassgeodata.gmu.edu/axis2/services/CDLService";
const TIMEOUT_MS = 45000; // CropScape clips on demand and can be slow
// The whole scan must answer inside the route's 60 second limit. Past
// that the platform cuts the request off with a page the browser cannot
// read, so every fetch below shares ONE clock and gives up, with a plain
// message, before the platform does.
const TOTAL_BUDGET_MS = 50000;

const SLOW_MESSAGE =
  "The USDA land cover service did not respond in time. It is sometimes slow or down; try again in a few minutes.";

// EPSG:5070, CONUS Albers Equal Area (NAD83).
const ALBERS =
  "+proj=aea +lat_0=23 +lon_0=-96 +lat_1=29.5 +lat_2=45.5 +x_0=0 +y_0=0 +datum=NAD83 +units=m +no_defs";

export function toAlbers(lonLat: [number, number]): [number, number] {
  return proj4("EPSG:4326", ALBERS, lonLat);
}

export function toWgs84(xy: [number, number]): [number, number] {
  return proj4(ALBERS, "EPSG:4326", xy);
}

export class CdlError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

// deadline: the wall-clock time (ms) by which the whole scan must be done.
async function fetchWithTimeout(url: string, deadline: number): Promise<Response> {
  const remaining = deadline - Date.now();
  if (remaining <= 1000) throw new CdlError(SLOW_MESSAGE, 504);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(TIMEOUT_MS, remaining));
  try {
    return await fetch(url, { signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new CdlError(SLOW_MESSAGE, 504);
    }
    throw new CdlError("Could not reach the USDA land cover service.");
  } finally {
    clearTimeout(timer);
  }
}

export interface CdlGrid {
  values: Uint8Array | Uint16Array | Int32Array | Float32Array;
  width: number;
  height: number;
  originX: number; // EPSG:5070 meters, top-left corner of pixel (0,0)
  originY: number;
  pixel: number; // 30
  year: number;
}

// Project a 4326 bbox into a 5070 bbox: corners plus edge midpoints
// (projection curvature), padded two pixels.
function albersBbox(
  bbox4326: [number, number, number, number]
): [number, number, number, number] {
  const [w, s, e, n] = bbox4326;
  const samples: Array<[number, number]> = [
    [w, s], [e, s], [e, n], [w, n],
    [(w + e) / 2, s], [(w + e) / 2, n], [w, (s + n) / 2], [e, (s + n) / 2],
  ];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of samples) {
    const [x, y] = toAlbers(p);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const pad = 60;
  return [minX - pad, minY - pad, maxX + pad, maxY + pad];
}

async function fetchYear(
  bbox: [number, number, number, number],
  year: number,
  deadline: number
): Promise<CdlGrid | null> {
  const bboxParam = bbox.map((v) => v.toFixed(0)).join(",");
  const response = await fetchWithTimeout(
    `${CDL_SERVICE}/GetCDLFile?year=${year}&bbox=${bboxParam}`,
    deadline
  );
  // A server error is the service being down, not "no layer for this
  // year": say so instead of walking back through older years and then
  // reporting that no layer exists.
  if (response.status >= 500) {
    throw new CdlError(
      "The USDA land cover service is having trouble right now. Try again in a few minutes."
    );
  }
  const text = await response.text();
  const match = text.match(/<returnURL>([^<]+)<\/returnURL>/);
  if (!match) return null; // year not available

  const tifResponse = await fetchWithTimeout(match[1], deadline);
  if (!tifResponse.ok) {
    throw new CdlError("The land cover file could not be downloaded.");
  }
  const tif = await fromArrayBuffer(await tifResponse.arrayBuffer());
  const image = await tif.getImage();
  const rasters = await image.readRasters();
  const [originX, originY] = image.getOrigin();
  const [resX] = image.getResolution();
  return {
    values: rasters[0] as CdlGrid["values"],
    width: image.getWidth(),
    height: image.getHeight(),
    originX,
    originY,
    pixel: Math.abs(resX),
    year,
  };
}

// The years to try when none was asked for, newest first. The layer for
// year N is published early in year N+1, so the current year's layer
// never exists yet: asking for it first only spent a slow request (up
// to 45 seconds of a 60 second limit) on a certain miss.
export function candidateYears(now: Date = new Date()): number[] {
  const currentYear = now.getFullYear();
  return [currentYear - 1, currentYear - 2, currentYear - 3];
}

// Fetch the CDL clipped to a 4326 bbox. With no year given, tries the
// newest published layer first and falls back two more years before
// giving up.
export async function fetchCdlGrid(
  bbox4326: [number, number, number, number],
  year?: number
): Promise<CdlGrid> {
  const bbox = albersBbox(bbox4326);
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  const candidates = year ? [year] : candidateYears();
  for (const y of candidates) {
    const grid = await fetchYear(bbox, y, deadline);
    if (grid) return grid;
  }
  throw new CdlError(
    year
      ? `The ${year} land cover layer is not available for this area.`
      : "No recent land cover layer is available for this area."
  );
}

// Grid corner coordinates -> lon/lat (grid point (gx, gy) is a pixel
// corner; see raster.ts for the grid convention).
export function gridPointToLonLat(
  grid: CdlGrid,
  gx: number,
  gy: number
): [number, number] {
  return toWgs84([
    grid.originX + gx * grid.pixel,
    grid.originY - gy * grid.pixel,
  ]);
}
