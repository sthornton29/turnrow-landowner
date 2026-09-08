// Server-side ArcGIS REST helpers used by the /api/gis/* proxy routes.
// All county queries run here (never in the browser) to avoid CORS and to
// centralize pagination, format fallback, and error handling.

import { arcgisToGeoJSON } from "@terraformer/arcgis";
import turfArea from "@turf/area";
import { ensureWgs84 } from "@/lib/geo/spatialRef";
import type { CountyParcelFeature, LayerField } from "@/lib/gis";

const TIMEOUT_MS = 15000;

export class GisError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

const DEFAULT_SERVICE_LABEL = "the county's GIS server";

// Any public ArcGIS REST service (county parcels, the BLM PLSS grid).
// serviceLabel names the server in user-facing errors; timeoutMs
// defaults to the county value.
async function fetchJson(
  url: string,
  opts: { timeoutMs?: number; serviceLabel?: string } = {}
): Promise<Record<string, unknown>> {
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  const label = opts.serviceLabel ?? DEFAULT_SERVICE_LABEL;
  const Label = label.charAt(0).toUpperCase() + label.slice(1);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") {
      throw new GisError(
        `${Label} did not respond within ${Math.round(timeoutMs / 1000)} seconds. It may be down or slow; try again in a few minutes.`
      );
    }
    throw new GisError(`Could not reach ${label}.`);
  }
  clearTimeout(timer);
  if (!response.ok) {
    throw new GisError(`${Label} returned an error (HTTP ${response.status}).`);
  }
  let body: Record<string, unknown>;
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    throw new GisError(`${Label} returned an unreadable response.`);
  }
  // ArcGIS reports errors inside a 200 response
  if (body && typeof body === "object" && "error" in body) {
    const err = body.error as { message?: string; code?: number };
    throw new GisError(
      `${Label} rejected the query${err?.message ? `: ${err.message}` : "."}`
    );
  }
  return body;
}

// Fetch a layer's metadata (fields, maxRecordCount, name).
export async function fetchLayerInfo(serviceUrl: string, layerId: number) {
  const body = await fetchJson(`${serviceUrl}/${layerId}?f=json`);
  const fields = ((body.fields as Array<Record<string, unknown>>) ?? []).map(
    (f): LayerField => ({
      name: String(f.name),
      type: String(f.type ?? ""),
      alias: f.alias ? String(f.alias) : null,
    })
  );
  return {
    name: String(body.name ?? ""),
    geometryType: String(body.geometryType ?? ""),
    maxRecordCount: Number(body.maxRecordCount ?? 1000),
    fields,
  };
}

// Fetch a layer's coverage extent in WGS84 by asking the server itself
// (query with returnExtentOnly and outSR=4326), so State Plane and Web
// Mercator layers come back already in lon/lat with no local projection
// math. Returns null when the server answers without a usable extent
// (the caller keeps whatever extent it already had).
export async function fetchLayerExtent(
  serviceUrl: string,
  layerId: number
): Promise<[number, number, number, number] | null> {
  const params = new URLSearchParams({
    where: "1=1",
    returnExtentOnly: "true",
    outSR: "4326",
    f: "json",
  });
  const body = await fetchJson(`${serviceUrl}/${layerId}/query?${params}`);
  const extent = body.extent as Record<string, unknown> | undefined;
  if (!extent) return null;
  const nums = [extent.xmin, extent.ymin, extent.xmax, extent.ymax].map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const [xmin, ymin, xmax, ymax] = nums;
  // Sanity: must be plausible lon/lat and a real area, or a server that
  // ignored outSR would poison the registry with projected coordinates.
  if (
    xmin < -180 || xmax > 180 || ymin < -90 || ymax > 90 ||
    xmin >= xmax || ymin >= ymax
  ) {
    return null;
  }
  return [xmin, ymin, xmax, ymax];
}

export function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

