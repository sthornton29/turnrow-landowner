import type { Geometry, MultiPolygon } from "geojson";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssetType, EntityType } from "@/types/db";
import type { FeatureKind, ParseResult } from "./parse";
import { approxAcres } from "./normalize";
import { suggestPropertyId } from "./propertyMatch";

// The review-then-save model shared by the Import page
// (components/import/ImportClient.tsx) and the map's own import panel
// (components/map/ImportPanel.tsx): parsed features become editable
// rows, rows are validated, and saving inserts each row then sets its
// geometry through the set_geometry RPC. One place, so a file imports
// the same way from either screen.

export interface ImportRow {
  localId: string;
  include: boolean;
  kind: FeatureKind;
  entityType: EntityType;
  assetType: AssetType; // used when entityType === "asset"
  name: string;
  // "existing:<uuid>" | "new:<localId>" | ""
  propertyRef: string;
  // The location-based suggestion, kept so the UI can show when the
  // current assignment came from it (and when the user overrode it).
  suggestedRef: string | null;
  geometry: Geometry;
  acres: number | null;
  sourceFile: string;
}

export const IMPORT_TABLE: Record<string, string> = {
  property: "properties",
  parcel: "parcels",
  field: "fields",
  pasture: "pastures",
  wetland: "wetlands",
  pollinator_habitat: "pollinator_habitats",
  timber_stand: "timber_stands",
  road: "roads",
  asset: "assets",
  cemetery: "cemeteries",
};

export const IMPORT_POLYGON_OPTIONS: Array<[EntityType, string]> = [
  ["property", "Property"],
  ["parcel", "Parcel"],
  ["field", "Ag field"],
  ["pasture", "Pasture/Grassland"],
  ["wetland", "Wetland (open)"],
  ["pollinator_habitat", "Pollinator habitat"],
  ["timber_stand", "Timber stand"],
  ["cemetery", "Cemetery"],
];

export const IMPORT_ACCEPT = ".geojson,.json,.kml,.kmz,.zip";

export interface MatchableProperty {
  id: string;
  boundary: MultiPolygon | null;
}

// Rows for one parsed file. Polygons default to the given type (the
// first property when nothing exists yet, otherwise an ag field), lines
// to roads, points to "other" assets; each non-property row is
// preassigned to the property that contains it.
export function buildImportRows(
  fileName: string,
  parsed: ParseResult,
  opts: {
    defaultPolygonType: EntityType;
    matchableProperties: MatchableProperty[];
    random?: () => string;
  }
): ImportRow[] {
  const random = opts.random ?? (() => Math.random().toString(36).slice(2, 8));
  return parsed.features.map((f) => {
    const entityType: EntityType =
      f.kind === "polygon"
        ? opts.defaultPolygonType
        : f.kind === "line"
          ? "road"
          : "asset";
    const suggestedId = suggestPropertyId(f.geometry, opts.matchableProperties);
    const suggestedRef = suggestedId ? `existing:${suggestedId}` : null;
    return {
      localId: `${fileName}-${f.sourceIndex}-${random()}`,
      include: true,
      kind: f.kind,
      entityType,
      assetType: f.kind === "line" ? "underground_pipe" : "other",
      name: f.suggestedName,
      propertyRef: entityType === "property" ? "" : (suggestedRef ?? ""),
      suggestedRef,
      geometry: f.geometry,
      acres: f.kind === "polygon" ? approxAcres(f.geometry as MultiPolygon) : null,
      sourceFile: fileName,
    };
  });
}

export function defaultPolygonTypeFor(propertyCount: number): EntityType {
  return propertyCount > 0 ? "field" : "property";
}

// Null when every included row can save; otherwise the first problem.
export function importValidationError(rows: ImportRow[]): string | null {
  for (const r of rows) {
    if (!r.include) continue;
    if (!r.name.trim()) return "Every included feature needs a name.";
    if (r.entityType !== "property" && r.entityType !== "asset" && !r.propertyRef) {
      return "Parcels, ag fields, pastures, wetlands, pollinator habitats, timber stands, and roads must be assigned to a property.";
    }
  }
  return null;
}

export interface ImportSaveResult {
  saved: number;
  failures: string[];
  // Rows that made it in; the caller drops them so a retry never
  // saves the same shape twice.
  savedLocalIds: string[];
}

export async function saveImportRows(
  supabase: SupabaseClient,
  orgId: string,
  rows: ImportRow[]
): Promise<ImportSaveResult> {
  const included = rows.filter((r) => r.include);
  const failures: string[] = [];
  const savedLocalIds: string[] = [];
  const newPropertyIds = new Map<string, string>();

  async function setGeometry(entityType: EntityType, id: string, g: Geometry) {
    const { error } = await supabase.rpc("set_geometry", {
      p_entity_type: entityType,
      p_entity_id: id,
      p_geojson: g,
    });
    return error;
  }

  function resolveProperty(r: ImportRow): string | null {
    if (r.propertyRef.startsWith("existing:")) {
      return r.propertyRef.slice("existing:".length);
    }
    if (r.propertyRef.startsWith("new:")) {
      return newPropertyIds.get(r.propertyRef.slice("new:".length)) ?? null;
    }
    return null;
  }

  // Pass 1: properties, so other rows in the batch can reference them.
  for (const r of included.filter((x) => x.entityType === "property")) {
    const { data, error } = await supabase
      .from("properties")
      .insert({ organization_id: orgId, name: r.name.trim() })
      .select("id")
      .single();
    if (error || !data) {
      failures.push(`${r.name}: ${error?.message ?? "insert failed"}`);
      continue;
    }
    const gErr = await setGeometry("property", data.id, r.geometry);
    if (gErr) {
      failures.push(`${r.name}: geometry failed (${gErr.message})`);
      continue;
    }
    newPropertyIds.set(r.localId, data.id);
    savedLocalIds.push(r.localId);
  }

  // Pass 2: everything else.
  for (const r of included.filter((x) => x.entityType !== "property")) {
    const propertyId = resolveProperty(r);
    if (!propertyId && r.entityType !== "asset") {
      failures.push(`${r.name}: its property was not saved, skipped.`);
      continue;
    }
    let insert: Record<string, unknown>;
    if (r.entityType === "parcel") {
      insert = { organization_id: orgId, property_id: propertyId, parcel_number: r.name.trim() };
    } else if (r.entityType === "asset") {
      insert = {
        organization_id: orgId,
        property_id: propertyId,
        name: r.name.trim(),
        asset_type: r.assetType,
      };
    } else {
      insert = { organization_id: orgId, property_id: propertyId, name: r.name.trim() };
    }
    const { data, error } = await supabase
      .from(IMPORT_TABLE[r.entityType])
      .insert(insert)
      .select("id")
      .single();
    if (error || !data) {
      failures.push(`${r.name}: ${error?.message ?? "insert failed"}`);
      continue;
    }
    const gErr = await setGeometry(r.entityType, data.id, r.geometry);
    if (gErr) {
      failures.push(`${r.name}: geometry failed (${gErr.message})`);
      continue;
    }
    savedLocalIds.push(r.localId);
  }

  return { saved: savedLocalIds.length, failures, savedLocalIds };
}
