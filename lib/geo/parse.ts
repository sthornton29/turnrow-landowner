import type { Feature, FeatureCollection, Geometry, MultiPolygon } from "geojson";
import { kml as kmlToGeoJSON } from "@tmcw/togeojson";
import JSZip from "jszip";
import shp from "shpjs";
import { toMultiPolygon } from "./normalize";

// A feature parsed from an uploaded file, normalized to MultiPolygon and
// carrying its original attributes so we can prefill names.
export interface ParsedFeature {
  geometry: MultiPolygon;
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
  skipped: string[]
) {
  const features: Feature[] =
    input.type === "FeatureCollection"
      ? input.features
      : input.type === "Feature"
        ? [input]
        : [{ type: "Feature", geometry: input, properties: {} }];

  for (const f of features) {
    const index = out.length + skipped.length;
    const mp = toMultiPolygon(f.geometry);
    if (!mp) {
      const t = f.geometry?.type ?? "empty";
      skipped.push(`Feature ${index + 1}: ${t} geometry is not a boundary, skipped.`);
      continue;
    }
    const attributes = (f.properties ?? {}) as Record<string, unknown>;
    out.push({
      geometry: mp,
      attributes,
      suggestedName: guessName(attributes, `Boundary ${out.length + 1}`),
      sourceIndex: index,
    });
  }
}

async function parseKmlText(text: string, out: ParsedFeature[], skipped: string[]) {
  const dom = new DOMParser().parseFromString(text, "text/xml");
  const gj = kmlToGeoJSON(dom) as FeatureCollection;
  collectFeatures(gj, out, skipped);
}

// Parses one uploaded file (GeoJSON, KML, KMZ, or zipped shapefile) into
// MultiPolygon features. Bad individual features are skipped and reported;
// only a completely unreadable file throws.
export async function parseBoundaryFile(file: File): Promise<ParseResult> {
  const name = file.name.toLowerCase();
  const out: ParsedFeature[] = [];
  const skipped: string[] = [];

  try {
    if (name.endsWith(".geojson") || name.endsWith(".json")) {
      const gj = JSON.parse(await file.text());
      collectFeatures(gj, out, skipped);
    } else if (name.endsWith(".kml")) {
      await parseKmlText(await file.text(), out, skipped);
    } else if (name.endsWith(".kmz")) {
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      const kmlEntry = Object.values(zip.files).find(
        (f) => !f.dir && f.name.toLowerCase().endsWith(".kml")
      );
      if (!kmlEntry) throw new Error("No KML file found inside the KMZ.");
      await parseKmlText(await kmlEntry.async("text"), out, skipped);
    } else if (name.endsWith(".zip")) {
      const result = await shp(await file.arrayBuffer());
      const collections = Array.isArray(result) ? result : [result];
      for (const fc of collections) collectFeatures(fc, out, skipped);
    } else {
      throw new Error(
        "Unsupported file type. Upload GeoJSON, KML, KMZ, or a zipped shapefile."
      );
    }
  } catch (err) {
    throw new Error(
      `Could not read ${file.name}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  return { features: out, skipped };
}
