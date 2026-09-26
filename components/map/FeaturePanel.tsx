"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { uploadDocument } from "@/components/documents/classify";
import { formatAcres, formatDollars, formatNumber } from "@/lib/format";
import {
  ASSET_TYPES,
  CONDITION_LABELS,
  ROAD_TYPE_LABELS,
  STAND_TYPE_LABELS,
} from "@/lib/assetTypes";
import {
  EASEMENT_RELATIONSHIP_LABELS,
  EASEMENT_TYPE_LABELS,
  easementShowsEmergencyPhoneProminently,
} from "@/lib/easements";
import { circleFromDetails, formatFootprint } from "@/lib/geo/circle";
import { EXPORT_MIME, buildKml, downloadTextFile, fileSlug } from "@/lib/geo/kml";
import { LAND_TYPE_LABELS } from "@/lib/landLabels";
import {
  GEOMETRY_KIND_LABELS,
  ISSUE_TYPE_LABELS,
  SEVERITY_LABELS,
  STATUS_LABELS,
  issueGeometryKind,
  issueTitle,
  severityClass,
  statusClass,
  toggleStatus,
  type IssueSeverity,
} from "@/lib/maintenance";
import turfArea from "@turf/area";
import type { AssetGeo, EasementGeo, EntityType, MaintenanceIssueGeo, ParcelGeo, RoadGeo } from "@/types/db";
import type { AnyGeoRow } from "./types";
import { rowToExportFeature } from "./exportFeatures";

export const ENTITY_TABLE: Record<EntityType, string> = {
  property: "properties",
  parcel: "parcels",
  field: "fields",
  pasture: "pastures",
  wetland: "wetlands",
  pollinator_habitat: "pollinator_habitats",
  timber_stand: "timber_stands",
  road: "roads",
  easement: "easements",
  asset: "assets",
  cemetery: "cemeteries",
  maintenance_issue: "maintenance_issues",
};

const TYPE_LABEL: Record<EntityType, string> = {
  property: LAND_TYPE_LABELS.property.singular,
  parcel: LAND_TYPE_LABELS.parcel.singular,
  field: LAND_TYPE_LABELS.field.singular,
  pasture: LAND_TYPE_LABELS.pasture.singular,
  wetland: LAND_TYPE_LABELS.wetland.singular,
  pollinator_habitat: LAND_TYPE_LABELS.pollinator_habitat.singular,
  timber_stand: LAND_TYPE_LABELS.timber_stand.singular,
  road: LAND_TYPE_LABELS.road.singular,
  easement: LAND_TYPE_LABELS.easement.singular,
  asset: LAND_TYPE_LABELS.asset.singular,
  cemetery: LAND_TYPE_LABELS.cemetery.singular,
  maintenance_issue: LAND_TYPE_LABELS.maintenance_issue.singular,
};

export interface EditField {
  key: string;
  label: string;
  input: "text" | "number" | "select" | "textarea" | "date";
  options?: Record<string, string>;
  required?: boolean;
  // Comma-separated text input saved as a Postgres text[] (FSA numbers).
  list?: boolean;
}

