import type { Feature, FeatureCollection, Geometry } from "geojson";
import { kml as kmlToGeoJSON } from "@tmcw/togeojson";
import JSZip from "jszip";
import shp from "shpjs";
import { plural } from "@/lib/format";
import {
  isLngLatGeometry,
  stripToXY,
  toMultiLineString,
  toMultiPolygon,
} from "./normalize";

export type FeatureKind = "polygon" | "line" | "point";

// Shown when a file's coordinates are not longitude/latitude: a zipped
// shapefile with no .prj, or a GeoJSON exported in state plane feet or
// Web Mercator meters. Those numbers run into the millions and would
// land nowhere on the map.
export const NOT_LAT_LON_MESSAGE =
  "This file is not in latitude and longitude. Re-export it as WGS 84 (EPSG:4326) and try again.";

// How many features of one file were turned away for that reason.
interface Tally {
  notLatLon: number;
}

// A feature parsed from an uploaded file, normalized (polygons to
// MultiPolygon, lines to MultiLineString, points kept as-is) and carrying
// its original attributes so we can prefill names.
export interface ParsedFeature {
  kind: FeatureKind;
  geometry: Geometry;
  attributes: Record<string, unknown>;
  suggestedName: string;
  sourceIndex: number;
}

export interface ParseResult {
  features: ParsedFeature[];
  skipped: string[]; // human-readable notes about anything we could not use
}

// Attribute keys commonly used for names in GIS exports, checked in order.
const NAME_KEYS = [
  "name",
  "field_name",
  "fieldname",
  "label",
  "title",
  "farm_name",
  "tract",
  "tract_name",
  "parcelid",
  "parcel_id",
  "parcel_num",
  "parcelnumber",
  "pin",
  "apn",
  "id",
];

function guessName(attributes: Record<string, unknown>, fallback: string): string {
  const lower = new Map(
    Object.entries(attributes).map(([k, v]) => [k.toLowerCase(), v])
  );
  for (const key of NAME_KEYS) {
    const v = lower.get(key);
    if (v !== null && v !== undefined && String(v).trim() !== "") {
      return String(v).trim();
    }
  }
  return fallback;
}

function collectFeatures(
  input: FeatureCollection | Feature | Geometry,
  out: ParsedFeature[],
  skipped: string[],
  tally: Tally
) {
  const features: Feature[] =
    input.type === "FeatureCollection"
      ? input.features
      : input.type === "Feature"
        ? [input]
        : [{ type: "Feature", geometry: input, properties: {} }];

  for (const f of features) {
    const index = out.length + skipped.length + tally.notLatLon;
    let kind: FeatureKind | null = null;
    let geometry: Geometry | null = null;

    const mp = toMultiPolygon(f.geometry);
    if (mp) {
      kind = "polygon";
      geometry = mp;
    } else {
      const ml = toMultiLineString(f.geometry);
      if (ml) {
        kind = "line";
        geometry = ml;
      } else if (
        f.geometry?.type === "Point" ||
        f.geometry?.type === "MultiPoint"
      ) {
        kind = "point";
        geometry = f.geometry;
      }
    }

    if (!kind || !geometry) {
      const t = f.geometry?.type ?? "empty";
      skipped.push(`Feature ${index + 1}: ${t} geometry is not usable, skipped.`);
      continue;
    }
    // Altitudes come off first (KML always carries one); then anything
    // that is not longitude/latitude is turned away here, before it can
    // reach the map or the database.
    geometry = stripToXY(geometry);
    if (!isLngLatGeometry(geometry)) {
      tally.notLatLon += 1;
      continue;
    }
    const attributes = (f.properties ?? {}) as Record<string, unknown>;
    out.push({
      kind,
      geometry,
      attributes,
      suggestedName: guessName(attributes, `Feature ${out.length + 1}`),
      sourceIndex: index,
    });
  }
}

// A file with nothing usable because of its coordinates is an error
// with the reason; a file where only some shapes are off keeps the good
// ones and says how many were left out.
function applyLatLonRule(out: ParsedFeature[], skipped: string[], tally: Tally) {
  if (tally.notLatLon === 0) return;
  if (out.length === 0) throw new Error(NOT_LAT_LON_MESSAGE);
  skipped.push(
    `${plural(tally.notLatLon, "shape")} skipped: not in latitude and longitude. Re-export the file as WGS 84 (EPSG:4326) to bring ${tally.notLatLon === 1 ? "it" : "them"} in.`
  );
}

// The parse from GeoJSON onward: what a .geojson file holds, and what
// the KML and shapefile readers hand over. Throws NOT_LAT_LON_MESSAGE
// when every shape is in some other coordinate system.
export function parseGeoJson(input: FeatureCollection | Feature | Geometry): ParseResult {
  const out: ParsedFeature[] = [];
  const skipped: string[] = [];
  const tally: Tally = { notLatLon: 0 };
  collectFeatures(input, out, skipped, tally);
  applyLatLonRule(out, skipped, tally);
  return { features: out, skipped };
}

async function parseKmlText(text: string, out: ParsedFeature[], skipped: string[], tally: Tally) {
  const dom = new DOMParser().parseFromString(text, "text/xml");
  const gj = kmlToGeoJSON(dom) as FeatureCollection;
  collectFeatures(gj, out, skipped, tally);
}

// Parses one uploaded file (GeoJSON, KML, KMZ, or zipped shapefile) into
// MultiPolygon features. Bad individual features are skipped and reported;
// only a completely unreadable file throws.
export async function parseBoundaryFile(file: File): Promise<ParseResult> {
  const name = file.name.toLowerCase();
  const out: ParsedFeature[] = [];
  const skipped: string[] = [];
  const tally: Tally = { notLatLon: 0 };

  try {
    if (name.endsWith(".geojson") || name.endsWith(".json")) {
      const gj = JSON.parse(await file.text());
      collectFeatures(gj, out, skipped, tally);
    } else if (name.endsWith(".kml")) {
      await parseKmlText(await file.text(), out, skipped, tally);
    } else if (name.endsWith(".kmz")) {
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      const kmlEntry = Object.values(zip.files).find(
        (f) => !f.dir && f.name.toLowerCase().endsWith(".kml")
      );
      if (!kmlEntry) throw new Error("No KML file found inside the KMZ.");
      await parseKmlText(await kmlEntry.async("text"), out, skipped, tally);
    } else if (name.endsWith(".zip")) {
      const result = await shp(await file.arrayBuffer());
      const collections = Array.isArray(result) ? result : [result];
      for (const fc of collections) collectFeatures(fc, out, skipped, tally);
    } else {
      throw new Error(
        "Unsupported file type. Upload GeoJSON, KML, KMZ, or a zipped shapefile."
      );
    }
    applyLatLonRule(out, skipped, tally);
  } catch (err) {
    throw new Error(
      `Could not read ${file.name}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  return { features: out, skipped };
}
