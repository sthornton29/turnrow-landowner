"use client";

import { useMemo } from "react";
import type { FeatureCollection } from "geojson";
import { ASSET_TYPES, ASSET_TYPE_ORDER } from "@/lib/assetTypes";
import { formatAcres } from "@/lib/format";
import {
  IMPORT_POLYGON_OPTIONS,
  importValidationError,
  type ImportRow,
  type ImportSaveResult,
} from "@/lib/geo/importRows";
import type { AssetType, EntityType } from "@/types/db";
import { draftColorFor } from "./drawColors";

// The map's own import review: the shapes from a dropped or chosen file
// preview on the live map (in the color of what they will become) and
// this panel, in the right-hand slot the print setup uses, says what
// each one is and which property it belongs to. Same rows, validation,
// and save as the Import page (lib/geo/importRows.ts).

function previewColor(r: ImportRow): string {
  return draftColorFor(r.entityType === "asset" ? "asset" : r.entityType);
}

// The rows as the map's "import-preview" source: each shape in the
// color it will save as, faded when unchecked.
export function importPreviewFC(rows: ImportRow[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: rows.map((r) => ({
      type: "Feature",
      geometry: r.geometry,
      properties: { color: previewColor(r), included: r.include },
    })),
  };
}

export default function ImportPanel({
  rows,
  notes,
  properties,
  parsing,
  saving,
  result,
  onUpdateRow,
  onAddFiles,
  onSave,
  onCancel,
}: {
  rows: ImportRow[];
  notes: string[];
  properties: Array<{ id: string; name: string }>;
  parsing: boolean;
  saving: boolean;
  result: ImportSaveResult | null;
  onUpdateRow: (localId: string, patch: Partial<ImportRow>) => void;
  onAddFiles: () => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const included = rows.filter((r) => r.include);
  const validationError = useMemo(() => importValidationError(rows), [rows]);
  const newPropertyRows = included.filter((r) => r.entityType === "property");
  const files = Array.from(new Set(rows.map((r) => r.sourceFile)));

  const selectClass =
    "w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-kelly-500 focus:outline-none";

  return (
    <div className="pointer-events-auto fixed inset-x-0 bottom-16 z-30 max-h-[70%] overflow-y-auto rounded-t-2xl border-t border-gray-200 bg-white p-4 shadow-2xl md:absolute md:inset-auto md:right-3 md:top-3 md:bottom-auto md:max-h-[calc(100%-2rem)] md:w-80 md:rounded-xl md:border">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Import from file</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            {files.length > 0 ? files.join(", ") : "Reading..."}
          </p>
        </div>
        <button
          onClick={onCancel}
          aria-label="Close"
          className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <p className="mt-2 text-xs text-gray-600">
        The shapes are on the map in the color they will save as. Say what
        each one is and where it belongs, then save. Nothing is stored
        until you do.
      </p>

      {notes.length > 0 ? (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          {notes.map((n, i) => (
            <p key={i}>{n}</p>
          ))}
        </div>
      ) : null}

      {result && result.failures.length > 0 ? (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          <p className="font-medium">
            Saved {result.saved}; {result.failures.length} did not save. Fix and try again, or close.
          </p>
          {result.failures.map((f, i) => (
            <p key={i}>{f}</p>
          ))}
        </div>
      ) : null}

      <div className="mt-3 space-y-2">
        {rows.map((r) => (
          <div
            key={r.localId}
            className={
              "rounded-lg border p-2 " +
              (r.include ? "border-gray-200 bg-white" : "border-gray-100 bg-gray-50 opacity-60")
            }
          >
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={r.include}
                onChange={(e) => onUpdateRow(r.localId, { include: e.target.checked })}
                className="h-4 w-4 shrink-0 accent-kelly-500"
                title="Include in the import"
              />
              <span
                className="h-3.5 w-3.5 shrink-0 rounded-[3px] border"
                style={{
                  background: previewColor(r) + "99",
                  borderColor: previewColor(r) === "#ffffff" ? "#6b7280" : previewColor(r),
                }}
              />
              {r.kind === "polygon" ? (
                <select
                  value={r.entityType}
                  onChange={(e) => {
                    const t = e.target.value as EntityType;
                    onUpdateRow(r.localId, {
                      entityType: t,
                      propertyRef: t === "property" ? "" : r.propertyRef || r.suggestedRef || "",
                    });
                  }}
                  className={selectClass}
                >
                  {IMPORT_POLYGON_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              ) : r.kind === "line" ? (
                <select
                  value={r.entityType === "road" ? "road" : `asset:${r.assetType}`}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "road") onUpdateRow(r.localId, { entityType: "road" });
                    else
                      onUpdateRow(r.localId, {
                        entityType: "asset",
                        assetType: v.slice("asset:".length) as AssetType,
                      });
                  }}
                  className={selectClass}
                >
                  <option value="road">Road</option>
                  <option value="asset:underground_pipe">Underground pipe</option>
                  <option value="asset:fence">Fence</option>
                </select>
              ) : (
                <select
                  value={r.assetType}
                  onChange={(e) =>
                    onUpdateRow(r.localId, {
                      entityType: "asset",
                      assetType: e.target.value as AssetType,
                    })
                  }
                  className={selectClass}
                >
                  {ASSET_TYPE_ORDER.filter((t) => ASSET_TYPES[t].defaultGeometry === "point").map((t) => (
                    <option key={t} value={t}>
                      {ASSET_TYPES[t].label}
                    </option>
                  ))}
                </select>
              )}
              <span className="shrink-0 whitespace-nowrap text-[11px] text-gray-500">
                {r.acres !== null ? `~${formatAcres(r.acres)} ac` : r.kind === "line" ? "line" : "point"}
              </span>
            </div>

            <input
              value={r.name}
              onChange={(e) => onUpdateRow(r.localId, { name: e.target.value })}
              placeholder={r.entityType === "parcel" ? "Parcel number" : "Name"}
              className="mt-1.5 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-kelly-500 focus:outline-none"
            />

            {r.entityType !== "property" ? (
              <div className="mt-1.5 flex items-center gap-1.5">
                <select
                  value={r.propertyRef}
                  onChange={(e) => onUpdateRow(r.localId, { propertyRef: e.target.value })}
                  className={selectClass}
                >
                  <option value="">
                    {r.entityType === "asset" ? "No property" : "Assign to property..."}
                  </option>
                  {properties.map((p) => (
                    <option key={p.id} value={`existing:${p.id}`}>
                      {p.name}
                    </option>
                  ))}
                  {newPropertyRows.map((p) => (
                    <option key={p.localId} value={`new:${p.localId}`}>
                      {p.name || "(unnamed)"} (in this import)
                    </option>
                  ))}
                </select>
                {r.suggestedRef && r.propertyRef === r.suggestedRef ? (
                  <span
                    className="shrink-0 rounded-full bg-kelly-100 px-2 py-0.5 text-[10px] font-medium text-kelly-700"
                    title="This shape sits inside this property; confirm or change it"
                  >
                    From location
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {validationError ? <p className="mt-2 text-xs text-red-600">{validationError}</p> : null}

      <button
        onClick={onSave}
        disabled={saving || parsing || !!validationError || included.length === 0}
        className="mt-3 w-full rounded-lg bg-kelly-500 px-3 py-2 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-60"
      >
        {saving
          ? "Saving..."
          : `Save ${included.length} feature${included.length === 1 ? "" : "s"}`}
      </button>
      <div className="mt-2 flex items-center justify-between text-xs">
        <button
          onClick={onAddFiles}
          disabled={parsing || saving}
          className="font-medium text-kelly-700 hover:underline disabled:opacity-60"
        >
          {parsing ? "Reading file..." : "+ Add another file"}
        </button>
        <button onClick={onCancel} className="font-medium text-gray-600 hover:underline">
          Cancel
        </button>
      </div>
    </div>
  );
}