export const EDIT_FIELDS: Record<EntityType, EditField[]> = {
  property: [
    { key: "name", label: "Name", input: "text", required: true },
    { key: "county", label: "County", input: "text" },
    { key: "state", label: "State", input: "text" },
    { key: "fsa_numbers", label: "FSA numbers (comma separated)", input: "text", list: true },
    { key: "notes", label: "Notes", input: "textarea" },
  ],
  parcel: [
    { key: "parcel_number", label: "Parcel number", input: "text", required: true },
    { key: "county", label: "County", input: "text" },
    { key: "notes", label: "Notes", input: "textarea" },
  ],
  field: [
    { key: "name", label: "Name", input: "text", required: true },
    { key: "notes", label: "Notes", input: "textarea" },
  ],
  pasture: [
    { key: "name", label: "Name", input: "text", required: true },
    { key: "notes", label: "Notes", input: "textarea" },
  ],
  wetland: [
    { key: "name", label: "Name", input: "text", required: true },
    { key: "notes", label: "Notes", input: "textarea" },
  ],
  pollinator_habitat: [
    { key: "name", label: "Name", input: "text", required: true },
    { key: "program", label: "Program (CRP CP-42, EQIP, monarch waystation)", input: "text" },
    { key: "year_established", label: "Year established", input: "number" },
    { key: "seed_mix", label: "Seed mix", input: "text" },
    { key: "notes", label: "Notes", input: "textarea" },
  ],
  timber_stand: [
    { key: "name", label: "Stand name or number", input: "text", required: true },
    { key: "stand_type", label: "Stand type", input: "select", options: STAND_TYPE_LABELS },
    { key: "species", label: "Primary species", input: "text" },
    { key: "year_established", label: "Year established", input: "number" },
    { key: "site_index", label: "Site index", input: "number" },
    { key: "last_thinning_year", label: "Last thinning year", input: "number" },
    { key: "last_burn_year", label: "Last prescribed burn", input: "number" },
    { key: "notes", label: "Notes", input: "textarea" },
  ],
  road: [
    { key: "name", label: "Name", input: "text", required: true },
    { key: "road_type", label: "Road type", input: "select", options: ROAD_TYPE_LABELS },
    { key: "notes", label: "Notes", input: "textarea" },
  ],
  easement: [
    { key: "name", label: "Name", input: "text", required: true },
    {
      key: "easement_type",
      label: "Easement type",
      input: "select",
      options: EASEMENT_TYPE_LABELS,
      required: true,
    },
    {
      key: "relationship",
      label: "Relationship",
      input: "select",
      options: EASEMENT_RELATIONSHIP_LABELS,
      required: true,
    },
    { key: "holder", label: "Holder (utility, company, neighbor)", input: "text" },
    { key: "recorded_ref", label: "Recorded ref (book/page)", input: "text" },
    { key: "expiration_date", label: "Expires (blank = permanent)", input: "date" },
    { key: "width_ft", label: "Width (ft, informational)", input: "number" },
    { key: "elevation_ft", label: "Flowage elevation (ft)", input: "number" },
    { key: "program", label: "Program / holder detail (conservation)", input: "text" },
    { key: "restrictions", label: "Restrictions (conservation)", input: "textarea" },
    { key: "emergency_phone", label: "Emergency contact number", input: "text" },
    { key: "notes", label: "Notes", input: "textarea" },
  ],
  asset: [
    { key: "name", label: "Name", input: "text", required: true },
    { key: "notes", label: "Notes", input: "textarea" },
  ],
  cemetery: [
    { key: "name", label: "Name", input: "text", required: true },
    { key: "notes", label: "Notes", input: "textarea" },
  ],
  maintenance_issue: [
    { key: "issue_type", label: "Issue type", input: "select", options: ISSUE_TYPE_LABELS, required: true },
    { key: "label", label: "Label", input: "text" },
    { key: "severity", label: "Severity", input: "select", options: { "": "None", ...SEVERITY_LABELS } },
    { key: "notes", label: "Notes", input: "textarea" },
  ],
};

// Shared by FeaturePanel and RowEditor: form string -> column value.
export function fieldPatchValue(
  f: EditField,
  raw: string
): string | number | string[] | null {
  if (f.list) {
    const items = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return items.length > 0 ? items : null;
  }
  if (f.input === "number") return raw === "" ? null : Number(raw);
  return raw === "" && !f.required ? null : raw;
}

// Column value -> editable form string (arrays join comma-separated).
export function fieldDisplayValue(f: EditField, value: unknown): string {
  if (f.list && Array.isArray(value)) return value.join(", ");
  return String(value ?? "");
}

// Route of the full summary page for each thing on the map.
export function detailPagePath(entityType: EntityType, id: string): string {
  const base: Record<EntityType, string> = {
    property: "/properties",
    parcel: "/parcels",
    field: "/fields",
    pasture: "/pastures",
    wetland: "/wetlands",
    pollinator_habitat: "/pollinator-habitats",
    timber_stand: "/timber",
    road: "/roads",
    easement: "/easements",
    asset: "/assets",
    cemetery: "/cemeteries",
    maintenance_issue: "/maintenance",
  };
  // Issues have a list page, not a page per issue.
  if (entityType === "maintenance_issue") return base[entityType];
  return `${base[entityType]}/${id}`;
}

