import type { Geometry } from "geojson";
import { ASSET_TYPES, STAND_TYPE_COLORS, STAND_TYPE_LABELS } from "@/lib/assetTypes";
import { EASEMENT_TYPE_LABELS, easementCategory, EASEMENT_CATEGORY_COLORS } from "@/lib/easements";
import { LAND_TYPE_LABELS } from "@/lib/landLabels";
import { ISSUE_TYPE_LABELS, issueTitle } from "@/lib/maintenance";
import { formatAcres } from "@/lib/format";
import type {
  AssetGeo,
  EasementGeo,
  EntityType,
  MaintenanceIssueGeo,
  ParcelGeo,
  RoadGeo,
  TimberStandGeo,
} from "@/types/db";
import type { ExportFeature } from "@/lib/geo/kml";
import { draftColorFor } from "./drawColors";
import type { AnyGeoRow } from "./types";

// Turns a map row into a describable, exportable feature: the name the
// map shows, the folder it files under, the color it is drawn in, and
// the attributes worth carrying along (acres, property, parcel number,
// stand type). Shared by the per-feature KML button in FeaturePanel and
// the whole-map export in MapView.

// Folder order in the file mirrors the map's own layer order.
export const EXPORT_TYPE_ORDER: EntityType[] = [
  "property",
  "parcel",
  "field",
  "pasture",
  "wetland",
  "pollinator_habitat",
  "timber_stand",
  "cemetery",
  "road",
  "easement",
  "asset",
  "maintenance_issue",
];

function geometryOf(row: AnyGeoRow): Geometry | null {
  const b = "boundary_geojson" in row ? row.boundary_geojson : null;
  const g = "geom_geojson" in row ? row.geom_geojson : null;
  return b ?? g ?? null;
}

function displayName(row: AnyGeoRow, type: EntityType): string {
  if (type === "parcel") return (row as ParcelGeo).parcel_number;
  if (type === "maintenance_issue") return issueTitle(row as MaintenanceIssueGeo);
  return (row as { name?: string }).name ?? "";
}

function kindLabel(row: AnyGeoRow, type: EntityType): string {
  if (type === "asset") {
    return ASSET_TYPES[(row as AssetGeo).asset_type]?.label ?? "Asset";
  }
  if (type === "timber_stand") {
    const st = (row as TimberStandGeo).stand_type;
    return st ? `${STAND_TYPE_LABELS[st] ?? st} timber` : "Timber stand";
  }
  if (type === "easement") {
    return `${EASEMENT_TYPE_LABELS[(row as EasementGeo).easement_type] ?? "Easement"} easement`;
  }
  if (type === "maintenance_issue") {
    return ISSUE_TYPE_LABELS[(row as MaintenanceIssueGeo).issue_type] ?? "Maintenance issue";
  }
  return LAND_TYPE_LABELS[type]?.singular ?? type;
}

function colorOf(row: AnyGeoRow, type: EntityType): { color: string; styleKey: string } {
  if (type === "timber_stand") {
    const st = (row as TimberStandGeo).stand_type ?? "other";
    return { color: STAND_TYPE_COLORS[st] ?? STAND_TYPE_COLORS.other, styleKey: `timber_stand-${st}` };
  }
  if (type === "easement") {
    const cat = easementCategory((row as EasementGeo).easement_type);
    return { color: EASEMENT_CATEGORY_COLORS[cat], styleKey: `easement-${cat}` };
  }
  return { color: draftColorFor(type), styleKey: type };
}

export function rowToExportFeature(
  row: AnyGeoRow,
  type: EntityType,
  propertyName: string | null
): ExportFeature | null {
  const geometry = geometryOf(row);
  if (!geometry) return null;

  const name = displayName(row, type).trim() || kindLabel(row, type);
  const acres = (row as { acres?: number | null }).acres ?? null;
  const miles = (row as { miles?: number | null }).miles ?? null;
  const parts = [kindLabel(row, type)];
  if (acres != null && acres > 0) parts.push(`${formatAcres(acres)} ac`);
  if (miles != null && miles > 0) parts.push(`${miles.toFixed(2)} mi`);
  if (propertyName && type !== "property") parts.push(propertyName);

  const data: ExportFeature["data"] = {
    turnrow_type: type,
    turnrow_id: row.id,
    kind: kindLabel(row, type),
    property: type === "property" ? null : propertyName,
    acres: acres != null && acres > 0 ? Number(acres.toFixed(2)) : null,
    miles: miles != null && miles > 0 ? Number(miles.toFixed(3)) : null,
  };
  if (type === "parcel") {
    const p = row as ParcelGeo;
    data.parcel_number = p.parcel_number;
    data.deeded_acres = p.deeded_acres;
    data.county = p.county;
  } else if (type === "property") {
    const p = row as { county?: string | null; state?: string | null };
    data.county = p.county ?? null;
    data.state = p.state ?? null;
  } else if (type === "timber_stand") {
    const t = row as TimberStandGeo;
    data.stand_type = t.stand_type;
    data.species = t.species;
    data.year_established = t.year_established;
  } else if (type === "road") {
    data.road_type = (row as RoadGeo).road_type;
  } else if (type === "easement") {
    const e = row as EasementGeo;
    data.easement_type = e.easement_type;
    data.holder = e.holder;
    data.recorded_ref = e.recorded_ref;
  } else if (type === "asset") {
    data.asset_type = (row as AssetGeo).asset_type;
  } else if (type === "maintenance_issue") {
    const i = row as MaintenanceIssueGeo;
    data.issue_type = i.issue_type;
    data.status = i.status;
    data.severity = i.severity;
  }
  const notes = (row as { notes?: string | null }).notes;
  if (notes) data.notes = notes;

  const { color, styleKey } = colorOf(row, type);
  return {
    id: row.id,
    name,
    folder: LAND_TYPE_LABELS[type]?.plural ?? type,
    styleKey,
    color,
    description: parts.join(" · "),
    data,
    geometry,
  };
}

// Every exportable feature from the map's row lists, in layer order,
// skipping excluded keys ("entityType:id") and rows without a shape.
export function rowsToExportFeatures(
  rowLists: Record<EntityType, AnyGeoRow[]>,
  propertyNames: Map<string, string>,
  excluded: Set<string>
): ExportFeature[] {
  const out: ExportFeature[] = [];
  for (const type of EXPORT_TYPE_ORDER) {
    for (const row of rowLists[type] ?? []) {
      if (excluded.has(`${type}:${row.id}`)) continue;
      const pid = (row as { property_id?: string | null }).property_id ?? null;
      const f = rowToExportFeature(row, type, pid ? (propertyNames.get(pid) ?? null) : null);
      if (f) out.push(f);
    }
  }
  return out;
}
