// Server-side ArcGIS REST helpers used by the /api/gis/* proxy routes.
// All county queries run here (never in the browser) to avoid CORS and to
// centralize pagination, format fallback, and error handling.

import { arcgisToGeoJSON } from "@terraformer/arcgis";
import type { CountyParcelFeature, LayerField } from "@/lib/gis";

const TIMEOUT_MS = 15000;

export class GisError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") {
      throw new GisError(
        "The county's GIS server did not respond within 15 seconds. It may be down or slow; try again in a few minutes."
      );
    }
    throw new GisError("Could not reach the county's GIS server.");
  }
  clearTimeout(timer);
  if (!response.ok) {
    throw new GisError(
      `The county's GIS server returned an error (HTTP ${response.status}).`
    );
  }
  let body: Record<string, unknown>;
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    throw new GisError("The county's GIS server returned an unreadable response.");
  }
  // ArcGIS reports errors inside a 200 response
  if (body && typeof body === "object" && "error" in body) {
    const err = body.error as { message?: string; code?: number };
    throw new GisError(
      `The county's GIS server rejected the query${err?.message ? `: ${err.message}` : "."}`
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

function escapeSqlLiteral(value: string): string {
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
  // Parcel numbers: exact match or contains, tolerant of case.
  return `UPPER(${parcelField}) LIKE '%${cleaned}%'`;
}

interface QueryOptions {
  serviceUrl: string;
  layerId: number;
  where: string;
  maxFeatures: number;
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
      outFields: "*",
      outSR: "4326",
      f: useGeoJson ? "geojson" : "json",
      resultOffset: String(offset),
      resultRecordCount: String(Math.min(options.maxFeatures + 1 - collected.length, 500)),
    });
    const url = `${options.serviceUrl}/${options.layerId}/query?${params}`;
    let body: Record<string, unknown>;
    try {
      body = await fetchJson(url);
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

export function normalizeFeatures(
  features: RawFeature[],
  mapping: {
    parcel_field: string;
    owner_field: string;
    acres_field: string | null;
    situs_field: string | null;
  }
): CountyParcelFeature[] {
  return features
    .filter((f) => f.geometry)
    .map((f) => {
      const attrs = f.properties;
      const acresRaw = mapping.acres_field ? attrs[mapping.acres_field] : null;
      return {
        geometry: f.geometry!,
        parcel_number: String(attrs[mapping.parcel_field] ?? "").trim(),
        owner_name: String(attrs[mapping.owner_field] ?? "").trim(),
        deeded_acres:
          acresRaw !== null && acresRaw !== undefined && acresRaw !== ""
            ? Number(acresRaw)
            : null,
        situs: mapping.situs_field
          ? String(attrs[mapping.situs_field] ?? "").trim() || null
          : null,
      };
    });
}