function detailRows(entityType: EntityType, row: AnyGeoRow): Array<[string, string]> {
  const r = row as unknown as Record<string, unknown>;
  const rows: Array<[string, string]> = [];
  const push = (label: string, v: unknown, map?: Record<string, string>) => {
    if (v === null || v === undefined || v === "") return;
    rows.push([label, map ? (map[String(v)] ?? String(v)) : String(v)]);
  };

  if (entityType === "field") {
    // GIS-derived irrigation split (pivot/lateral coverage intersect).
    const irrigated = r.irrigated_acres as number | null;
    const acres = r.acres as number | null;
    if (irrigated != null && acres != null && irrigated > 0.05) {
      rows.push([
        "Irrigation",
        `${formatAcres(irrigated)} irrigated / ${formatAcres(Math.max(acres - irrigated, 0))} dryland`,
      ]);
    }
  }
  if (entityType === "pollinator_habitat") {
    push("Program", r.program);
    push("Established", r.year_established);
    push("Seed mix", r.seed_mix);
  } else if (entityType === "timber_stand") {
    push("Stand type", r.stand_type, STAND_TYPE_LABELS);
    push("Species", r.species);
    push("Established", r.year_established);
    push("Site index", r.site_index);
    push("Last thinned", r.last_thinning_year);
    push("Last burn", r.last_burn_year);
  } else if (entityType === "road") {
    push("Road type", r.road_type, ROAD_TYPE_LABELS);
  } else if (entityType === "easement") {
    const e = row as EasementGeo;
    push("Easement type", e.easement_type, EASEMENT_TYPE_LABELS);
    push("Relationship", e.relationship, EASEMENT_RELATIONSHIP_LABELS);
    if (e.geom_geojson && e.width_ft != null) {
      rows.push(["Width", `${formatNumber(e.width_ft)} ft (informational)`]);
    }
    if (e.expiration_date) rows.push(["Expires", e.expiration_date]);
    if (e.elevation_ft != null) rows.push(["Flowage elevation", `${formatNumber(e.elevation_ft)} ft`]);
    push("Program", e.program);
    push("Restrictions", e.restrictions);
    push("Holder", r.holder);
    push("Recorded ref", r.recorded_ref);
  } else if (entityType === "maintenance_issue") {
    const i = row as MaintenanceIssueGeo;
    push("Type", i.issue_type, ISSUE_TYPE_LABELS);
    const kind = issueGeometryKind(i.geom_geojson);
    if (kind) rows.push(["Marked as", GEOMETRY_KIND_LABELS[kind]]);
    if (i.acres !== null && i.acres !== undefined) rows.push(["Area", `${formatAcres(i.acres)} acres`]);
    rows.push(["Noted", new Date(i.created_at).toLocaleDateString()]);
    if (i.resolved_at) rows.push(["Resolved", new Date(i.resolved_at).toLocaleDateString()]);
  } else if (entityType === "asset") {
    const a = row as AssetGeo;
    push("Type", ASSET_TYPES[a.asset_type]?.label ?? a.asset_type);
    // Footprint size for outline-drawn and circle assets (pivots show
    // their coverage acres below instead).
    const g = a.geom_geojson;
    if (
      a.asset_type !== "irrigation_pivot" &&
      g &&
      (g.type === "Polygon" || g.type === "MultiPolygon")
    ) {
      const sqFt = turfArea({ type: "Feature", properties: {}, geometry: g }) * 10.7639;
      const circle = circleFromDetails(a.details as Record<string, unknown>);
      rows.push([
        circle ? "Circle footprint" : "Footprint",
        formatFootprint(sqFt, formatAcres, formatNumber) +
          (circle ? ` (${formatNumber(circle.diameterFt)} ft diameter)` : ""),
      ]);
    }
    push("Year", a.year_installed);
    push("Condition", a.condition, CONDITION_LABELS);
    if (a.estimated_value !== null) {
      rows.push(["Est. value", formatDollars(a.estimated_value)]);
    }
    // Coverage summary for pivots and laterals (the raw parameters are
    // map-managed and skipped below).
    if (a.asset_type === "irrigation_pivot" && a.details?.center_lon != null) {
      const full = a.details.full_circle !== false;
      const start = Number(a.details.start_bearing_deg);
      const end = Number(a.details.end_bearing_deg);
      const sweep =
        !full && Number.isFinite(start) && Number.isFinite(end)
          ? Math.round((((end - start) % 360) + 360) % 360) || 360
          : null;
      const adds = Array.isArray(a.details.add_polygons)
        ? a.details.add_polygons.length
        : 0;
      rows.push([
        "Coverage",
        (full ? "Full circle" : `${sweep}° sweep`) +
          (adds > 0 ? ` + ${adds} added area${adds === 1 ? "" : "s"}` : ""),
      ]);
    }
    // Plantable vs gross watered acres, when cutouts make them differ.
    {
      const plantable = Number(a.details?.acres_covered);
      const watered = Number(a.details?.acres_watered);
      if (
        Number.isFinite(plantable) &&
        Number.isFinite(watered) &&
        Math.abs(watered - plantable) >= 0.05
      ) {
        rows.push([
          "Irrigated acres",
          `${formatAcres(plantable)} plantable of ${formatAcres(watered)} watered`,
        ]);
      }
    }
    // Type-specific details, labeled from the config. capacity_bu is
    // the grain bin HEADLINE (the metric slot), not a detail row.
    for (const f of ASSET_TYPES[a.asset_type]?.fields ?? []) {
      if (f.mapManaged) continue;
      if (a.asset_type === "grain_bin" && f.key === "capacity_bu") continue;
      const v = a.details?.[f.key];
      if (v === null || v === undefined || v === "") continue;
      let text: string;
      if (typeof v === "boolean") text = v ? "Yes" : "No";
      else if (f.dollars) text = formatDollars(Number(v));
      else if (typeof v === "number") text = formatNumber(v) + (f.unit ? ` ${f.unit}` : "");
      else {
        const opt = f.options?.find((o) => o.value === v);
        text = opt?.label ?? String(v);
      }
      rows.push([f.label, text]);
    }
    if (!a.is_active) rows.push(["Status", "Inactive / removed"]);
  } else {
    push("County", "county" in r ? r.county : null);
    if (entityType === "property") {
      const fsa = r.fsa_numbers as string[] | null | undefined;
      if (fsa && fsa.length > 0) rows.push(["FSA numbers", fsa.join(", ")]);
    }
    if (entityType === "parcel") {
      const deeded = r.deeded_acres as number | null | undefined;
      if (deeded !== null && deeded !== undefined) {
        rows.push(["Deeded acres", formatAcres(deeded)]);
      }
      push("Source", r.source);
    }
  }
  return rows;
}

