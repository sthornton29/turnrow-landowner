"use client";

import { useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { MultiPolygon } from "geojson";
import { createClient } from "@/lib/supabase/client";
import { parseBoundaryFile } from "@/lib/geo/parse";
import {
  IMPORT_ACCEPT,
  IMPORT_POLYGON_OPTIONS,
  buildImportRows,
  defaultPolygonTypeFor,
  importValidationError,
  saveImportRows,
  type ImportRow,
  type ImportSaveResult,
} from "@/lib/geo/importRows";
import { formatAcres } from "@/lib/format";
import { ASSET_TYPES, ASSET_TYPE_ORDER } from "@/lib/assetTypes";
import type { AssetType, EntityType } from "@/types/db";
import type { PreviewFeature } from "./PreviewMap";

const PreviewMap = dynamic(() => import("./PreviewMap"), { ssr: false });

// The rows, validation, and save live in lib/geo/importRows.ts, shared
// with the map's own import panel so a file imports the same way from
// either screen.

export default function ImportClient({
  orgId,
  existingProperties,
}: {
  orgId: string;
  existingProperties: Array<{
    id: string;
    name: string;
    boundary_geojson: MultiPolygon | null;
  }>;
}) {
  const supabase = useMemo(() => createClient(), []);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const matchableProperties = useMemo(
    () =>
      existingProperties.map((p) => ({ id: p.id, boundary: p.boundary_geojson })),
    [existingProperties]
  );

  const [rows, setRows] = useState<ImportRow[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<ImportSaveResult | null>(null);

  const defaultPolygonType = defaultPolygonTypeFor(existingProperties.length);

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setParsing(true);
    setResult(null);
    const newRows: ImportRow[] = [];
    const newSkipped: string[] = [];
    const newErrors: string[] = [];

    for (const file of Array.from(fileList)) {
      try {
        const parsed = await parseBoundaryFile(file);
        newSkipped.push(...parsed.skipped.map((s) => `${file.name}: ${s}`));
        // Each row is preassigned to the property that contains it; the
        // user confirms or changes it in the review.
        newRows.push(
          ...buildImportRows(file.name, parsed, { defaultPolygonType, matchableProperties })
        );
      } catch (err) {
        newErrors.push(err instanceof Error ? err.message : String(err));
      }
    }

    setRows((prev) => [...prev, ...newRows]);
    setSkipped((prev) => [...prev, ...newSkipped]);
    setFileErrors((prev) => [...prev, ...newErrors]);
    setParsing(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function updateRow(localId: string, patch: Partial<ImportRow>) {
    setRows((prev) =>
      prev.map((r) => (r.localId === localId ? { ...r, ...patch } : r))
    );
  }

  const newPropertyRows = rows.filter(
    (r) => r.include && r.entityType === "property"
  );

  const included = rows.filter((r) => r.include);
  const validationError = useMemo(() => importValidationError(rows), [rows]);

  async function saveAll() {
    if (validationError || included.length === 0) return;
    setSaving(true);
    const outcome = await saveImportRows(supabase, orgId, rows);
    setSaving(false);
    setResult(outcome);
    if (outcome.failures.length === 0) {
      setRows([]);
      setSkipped([]);
      setFileErrors([]);
    } else {
      // Keep only what did not save, so a retry never doubles a shape.
      const saved = new Set(outcome.savedLocalIds);
      setRows((prev) => prev.filter((r) => !saved.has(r.localId)));
    }
  }

  const previewFeatures: PreviewFeature[] = rows.map((r) => ({
    localId: r.localId,
    geometry: r.geometry,
    entityType: r.entityType,
    included: r.include,
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Import</h1>
        <p className="mt-1 text-sm text-gray-600">
          Upload GeoJSON, KML, KMZ, or zipped shapefiles. Boundaries, lines
          (roads, pipe), and points (assets) are all supported. You review
          every feature before anything is saved.
        </p>
      </div>

      <Link
        href="/import/county"
        className="flex items-center justify-between rounded-xl border border-kelly-100 bg-kelly-50 p-4 transition hover:border-kelly-500"
      >
        <span>
          <span className="block font-semibold text-pine-900">
            Import from county records
          </span>
          <span className="block text-sm text-gray-600">
            No files needed: search your county{"'"}s public parcel records by
            owner name and import real boundaries in minutes.
          </span>
        </span>
        <span className="text-kelly-600">&rarr;</span>
      </Link>

      <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-gray-300 bg-white px-4 py-8 text-center transition hover:border-kelly-500 hover:bg-kelly-50">
        <span className="text-sm font-medium text-gray-700">
          {parsing ? "Reading files..." : "Tap to choose files"}
        </span>
        <span className="text-xs text-gray-500">.geojson, .json, .kml, .kmz, .zip</span>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={IMPORT_ACCEPT}
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </label>

      {fileErrors.length > 0 ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {fileErrors.map((e, i) => (
            <p key={i}>{e}</p>
          ))}
        </div>
      ) : null}

      {skipped.length > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <p className="font-medium">Skipped features</p>
          {skipped.map((s, i) => (
            <p key={i}>{s}</p>
          ))}
        </div>
      ) : null}

      {result ? (
        <div
          className={
            "rounded-lg border p-3 text-sm " +
            (result.failures.length > 0
              ? "border-amber-200 bg-amber-50 text-amber-800"
              : "border-kelly-100 bg-kelly-50 text-pine-900")
          }
        >
          <p className="font-medium">
            Saved {result.saved} feature{result.saved === 1 ? "" : "s"}.
          </p>
          {result.failures.map((f, i) => (
            <p key={i}>{f}</p>
          ))}
          <Link href="/map" className="mt-1 inline-block font-semibold text-kelly-700 hover:underline">
            View on the map
          </Link>
        </div>
      ) : null}

      {rows.length > 0 ? (
        <>
          <div>
            <PreviewMap features={previewFeatures} />
            <p className="mt-1 text-xs text-gray-500">
              White = property, gold = parcel, green = field, mint = timber,
              gray = road, blue = asset. Faded shapes are excluded.
            </p>
          </div>

          <div className="space-y-2">
            {rows.map((r) => (
              <div
                key={r.localId}
                className={
                  "rounded-lg border bg-white p-3 " +
                  (r.include ? "border-gray-200" : "border-gray-100 opacity-60")
                }
              >
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="checkbox"
                    checked={r.include}
                    onChange={(e) => updateRow(r.localId, { include: e.target.checked })}
                    className="h-4 w-4 accent-kelly-500"
                    title="Include in import"
                  />

                  {r.kind === "polygon" ? (
                    <select
                      value={r.entityType}
                      onChange={(e) => {
                        const t = e.target.value as EntityType;
                        updateRow(r.localId, {
                          entityType: t,
                          propertyRef:
                            t === "property"
                              ? ""
                              : r.propertyRef || r.suggestedRef || "",
                        });
                      }}
                      className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
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
                        if (v === "road") {
                          updateRow(r.localId, { entityType: "road" });
                        } else {
                          updateRow(r.localId, {
                            entityType: "asset",
                            assetType: v.slice("asset:".length) as AssetType,
                          });
                        }
                      }}
                      className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                    >
                      <option value="road">Road</option>
                      <option value="asset:underground_pipe">Underground pipe</option>
                      <option value="asset:fence">Fence</option>
                    </select>
                  ) : (
                    <select
                      value={r.assetType}
                      onChange={(e) =>
                        updateRow(r.localId, {
                          entityType: "asset",
                          assetType: e.target.value as AssetType,
                        })
                      }
                      className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                    >
                      {ASSET_TYPE_ORDER.filter(
                        (t) => ASSET_TYPES[t].defaultGeometry === "point"
                      ).map((t) => (
                        <option key={t} value={t}>
                          {ASSET_TYPES[t].label}
                        </option>
                      ))}
                    </select>
                  )}

                  <input
                    value={r.name}
                    onChange={(e) => updateRow(r.localId, { name: e.target.value })}
                    placeholder={r.entityType === "parcel" ? "Parcel number" : "Name"}
                    className="min-w-32 flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                  />

                  {r.entityType !== "property" ? (
                    <>
                      <select
                        value={r.propertyRef}
                        onChange={(e) => updateRow(r.localId, { propertyRef: e.target.value })}
                        className="max-w-48 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                      >
                        <option value="">
                          {r.entityType === "asset"
                            ? "No property"
                            : "Assign to property..."}
                        </option>
                        {existingProperties.map((p) => (
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
                          className="rounded-full bg-kelly-100 px-2 py-0.5 text-[10px] font-medium text-kelly-700"
                          title="This boundary sits inside this property; confirm or change it"
                        >
                          Suggested from location
                        </span>
                      ) : null}
                    </>
                  ) : null}

                  <span className="ml-auto whitespace-nowrap text-xs text-gray-500">
                    {r.acres !== null
                      ? `~${formatAcres(r.acres)} ac`
                      : r.kind === "line"
                        ? "line"
                        : "point"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-gray-400">{r.sourceFile}</p>
              </div>
            ))}
          </div>

          {validationError ? (
            <p className="text-sm text-red-600">{validationError}</p>
          ) : null}

          <div className="flex items-center gap-3">
            <button
              onClick={saveAll}
              disabled={saving || !!validationError || included.length === 0}
              className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-60"
            >
              {saving
                ? "Saving..."
                : `Save ${included.length} feature${included.length === 1 ? "" : "s"}`}
            </button>
            <button
              onClick={() => {
                setRows([]);
                setSkipped([]);
                setFileErrors([]);
              }}
              className="text-sm font-medium text-gray-600 hover:underline"
            >
              Clear
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
