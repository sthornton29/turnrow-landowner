"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { formatAcres, formatDollars, formatNumber } from "@/lib/format";
import {
  ASSET_TYPES,
  CONDITION_LABELS,
  ROAD_TYPE_LABELS,
  STAND_TYPE_LABELS,
} from "@/lib/assetTypes";
import type { AssetGeo, EntityType, ParcelGeo, RoadGeo } from "@/types/db";
import type { AnyGeoRow } from "./types";

export const ENTITY_TABLE: Record<EntityType, string> = {
  property: "properties",
  parcel: "parcels",
  field: "fields",
  timber_stand: "timber_stands",
  road: "roads",
  asset: "assets",
};

const TYPE_LABEL: Record<EntityType, string> = {
  property: "Property",
  parcel: "Parcel",
  field: "Field",
  timber_stand: "Timber stand",
  road: "Road",
  asset: "Asset",
};

export interface EditField {
  key: string;
  label: string;
  input: "text" | "number" | "select" | "textarea";
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
  asset: [
    { key: "name", label: "Name", input: "text", required: true },
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

function detailRows(entityType: EntityType, row: AnyGeoRow): Array<[string, string]> {
  const r = row as unknown as Record<string, unknown>;
  const rows: Array<[string, string]> = [];
  const push = (label: string, v: unknown, map?: Record<string, string>) => {
    if (v === null || v === undefined || v === "") return;
    rows.push([label, map ? (map[String(v)] ?? String(v)) : String(v)]);
  };

  if (entityType === "timber_stand") {
    push("Stand type", r.stand_type, STAND_TYPE_LABELS);
    push("Species", r.species);
    push("Established", r.year_established);
    push("Site index", r.site_index);
    push("Last thinned", r.last_thinning_year);
    push("Last burn", r.last_burn_year);
  } else if (entityType === "road") {
    push("Road type", r.road_type, ROAD_TYPE_LABELS);
  } else if (entityType === "asset") {
    const a = row as AssetGeo;
    push("Type", ASSET_TYPES[a.asset_type]?.label ?? a.asset_type);
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
      const shape = a.details.custom_shape === true;
      const positions = Array.isArray(a.details.positions)
        ? a.details.positions.length
        : 0;
      rows.push([
        "Coverage",
        (shape ? "Custom shape" : full ? "Full circle" : `${sweep}° sweep`) +
          (positions > 0
            ? ` · ${positions + 1} towable position${positions ? "s" : ""}`
            : ""),
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
    // Type-specific details, labeled from the config
    for (const f of ASSET_TYPES[a.asset_type]?.fields ?? []) {
      if (f.mapManaged) continue;
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
  harvested: boolean;
  yieldText: string | null;
  yieldShared: boolean;
  source: string;
}

// Detail panel for a clicked map feature. Desktop: card on the right side of
// the map. Mobile: bottom sheet.
export default function FeaturePanel({
  entityType,
  row,
  propertyName,
  entityName = null,
  farmActivity = null,
  onClose,
  onEditGeometry,
  onSplit,
  onPivotCircle,
  onChanged,
}: {
  entityType: EntityType;
  row: AnyGeoRow;
  propertyName: string | null;
  entityName?: string | null; // holding entity, shown for properties
  farmActivity?: FarmActivityInfo[] | null;
  onClose: () => void;
  onEditGeometry: () => void;
  onSplit?: () => void; // timber stands: split with a drawn line
  onPivotCircle?: () => void; // irrigation pivots: parametric coverage circle
  onChanged: () => void;
}) {
  const supabase = createClient();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title =
    entityType === "parcel"
      ? `Parcel ${(row as ParcelGeo).parcel_number}`
      : ((row as { name?: string }).name ?? "");

  const geometryButtonLabel =
    entityType === "road"
      ? "Edit line"
      : entityType === "asset"
        ? ((row as AssetGeo).geom_geojson?.type?.includes("Line")
            ? "Edit line"
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

  const metric =
    entityType === "road"
      ? `${formatNumber(Math.round((row as RoadGeo).length_feet ?? 0))} ft (${((row as RoadGeo).miles ?? 0).toFixed(2)} mi)`
      : entityType !== "asset" && "acres" in row
        ? `${formatAcres((row as { acres: number | null }).acres)} acres`
        : null;

  return (
    <div className="pointer-events-auto fixed inset-x-0 bottom-16 z-30 max-h-[55%] overflow-y-auto rounded-t-2xl border-t border-gray-200 bg-white p-4 shadow-2xl md:absolute md:inset-auto md:right-4 md:top-4 md:bottom-auto md:max-h-[calc(100%-2rem)] md:w-80 md:rounded-xl md:border">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-kelly-600">
            {entityType === "asset"
              ? (ASSET_TYPES[(row as AssetGeo).asset_type]?.label ?? "Asset")
              : TYPE_LABEL[entityType]}
          </p>
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
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
          <dl className="space-y-1.5 text-sm">
            {metric ? (
              <div className="flex justify-between">
                <dt className="text-gray-500">{entityType === "road" ? "Length" : "Acres"}</dt>
                <dd className="font-medium text-gray-900">{metric}</dd>
              </div>
            ) : null}
            {propertyName ? (
              <div className="flex justify-between">
                <dt className="text-gray-500">Property</dt>
                <dd className="font-medium text-gray-900">{propertyName}</dd>
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
                  <p className="text-xs text-gray-600">
                    {a.planting_date ? `Planted ${a.planting_date} · ` : ""}
                    {a.harvested ? "Harvested" : "Growing"}
                    {a.yieldText
                      ? ` · ${a.yieldText}`
                      : a.harvested && !a.yieldShared
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
              const details = (row as AssetGeo).details;
              const customShape = isPivot && details?.custom_shape === true;
              const hasCircle =
                isPivot && !customShape && details?.center_lon != null;
              return (
                <>
                  {/* Pivot shapes are parametric: a 64-vertex circle is
                      uneditable by hand, so shaped pivots get the
                      editor instead of raw geometry editing. A pivot
                      converted to a custom shape edits vertices like
                      any polygon (one-way). */}
                  {!hasCircle ? (
                    <button
                      onClick={onEditGeometry}
                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      {geometryButtonLabel}
                    </button>
                  ) : null}
                  {isPivot && !customShape && onPivotCircle ? (
                    <button
                      onClick={onPivotCircle}
                      className="rounded-lg border border-sky-400 px-3 py-1.5 text-sm font-medium text-sky-700 hover:bg-sky-50"
                    >
                      {hasCircle ? "Edit coverage" : "Add coverage circle"}
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
            {entityType === "property" ? (
              <Link
                href={`/timber-scan/${row.id}`}
                className="rounded-lg border border-pine-800 px-3 py-1.5 text-sm font-medium text-pine-900 hover:bg-kelly-50"
              >
                Timber Scan
              </Link>
            ) : null}
            <button
              onClick={remove}
              disabled={busy}
              className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
            >
              {entityType === "asset" ? "Deactivate" : "Delete"}
            </button>
          </div>
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
                  type={f.input === "number" ? "number" : "text"}
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