// Current-year farm activity for the panel (from the tenant's farm software)
export interface FarmActivityInfo {
  crop: string;
  color: string;
  varieties: string[];
  planting_date: string | null;
  // Harvest state from the farm software's own classification: a yield
  // is ACTUAL only on complete; in_progress shows "Harvesting" and the
  // projected yield (yieldText carries the "projected" label then).
  state: "complete" | "in_progress" | "growing";
  yieldText: string | null;
  yieldShared: boolean;
  source: string;
  // The tenant's operating entity for the field, when shared.
  entity?: string | null;
}

// Detail panel for a clicked map feature. Desktop: card on the right side of
// the map. Mobile: bottom sheet.
export default function FeaturePanel({
  entityType,
  row,
  propertyName,
  propertyId = null,
  entityName = null,
  farmActivity = null,
  assetChildren = null,
  parentAssetName = null,
  onClose,
  onEditGeometry,
  onSplit,
  onPivotCircle,
  onCircleFootprint,
  onSelectAsset,
  onSelectProperty,
  onAddBin,
  onChanged,
}: {
  entityType: EntityType;
  row: AnyGeoRow;
  propertyName: string | null;
  // The property a land unit sits on: tapping its name in the panel
  // opens the property's own panel, so a field or stand leads up to
  // the property level without leaving the map.
  propertyId?: string | null;
  entityName?: string | null; // holding entity, shown for properties
  farmActivity?: FarmActivityInfo[] | null;
  // A bin site's child bins (name + capacity), and a child's parent
  // name, resolved by the map from its loaded asset list.
  assetChildren?: Array<{ id: string; name: string; capacityBu: number | null }> | null;
  parentAssetName?: string | null;
  onClose: () => void;
  onEditGeometry: () => void;
  onSplit?: () => void; // timber stands: split with a drawn line
  onPivotCircle?: () => void; // irrigation pivots: parametric coverage circle
  onCircleFootprint?: () => void; // round assets: parametric circle footprint
  onSelectAsset?: (id: string) => void; // tap a child bin in a site panel
  onSelectProperty?: (id: string) => void; // tap the property row of a land unit
  onAddBin?: () => void; // bin sites: place a new child bin
  onChanged: () => void;
}) {
  const supabase = createClient();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Pollinator habitats take photos straight from the map panel (a
  // phone in the field): stored like the asset pages' quick photos,
  // typed other, no reading. They show in the gallery on the page.
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  const takesPhotos = entityType === "pollinator_habitat";

  async function uploadPhotos(files: FileList | null) {
    if (!files || files.length === 0) return;
    setPhotoBusy(true);
    setPhotoNote(null);
    let saved = 0;
    let failure: string | null = null;
    for (const file of Array.from(files)) {
      const result = await uploadDocument(supabase, {
        orgId: row.organization_id,
        entityType,
        entityId: row.id,
        file,
        docType: "other",
        title: null,
        aiSuggestedType: null,
        propertyIds: [],
      });
      if ("error" in result) failure = result.error;
      else saved += 1;
    }
    setPhotoBusy(false);
    if (photoInputRef.current) photoInputRef.current.value = "";
    setPhotoNote(
      failure
        ? failure
        : `${saved} photo${saved === 1 ? "" : "s"} added. See them on the full page.`
    );
  }

  const isIssue = entityType === "maintenance_issue";
  const issue = isIssue ? (row as MaintenanceIssueGeo) : null;
  const title =
    entityType === "parcel"
      ? `Parcel ${(row as ParcelGeo).parcel_number}`
      : issue
        ? issueTitle(issue)
        : ((row as { name?: string }).name ?? "");

  async function flipStatus() {
    if (!issue) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase
      .from("maintenance_issues")
      .update(toggleStatus(issue))
      .eq("id", issue.id);
    setBusy(false);
    if (err) {
      setError("Could not update the issue.");
      return;
    }
    onChanged();
  }

  // This one shape as a KML file (Google Earth, onX, a surveyor's
  // software). Its name, acres, and property travel along.
  const exportFeature = rowToExportFeature(row, entityType, propertyName);
  function downloadKml() {
    if (!exportFeature) return;
    downloadTextFile(
      `${fileSlug(exportFeature.name, "shape")}.kml`,
      buildKml([exportFeature], {
        documentName: exportFeature.name,
        description: exportFeature.description,
      }),
      EXPORT_MIME.kml
    );
  }

  const geometryButtonLabel =
    entityType === "road"
      ? "Edit line"
      : entityType === "cemetery" || isIssue
        ? ((row as { geom_geojson?: { type?: string } | null }).geom_geojson?.type?.includes("Line")
            ? "Edit line"
            : (row as { geom_geojson?: { type?: string } | null }).geom_geojson?.type?.includes("Polygon")
              ? "Edit boundary"
              : "Move pin")
      : entityType === "easement"
        ? ((row as EasementGeo).geom_geojson ? "Edit line" : "Edit boundary")
        : entityType === "asset"
          ? ((row as AssetGeo).geom_geojson?.type?.includes("Line")
              ? "Edit line"
              : (row as AssetGeo).geom_geojson?.type?.includes("Polygon")
                ? "Edit outline"
                : "Move pin")
          : "Edit boundary";

  async function saveDetails(formData: FormData) {
    setBusy(true);
    setError(null);
    const patch: Record<string, string | number | string[] | null> = {};
    for (const f of EDIT_FIELDS[entityType]) {
      const raw = String(formData.get(f.key) ?? "").trim();
      patch[f.key] = fieldPatchValue(f, raw);
    }
    const { error: err } = await supabase
      .from(ENTITY_TABLE[entityType])
      .update(patch)
      .eq("id", row.id);
    setBusy(false);
    if (err) {
      setError("Could not save changes.");
      return;
    }
    setEditing(false);
    onChanged();
  }

  async function remove() {
    const isAsset = entityType === "asset";
    const message = isAsset
      ? "Mark this asset inactive? It stays in your records but comes off the map list as removed."
      : `Delete this ${TYPE_LABEL[entityType].toLowerCase()}? This cannot be undone.`;
    if (!window.confirm(message)) return;
    setBusy(true);
    const { error: err } = isAsset
      ? await supabase.from("assets").update({ is_active: false }).eq("id", row.id)
      : await supabase.from(ENTITY_TABLE[entityType]).delete().eq("id", row.id);
    setBusy(false);
    if (err) {
      setError("Could not complete that. Properties with things attached must be emptied first.");
      return;
    }
    onClose();
    onChanged();
  }

  const isLineEasement = entityType === "easement" && !!(row as EasementGeo).geom_geojson;
  // Grain headline figures: a bin's own capacity, a site's total over
  // its child bins (passed in by the map, which holds the asset list).
  const assetRow = entityType === "asset" ? (row as AssetGeo) : null;
  const isBin = assetRow?.asset_type === "grain_bin";
  const isBinSite = assetRow?.asset_type === "grain_bin_site";
  const binCapacity = isBin ? Number(assetRow?.details?.capacity_bu) || null : null;
  const siteCapacity = isBinSite
    ? (assetChildren ?? []).reduce((s, c) => s + (c.capacityBu ?? 0), 0)
    : null;
  const metric =
    entityType === "road" || isLineEasement
      ? `${formatNumber(Math.round((row as RoadGeo).length_feet ?? 0))} ft (${((row as RoadGeo).miles ?? 0).toFixed(2)} mi)`
      : isBin
        ? binCapacity != null
          ? `${formatNumber(binCapacity)} bu`
          : null
        : isBinSite
          ? `${formatNumber(siteCapacity ?? 0)} bu`
          : entityType !== "asset" && !isIssue && "acres" in row &&
              (row as { acres: number | null }).acres !== null
            ? `${formatAcres((row as { acres: number | null }).acres)} acres`
            : null;
  const metricLabel =
    entityType === "road" || isLineEasement
      ? "Length"
      : isBin
        ? "Capacity"
        : isBinSite
          ? "Total capacity"
          : "Acres";

  return (
    <div className="pointer-events-auto fixed inset-x-0 bottom-16 z-30 max-h-[55%] overflow-y-auto rounded-t-2xl border-t border-gray-200 bg-white p-4 shadow-2xl md:absolute md:inset-auto md:right-4 md:top-4 md:bottom-auto md:max-h-[calc(100%-2rem)] md:w-80 md:rounded-xl md:border">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className={"text-xs font-semibold uppercase tracking-wide " + (isIssue ? "text-amber-800" : "text-kelly-600")}>
            {entityType === "asset"
              ? (ASSET_TYPES[(row as AssetGeo).asset_type]?.label ?? "Asset")
              : isIssue
                ? "Needs attention"
                : TYPE_LABEL[entityType]}
          </p>
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          {issue ? (
            <p className="mt-1 flex flex-wrap gap-1.5">
              <span className={"rounded-full px-2 py-0.5 text-[11px] font-medium " + statusClass(issue.status)}>
                {STATUS_LABELS[issue.status]}
              </span>
              {issue.severity ? (
                <span className={"rounded-full px-2 py-0.5 text-[11px] font-medium " + severityClass(issue.severity as IssueSeverity)}>
                  {SEVERITY_LABELS[issue.severity as IssueSeverity]} severity
                </span>
              ) : null}
            </p>
          ) : null}
          <Link
            href={detailPagePath(entityType, row.id)}
            className="mt-0.5 inline-block text-sm font-medium text-kelly-700 hover:underline"
          >
            View full page &rarr;
          </Link>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {!editing ? (
        <div className="mt-3 space-y-3">
          {/* Emergency contact: prominent (red, tap-to-call) on pipeline
              and powerline easements, a calmer row for other types. */}
          {entityType === "easement" && (row as EasementGeo).emergency_phone ? (
            <a
              href={`tel:${(row as EasementGeo).emergency_phone}`}
              className={
                "block rounded-lg border p-2.5 " +
                (easementShowsEmergencyPhoneProminently(
                  (row as EasementGeo).easement_type
                )
                  ? "border-red-300 bg-red-50"
                  : "border-gray-200 bg-gray-50")
              }
            >
              <span
                className={
                  "block text-xs font-semibold uppercase tracking-wide " +
                  (easementShowsEmergencyPhoneProminently(
                    (row as EasementGeo).easement_type
                  )
                    ? "text-red-700"
                    : "text-gray-500")
                }
              >
                Emergency contact
              </span>
              <span className="block text-lg font-semibold text-gray-900">
                {(row as EasementGeo).emergency_phone}
              </span>
            </a>
          ) : null}
          <dl className="space-y-1.5 text-sm">
            {metric ? (
              <div className="flex justify-between">
                <dt className="text-gray-500">{metricLabel}</dt>
                <dd className="font-medium text-gray-900">{metric}</dd>
              </div>
            ) : null}
            {isBin && parentAssetName && assetRow?.parent_asset_id ? (
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500">Bin site</dt>
                <dd className="text-right font-medium">
                  <button
                    onClick={() => onSelectAsset?.(assetRow.parent_asset_id!)}
                    className="text-kelly-700 hover:underline"
                  >
                    {parentAssetName}
                  </button>
                </dd>
              </div>
            ) : null}
            {propertyName ? (
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500">Property</dt>
                <dd className="text-right font-medium text-gray-900">
                  {propertyId && onSelectProperty ? (
                    <>
                      <button
                        type="button"
                        onClick={() => onSelectProperty(propertyId)}
                        className="text-kelly-700 hover:underline"
                      >
                        {propertyName}
                      </button>
                      <Link
                        href={detailPagePath("property", propertyId)}
                        className="ml-2 text-xs font-medium text-gray-500 hover:text-kelly-700 hover:underline"
                      >
                        Page &rarr;
                      </Link>
                    </>
                  ) : (
                    propertyName
                  )}
                </dd>
              </div>
            ) : null}
            {entityName ? (
              <div className="flex justify-between">
                <dt className="text-gray-500">Entity</dt>
                <dd className="font-medium text-gray-900">{entityName}</dd>
              </div>
            ) : null}
            {detailRows(entityType, row).map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3">
                <dt className="text-gray-500">{label}</dt>
                <dd className="text-right font-medium text-gray-900">{value}</dd>
              </div>
            ))}
            {"notes" in row && row.notes ? (
              <div>
                <dt className="text-gray-500">Notes</dt>
                <dd className="mt-0.5 whitespace-pre-wrap text-gray-900">{row.notes}</dd>
              </div>
            ) : null}
          </dl>

          {/* A bin site's bins, each tappable, plus the add action. */}
          {isBinSite ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-2.5">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                {(assetChildren ?? []).length} bin
                {(assetChildren ?? []).length === 1 ? "" : "s"} on this site
              </p>
              {(assetChildren ?? []).map((c) => (
                <button
                  key={c.id}
                  onClick={() => onSelectAsset?.(c.id)}
                  className="flex w-full items-baseline justify-between py-0.5 text-left text-sm hover:underline"
                >
                  <span className="font-medium text-gray-900">{c.name}</span>
                  <span className="text-pine-900">
                    {c.capacityBu != null ? `${formatNumber(c.capacityBu)} bu` : ""}
                  </span>
                </button>
              ))}
              {onAddBin ? (
                <button
                  onClick={onAddBin}
                  className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  + Add bin to this site
                </button>
              ) : null}
            </div>
          ) : null}

          {farmActivity && farmActivity.length > 0 ? (
            <div className="rounded-lg border border-kelly-100 bg-kelly-50 p-2.5">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-pine-900">
                Farm activity ({new Date().getFullYear()})
              </p>
              {farmActivity.map((a, i) => (
                <div key={i} className="text-sm text-gray-800">
                  <p className="flex items-center gap-1.5 font-medium">
                    <span
                      className="h-3 w-3 rounded-[2px] border border-gray-300"
                      style={{ background: a.color }}
                    />
                    {a.crop}
                    {a.varieties.length > 0 ? (
                      <span className="font-normal text-gray-600">
                        ({a.varieties.join(", ")})
                      </span>
                    ) : null}
                  </p>
                  {a.entity ? (
                    <p className="text-xs text-gray-600">Operated by {a.entity}</p>
                  ) : null}
                  <p className="text-xs text-gray-600">
                    {a.planting_date ? `Planted ${a.planting_date} · ` : ""}
                    {a.state === "complete"
                      ? "Harvested"
                      : a.state === "in_progress"
                        ? "Harvesting"
                        : "Growing"}
                    {a.yieldText
                      ? ` · ${a.yieldText}`
                      : a.state === "complete" && !a.yieldShared
                        ? " · yield not shared"
                        : ""}
                  </p>
                </div>
              ))}
              <p className="mt-1 text-[10px] text-gray-500">
                From {farmActivity[0].source}
              </p>
            </div>
          ) : null}

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <div className="flex flex-wrap gap-2">
            {issue ? (
              <button
                onClick={flipStatus}
                disabled={busy}
                className={
                  "rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-60 " +
                  (issue.status === "resolved"
                    ? "border border-gray-300 text-gray-700 hover:bg-gray-50"
                    : "bg-amber-600 text-white hover:bg-amber-700")
                }
              >
                {busy ? "Saving..." : issue.status === "resolved" ? "Reopen" : "Mark resolved"}
              </button>
            ) : null}
            {entityType === "asset" ? (
              <Link
                href={`/assets/${row.id}`}
                className="rounded-lg bg-kelly-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-kelly-600"
              >
                Open asset page
              </Link>
            ) : (
              <button
                onClick={() => setEditing(true)}
                className="rounded-lg bg-kelly-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-kelly-600"
              >
                Edit details
              </button>
            )}
            {(() => {
              const isPivot =
                entityType === "asset" &&
                (row as AssetGeo).asset_type === "irrigation_pivot";
              const hasCircle = isPivot && (row as AssetGeo).details?.center_lon != null;
              const footprintCircle =
                entityType === "asset" &&
                !isPivot &&
                circleFromDetails((row as AssetGeo).details as Record<string, unknown>) !== null;
              const canCircle =
                entityType === "asset" &&
                !isPivot &&
                !ASSET_TYPES[(row as AssetGeo).asset_type]?.noCircle &&
                !(row as AssetGeo).geom_geojson?.type?.includes("Line");
              return (
                <>
                  {/* Pivot shapes are parametric: a 64-vertex circle is
                      uneditable by hand, so shaped pivots get the
                      editor instead of raw geometry editing. */}
                  {!hasCircle && !footprintCircle ? (
                    <button
                      onClick={onEditGeometry}
                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      {geometryButtonLabel}
                    </button>
                  ) : null}
                  {isPivot && onPivotCircle ? (
                    <button
                      onClick={onPivotCircle}
                      className="rounded-lg border border-sky-400 px-3 py-1.5 text-sm font-medium text-sky-700 hover:bg-sky-50"
                    >
                      {hasCircle ? "Edit coverage" : "Add coverage circle"}
                    </button>
                  ) : null}
                  {/* Circle footprints are parametric too (center +
                      diameter): edits reopen the mini editor. */}
                  {canCircle && onCircleFootprint ? (
                    <button
                      onClick={onCircleFootprint}
                      className="rounded-lg border border-sky-400 px-3 py-1.5 text-sm font-medium text-sky-700 hover:bg-sky-50"
                    >
                      {footprintCircle ? "Edit circle" : "Circle footprint"}
                    </button>
                  ) : null}
                </>
              );
            })()}
            {entityType === "timber_stand" && onSplit ? (
              <button
                onClick={onSplit}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Split
              </button>
            ) : null}
            {takesPhotos ? (
              <>
                <button
                  onClick={() => photoInputRef.current?.click()}
                  disabled={photoBusy}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                >
                  {photoBusy ? "Uploading..." : "Add photos"}
                </button>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  className="hidden"
                  onChange={(e) => uploadPhotos(e.target.files)}
                />
              </>
            ) : null}
            {entityType === "property" ? (
              <Link
                href={`/timber-scan/${row.id}`}
                className="rounded-lg border border-pine-800 px-3 py-1.5 text-sm font-medium text-pine-900 hover:bg-kelly-50"
              >
                Timber Scan
              </Link>
            ) : null}
            {exportFeature ? (
              <button
                onClick={downloadKml}
                title="Download this shape as a KML file for Google Earth or other mapping software"
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                KML
              </button>
            ) : null}
            <button
              onClick={remove}
              disabled={busy}
              className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
            >
              {entityType === "asset" ? "Deactivate" : "Delete"}
            </button>
          </div>
          {photoNote ? (
            <p className={"text-sm " + (photoNote.endsWith("full page.") ? "text-gray-600" : "text-red-600")}>
              {photoNote}
            </p>
          ) : null}
          {entityType === "asset" ? (
            <button
              onClick={() => setEditing(true)}
              className="text-sm font-medium text-kelly-700 hover:underline"
            >
              Quick edit name and notes
            </button>
          ) : null}
        </div>
      ) : (
        <form action={saveDetails} className="mt-3 space-y-3">
          {EDIT_FIELDS[entityType].map((f) => (
            <div key={f.key}>
              <label className="mb-1 block text-sm font-medium text-gray-700">{f.label}</label>
              {f.input === "textarea" ? (
                <textarea
                  name={f.key}
                  rows={3}
                  defaultValue={String((row as unknown as Record<string, unknown>)[f.key] ?? "")}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-kelly-500 focus:outline-none"
                />
              ) : f.input === "select" ? (
                <select
                  name={f.key}
                  defaultValue={String((row as unknown as Record<string, unknown>)[f.key] ?? "")}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-kelly-500 focus:outline-none"
                >
                  <option value="">Not set</option>
                  {Object.entries(f.options ?? {}).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  name={f.key}
                  type={f.input === "number" ? "number" : f.input === "date" ? "date" : "text"}
                  step={f.input === "number" ? "any" : undefined}
                  required={f.required}
                  defaultValue={fieldDisplayValue(
                    f,
                    (row as unknown as Record<string, unknown>)[f.key]
                  )}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-kelly-500 focus:outline-none"
                />
              )}
            </div>
          ))}

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-kelly-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-kelly-600 disabled:opacity-60"
            >
              {busy ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