export function buildWhere(
  searchType: "owner" | "parcel",
  text: string,
  ownerField: string,
  parcelField: string
): string {
  const cleaned = escapeSqlLiteral(text.trim().toUpperCase());
  if (searchType === "owner") {
    return `UPPER(${ownerField}) LIKE '%${cleaned}%'`;
  }
  // Parcel numbers: counties format the same number differently (Morgan
  // stores "02 04 18 0 000 007.000" where the tax statement prints
  // 0204180000007000; Madison uses dashes; Lauderdale plain digits), so
  // match format-tolerantly: as typed, with punctuation stripped, and
  // with a wildcard between every character so any separator convention
  // matches. A full parcel number's digits in order cannot meaningfully
  // false-positive inside a parcel field.
  const clauses = [`UPPER(${parcelField}) LIKE '%${cleaned}%'`];
  const compact = cleaned.replace(/[^A-Z0-9]/g, "");
  if (compact.length >= 6) {
    if (compact !== cleaned) {
      clauses.push(`UPPER(${parcelField}) LIKE '%${compact}%'`);
    }
    const interleaved = "%" + compact.split("").join("%") + "%";
    clauses.push(`UPPER(${parcelField}) LIKE '${interleaved}'`);
  }
  return clauses.join(" OR ");
}

// Entity mode searches broad and groups locally: one query on the most
// distinctive token catches every way the county wrote the name. The
// narrowed patterns are the fallback when that token alone overflows
// the cap: distinctive-then-initial covers THORNTON STUART, THORNTON
// STUART R, and THORNTON S R in one pattern (LIKE % is greedy), and the
// reversed order covers counties that print FIRSTNAME LASTNAME.
export function buildEntityWheres(
  distinctive: string,
  others: string[],
  ownerField: string
): { broad: string; narrowed: string[] } {
  const a = escapeSqlLiteral(distinctive);
  const broad = `UPPER(${ownerField}) LIKE '%${a}%'`;
  const narrowed: string[] = [];
  if (others.length > 0) {
    const b = escapeSqlLiteral(others[0]);
    narrowed.push(`UPPER(${ownerField}) LIKE '%${a}%${b[0]}%'`);
    narrowed.push(`UPPER(${ownerField}) LIKE '%${b}%${a}%'`);
  }
  return { broad, narrowed };
}

export interface QueryOptions {
  serviceUrl: string;
  layerId: number;
  where: string;
  maxFeatures: number;
  // Optional spatial filter: a WGS84 point or a [west, south, east, north]
  // bbox, sent as an ArcGIS geometry with inSR 4326.
  geometry?: GeoJSON.Point | [number, number, number, number];
  spatialRel?: "esriSpatialRelIntersects" | "esriSpatialRelContains" | "esriSpatialRelWithin";
  inSR?: number;
  outFields?: string; // default "*"
  timeoutMs?: number; // default 15000
  serviceLabel?: string; // error copy; default "the county's GIS server"
}

function geometryParams(options: QueryOptions): Record<string, string> {
  if (!options.geometry) return {};
  const g = options.geometry;
  const inSR = String(options.inSR ?? 4326);
  if (Array.isArray(g)) {
    return {
      geometry: JSON.stringify({
        xmin: g[0], ymin: g[1], xmax: g[2], ymax: g[3],
        spatialReference: { wkid: Number(inSR) },
      }),
      geometryType: "esriGeometryEnvelope",
      spatialRel: options.spatialRel ?? "esriSpatialRelIntersects",
      inSR,
    };
  }
  return {
    geometry: JSON.stringify({
      x: g.coordinates[0], y: g.coordinates[1],
      spatialReference: { wkid: Number(inSR) },
    }),
    geometryType: "esriGeometryPoint",
    spatialRel: options.spatialRel ?? "esriSpatialRelIntersects",
    inSR,
  };
}

interface RawFeature {
  geometry: GeoJSON.Geometry | null;
  properties: Record<string, unknown>;
}

