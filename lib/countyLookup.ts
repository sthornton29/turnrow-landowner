// County sanity gate for plotted boundaries: which county does a point
// actually sit in? Answered by the Census TIGERweb county service
// (public, no key), cached in-process per rounded point. Pure helpers
// (normalization, matching) are unit-tested; the network call lives in
// lookupCounty and is only ever invoked server-side.
//
// Live-verified 2026-08-20: TIGERweb State_County MapServer, layer 1
// "Counties" (polygon), fields include NAME ("Lawrence County"),
// BASENAME ("Lawrence"), STATE (2-digit FIPS), GEOID. A point query
// (geometryType esriGeometryPoint, inSR 4326, spatialRel intersects)
// at -87.307, 34.658 returned Lawrence County, STATE 01.

import { queryLayerFeatures } from "@/lib/gisServer";

export const TIGER_COUNTY_SERVICE_URL =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer";
export const TIGER_COUNTY_LAYER = 1;
export const TIGER_SERVICE_LABEL = "the Census county service";

// State FIPS -> postal abbreviation (TIGERweb returns FIPS).
export const STATE_FIPS_TO_ABBR: Record<string, string> = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT",
  "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL",
  "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD",
  "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE",
  "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND",
  "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
  "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV",
  "55": "WI", "56": "WY", "72": "PR",
};

export interface CountyHit {
  county: string; // "Lawrence"
  countyFull: string; // "Lawrence County"
  state: string; // "AL"
  geoid: string | null;
}

// "Lawrence County, Alabama" / "St. Clair" / "DeKalb County" compare on
// letters only, without the county/parish suffix.
export function normalizeCountyName(raw: string | null | undefined): string {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/\b(county|parish|borough|census area|co\.?)\b/g, "")
    .replace(/[^a-z]/g, "");
}

// True when the deed's county and the resolved county are the same
// place. Unknown deed county = no opinion (true), never a false flag.
export function countyMatches(
  deedCounty: string | null | undefined,
  resolvedCounty: string | null | undefined
): boolean {
  const a = normalizeCountyName(deedCounty);
  const b = normalizeCountyName(resolvedCounty);
  if (!a || !b) return true;
  return a === b;
}

const cache = new Map<string, CountyHit | null>();

function keyOf(lon: number, lat: number): string {
  return `${lon.toFixed(4)},${lat.toFixed(4)}`;
}

// Reverse-geocode a WGS84 point to its county. Server-side only.
export async function lookupCounty(lon: number, lat: number): Promise<CountyHit | null> {
  const key = keyOf(lon, lat);
  if (cache.has(key)) return cache.get(key) ?? null;
  const { features } = await queryLayerFeatures({
    serviceUrl: TIGER_COUNTY_SERVICE_URL,
    layerId: TIGER_COUNTY_LAYER,
    where: "1=1",
    maxFeatures: 2,
    geometry: { type: "Point", coordinates: [lon, lat] },
    spatialRel: "esriSpatialRelIntersects",
    inSR: 4326,
    outFields: "NAME,BASENAME,STATE,GEOID",
    timeoutMs: 20000,
    serviceLabel: TIGER_SERVICE_LABEL,
  });
  const f = features[0];
  const props = (f?.properties ?? (f as unknown as { attributes?: Record<string, unknown> })?.attributes ?? {}) as Record<string, unknown>;
  const base = props.BASENAME ?? props.NAME;
  const hit: CountyHit | null = base
    ? {
        county: String(base).replace(/\s+County$/i, ""),
        countyFull: String(props.NAME ?? `${base} County`),
        state: STATE_FIPS_TO_ABBR[String(props.STATE ?? "")] ?? String(props.STATE ?? ""),
        geoid: props.GEOID ? String(props.GEOID) : null,
      }
    : null;
  cache.set(key, hit);
  return hit;
}
