// County GIS registry types and helpers shared by the proxy routes,
// admin UI, and import flow.

export interface CountyGisService {
  id: string;
  state: string;
  county: string;
  display_name: string;
  service_url: string;
  layer_id: number;
  parcel_field: string;
  owner_field: string;
  acres_field: string | null;
  situs_field: string | null;
  status: "active" | "broken" | "untested";
  last_verified_at: string | null;
  notes: string | null;
  // Layer coverage extent in WGS84 lon/lat (migration 0038), captured
  // by the admin verify test query and Re-verify. Null until a service
  // is (re-)verified; the Neighbors overlay skips null-extent services.
  extent_xmin: number | null;
  extent_ymin: number | null;
  extent_xmax: number | null;
  extent_ymax: number | null;
}

// [west, south, east, north] in WGS84 lon/lat.
export type LonLatBbox = [number, number, number, number];

export function serviceExtent(s: CountyGisService): LonLatBbox | null {
  const nums = [s.extent_xmin, s.extent_ymin, s.extent_xmax, s.extent_ymax];
  // Defensive about undefined as well as null: a row read before
  // migration 0038 ran simply has no extent.
  if (nums.some((n) => typeof n !== "number" || !Number.isFinite(n))) return null;
  return nums as LonLatBbox;
}

export function bboxesIntersect(a: LonLatBbox, b: LonLatBbox): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

export interface LayerField {
  name: string;
  type: string;
  alias: string | null;
}

// A search result feature with attributes normalized to standard keys.
export interface CountyParcelFeature {
  // null when the county returned no boundary for this record; such
  // rows are shown flagged and cannot be imported.
  geometry: GeoJSON.Geometry | null;
  parcel_number: string;
  owner_name: string;
  // null unless the county attribute is a real positive number: junk
  // 0.0 values (Colbert publishes many) never survive the proxy.
  deeded_acres: number | null;
  // Geodesic acres computed from the boundary with @turf/area, one
  // decimal; the display fallback when deeded acres are missing.
  computed_acres: number | null;
  situs: string | null;
  // The feature's raw attribute set (capped), kept on the parcel at
  // import so identifiers (PPIN, folio, ...) can be harvested from it.
  attributes: Record<string, unknown>;
}

// Entity-mode search results also carry the canonical owner name (from
// lib/ownerNames.ts, computed server-side so client and server agree)
// and the noise tokens stripped from it (ETUX, ESTATE, JR...).
export interface EntityParcelFeature extends CountyParcelFeature {
  owner_normalized: string;
  owner_stripped: string[];
}

// Strip a trailing "/<layerId>" (and query/trailing slashes) off a pasted
// ArcGIS REST URL, returning the service URL and the layer id if present.
export function parseLayerUrl(raw: string): { serviceUrl: string; layerId: number | null } {
  let url = raw.trim().replace(/\?.*$/, "").replace(/\/+$/, "");
  let layerId: number | null = null;
  const match = url.match(/\/(\d+)$/);
  if (match) {
    layerId = Number(match[1]);
    url = url.slice(0, -match[0].length);
  }
  return { serviceUrl: url, layerId };
}

// Guess likely field mappings from a layer's field list.
export function guessFields(fields: LayerField[]): {
  parcel: string | null;
  owner: string | null;
  acres: string | null;
  situs: string | null;
} {
  const find = (patterns: RegExp[]): string | null => {
    for (const pattern of patterns) {
      const hit = fields.find((f) => pattern.test(f.name.toUpperCase()));
      if (hit) return hit.name;
    }
    return null;
  };
  return {
    parcel: find([
      /^(PARCELID|PARCEL_ID|PARCELNO|PARCEL_NO|PARCELNUM)$/,
      /^(PIN|PPIN|APN)$/,
      /^PARID$/,
      /PARCEL/,
      /^PIN/,
    ]),
    owner: find([/^(OWNER|OWNAME|OWNER1|OWNER_NAME|OWNERNAME|OWNNAME)$/, /^OWN/, /OWNER/]),
    acres: find([
      /^(DEEDED_?ACRES|DEED_?AC|ACRES|GISACRES|CALCACRES|TOTALACRES|ACREAGE)$/,
      /ACRE/,
    ]),
    situs: find([
      /^(SITUS|SITUS_?ADDR(ESS)?|PHYSADDR|PROP_?ADDR(ESS)?|LOCATION)$/,
      /SITUS/,
      /ADDR/,
    ]),
  };
}