// Query a layer with pagination, preferring f=geojson and falling back to
// Esri JSON + terraformer conversion for older MapServer layers.
export async function queryLayerFeatures(
  options: QueryOptions
): Promise<{ features: RawFeature[]; truncated: boolean }> {
  const collected: RawFeature[] = [];
  let offset = 0;
  let useGeoJson = true;
  let truncated = false;

  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({
      where: options.where,
      outFields: options.outFields ?? "*",
      outSR: "4326",
      f: useGeoJson ? "geojson" : "json",
      resultOffset: String(offset),
      resultRecordCount: String(Math.min(options.maxFeatures + 1 - collected.length, 500)),
      ...geometryParams(options),
    });
    const url = `${options.serviceUrl}/${options.layerId}/query?${params}`;
    let body: Record<string, unknown>;
    try {
      body = await fetchJson(url, {
        timeoutMs: options.timeoutMs,
        serviceLabel: options.serviceLabel,
      });
    } catch (err) {
      // Some layers reject f=geojson outright; retry the page as Esri JSON.
      if (useGeoJson && page === 0 && collected.length === 0) {
        useGeoJson = false;
        page--;
        continue;
      }
      throw err;
    }

    let pageFeatures: RawFeature[] = [];
    let exceeded = false;

    if (useGeoJson && body.type === "FeatureCollection") {
      const fc = body as unknown as GeoJSON.FeatureCollection;
      pageFeatures = fc.features.map((f) => ({
        geometry: f.geometry ?? null,
        properties: (f.properties ?? {}) as Record<string, unknown>,
      }));
      exceeded = Boolean(
        (body as Record<string, unknown>).exceededTransferLimit ??
          (body.properties as Record<string, unknown> | undefined)?.exceededTransferLimit
      );
    } else if (useGeoJson && body.type !== "FeatureCollection") {
      // Server ignored f=geojson; treat as Esri JSON from here on.
      useGeoJson = false;
      page--;
      continue;
    } else {
      // Esri JSON
      const esriFeatures = (body.features as Array<Record<string, unknown>>) ?? [];
      pageFeatures = esriFeatures.map((f) => {
        let geometry: GeoJSON.Geometry | null = null;
        if (f.geometry) {
          try {
            geometry = arcgisToGeoJSON(f.geometry) as GeoJSON.Geometry;
          } catch {
            geometry = null;
          }
        }
        return {
          geometry,
          properties: (f.attributes ?? {}) as Record<string, unknown>,
        };
      });
      exceeded = Boolean(body.exceededTransferLimit);
    }

    collected.push(...pageFeatures);
    if (collected.length > options.maxFeatures) {
      truncated = true;
      collected.length = options.maxFeatures;
      break;
    }
    if (!exceeded && pageFeatures.length < 500) break;
    offset += pageFeatures.length;
  }

  return { features: collected, truncated };
}

// Normalize raw features to standard keys. Counties publish acres
// attributes inconsistently (Colbert returns 0.0 or null on many
// parcels), so deeded_acres is null unless the attribute is a real
// positive number, and computed_acres carries a geodesic area from the
// boundary as the fallback. Features without geometry are kept (flagged
// in the UI, not importable) rather than silently dropped. A spatial
// reference guard repairs servers that ignore outSR=4326 and return
// Web Mercator, warning with the service label so the registry entry
// can be reviewed.
// The raw attribute set, bounded: geometry bookkeeping dropped, at most
// 60 keys, strings cut to 200 characters.
export function trimAttributes(attrs: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (/^(shape[_.]?(area|len|length|starea|stlength)|st_area|st_length)/i.test(k)) continue;
    if (v === null || v === undefined) continue;
    if (typeof v === "object") continue;
    out[k] = typeof v === "string" ? v.slice(0, 200) : v;
    if (++n >= 60) break;
  }
  return out;
}

export function normalizeFeatures(
  features: RawFeature[],
  mapping: {
    parcel_field: string;
    owner_field: string;
    acres_field: string | null;
    situs_field: string | null;
  },
  serviceLabel = "county service"
): CountyParcelFeature[] {
  let warnedReprojection = false;
  return features.map((f) => {
    let geometry = f.geometry;
    if (geometry) {
      const fixed = ensureWgs84(geometry);
      geometry = fixed.geometry;
      if (fixed.reprojected && !warnedReprojection) {
        warnedReprojection = true;
        console.warn(
          `[gis] ${serviceLabel} returned Web Mercator coordinates despite outSR=4326; reprojected to WGS84. Review this registry entry.`
        );
      }
    }
    let computedAcres: number | null = null;
    if (geometry) {
      try {
        computedAcres =
          Math.round((turfArea(geometry) / 4046.8564224) * 10) / 10;
      } catch {
        computedAcres = null;
      }
    }
    const attrs = f.properties;
    const acresRaw = mapping.acres_field ? attrs[mapping.acres_field] : null;
    const deeded = Number(acresRaw);
    return {
      geometry,
      attributes: trimAttributes(attrs),
      parcel_number: String(attrs[mapping.parcel_field] ?? "").trim(),
      owner_name: String(attrs[mapping.owner_field] ?? "").trim(),
      deeded_acres:
        acresRaw !== null && acresRaw !== undefined && acresRaw !== "" &&
        Number.isFinite(deeded) && deeded > 0
          ? deeded
          : null,
      computed_acres: computedAcres,
      situs: mapping.situs_field
        ? String(attrs[mapping.situs_field] ?? "").trim() || null
        : null,
    };
  });
}

// ---------------------------------------------------------------- identifier lookup (migration 0042)

// ArcGIS field types that take an unquoted numeric literal.
export function isNumericFieldType(type: string | null | undefined): boolean {
  return /Integer|Double|Single|OID/i.test(type ?? "");
}

function compactUpper(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Exact match for a batch of printed values against one mapped
// identifier column. Numeric columns (Colbert publishes PPIN as a
// double) take only digit-only values as bare literals; text columns
// compare the upper-cased printed value and its punctuation-stripped
// form. Null when nothing in the batch can be asked of this column.
export function buildIdentifierWhere(field: string, fieldType: string | null | undefined, values: string[]): string | null {
  const cleaned = values.map((v) => v.trim()).filter(Boolean);
  if (cleaned.length === 0) return null;
  if (isNumericFieldType(fieldType)) {
    const nums = [...new Set(cleaned.map((v) => v.replace(/^0+(?=\d)/, "")).filter((v) => /^\d{1,15}$/.test(v)))];
    return nums.length ? `${field} IN (${nums.join(", ")})` : null;
  }
  const literals = new Set<string>();
  for (const v of cleaned) {
    literals.add(escapeSqlLiteral(v.toUpperCase()));
    const compact = compactUpper(v);
    if (compact) literals.add(escapeSqlLiteral(compact));
    const unpadded = compact.replace(/^0+(?=\d)/, "");
    if (unpadded) literals.add(escapeSqlLiteral(unpadded));
  }
  return `UPPER(${field}) IN (${[...literals].map((l) => `'${l}'`).join(", ")})`;
}

// Looser second try for one value on a text column: the digits in
// order with any separator between them (a "12-345" printing against a
// "12 345" record). Numeric columns have no looser form.
export function buildIdentifierLikeWhere(field: string, fieldType: string | null | undefined, value: string): string | null {
  if (isNumericFieldType(fieldType)) return null;
  const compact = compactUpper(value).replace(/^0+(?=\d)/, "");
  if (compact.length < 3) return null;
  return `UPPER(${field}) LIKE '%${escapeSqlLiteral(compact.split("").join("%"))}%'`;
}

// Layer field types, cached per layer for ten minutes so a review
// screen with many lines asks the county once.
const fieldTypeCache = new Map<string, { at: number; types: Map<string, string> }>();
const FIELD_TYPE_TTL_MS = 10 * 60 * 1000;

export async function layerFieldTypes(serviceUrl: string, layerId: number): Promise<Map<string, string>> {
  const key = `${serviceUrl}/${layerId}`;
  const hit = fieldTypeCache.get(key);
  if (hit && Date.now() - hit.at < FIELD_TYPE_TTL_MS) return hit.types;
  const info = await fetchLayerInfo(serviceUrl, layerId);
  const types = new Map(info.fields.map((f) => [f.name, f.type]));
  fieldTypeCache.set(key, { at: Date.now(), types });
  return types;
}
