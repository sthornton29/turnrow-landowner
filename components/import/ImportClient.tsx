"use client";

import { useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { MultiPolygon } from "geojson";
import { createClient } from "@/lib/supabase/client";
import { parseBoundaryFile } from "@/lib/geo/parse";
import { approxAcres } from "@/lib/geo/normalize";
import { formatAcres } from "@/lib/format";
import type { EntityType } from "@/types/db";
import type { PreviewFeature } from "./PreviewMap";

const PreviewMap = dynamic(() => import("./PreviewMap"), { ssr: false });

interface ImportRow {
  localId: string;
  include: boolean;
  entityType: EntityType;
  name: string;
  // "existing:<uuid>" | "new:<localId>" | ""
  propertyRef: string;
  geometry: MultiPolygon;
  acres: number;
  sourceFile: string;
}

const TABLE: Record<EntityType, string> = {
  property: "properties",
  parcel: "parcels",
  field: "fields",
};

export default function ImportClient({
  orgId,
  existingProperties,
}: {
  orgId: string;
  existingProperties: Array<{ id: string; name: string }>;
}) {
  const supabase = useMemo(() => createClient(), []);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [rows, setRows] = useState<ImportRow[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ saved: number; failures: string[] } | null>(null);

  const defaultType: EntityType = existingProperties.length > 0 ? "field" : "property";
  const defaultPropertyRef =
    existingProperties.length > 0 ? `existing:${existingProperties[0].id}` : "";

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
        for (const f of parsed.features) {
          newRows.push({
            localId: `${file.name}-${f.sourceIndex}-${Math.random().toString(36).slice(2, 8)}`,
            include: true,
            entityType: defaultType,
            name: f.suggestedName,
            propertyRef: defaultPropertyRef,
            geometry: f.geometry,
            acres: approxAcres(f.geometry),
            sourceFile: file.name,
          });
        }
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

  // Property options: existing properties plus any feature in this batch
  // that is being imported as a property.
  const newPropertyRows = rows.filter(
    (r) => r.include && r.entityType === "property"
  );

  const included = rows.filter((r) => r.include);
  const validationError = useMemo(() => {
    for (const r of included) {
      if (!r.name.trim()) return "Every included feature needs a name.";
      if (r.entityType !== "property" && !r.propertyRef)
        return "Parcels and fields must be assigned to a property.";
    }
    return null;
  }, [included]);

  async function saveAll() {
    if (validationError || included.length === 0) return;
    setSaving(true);
    const failures: string[] = [];
    let saved = 0;
    const newPropertyIds = new Map<string, string>(); // localId -> db id

    async function setBoundary(entityType: EntityType, id: string, mp: MultiPolygon) {
      const { error } = await supabase.rpc("set_boundary", {
        p_entity_type: entityType,
        p_entity_id: id,
        p_geojson: mp,
      });
      return error;
    }

    // Pass 1: properties (so parcels/fields in the same batch can reference them).
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
      const bErr = await setBoundary("property", data.id, r.geometry);
      if (bErr) {
        failures.push(`${r.name}: boundary failed (${bErr.message})`);
        continue;
      }
      newPropertyIds.set(r.localId, data.id);
      saved++;
    }

    // Pass 2: parcels and fields.
    for (const r of included.filter((x) => x.entityType !== "property")) {
      let propertyId: string | null = null;
      if (r.propertyRef.startsWith("existing:")) {
        propertyId = r.propertyRef.slice("existing:".length);
      } else if (r.propertyRef.startsWith("new:")) {
        propertyId = newPropertyIds.get(r.propertyRef.slice("new:".length)) ?? null;
      }
      if (!propertyId) {
        failures.push(`${r.name}: its property was not saved, skipped.`);
        continue;
      }
      const insert: Record<string, unknown> =
        r.entityType === "parcel"
          ? { organization_id: orgId, property_id: propertyId, parcel_number: r.name.trim() }
          : { organization_id: orgId, property_id: propertyId, name: r.name.trim() };
      const { data, error } = await supabase
        .from(TABLE[r.entityType])
        .insert(insert)
        .select("id")
        .single();
      if (error || !data) {
        failures.push(`${r.name}: ${error?.message ?? "insert failed"}`);
        continue;
      }
      const bErr = await setBoundary(r.entityType, data.id, r.geometry);
      if (bErr) {
        failures.push(`${r.name}: boundary failed (${bErr.message})`);
        continue;
      }
      saved++;
    }

    setSaving(false);
    setResult({ saved, failures });
    if (failures.length === 0) {
      setRows([]);
      setSkipped([]);
      setFileErrors([]);
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
        <h1 className="text-xl font-semibold text-gray-900">Import boundaries</h1>
        <p className="mt-1 text-sm text-gray-600">
          Upload GeoJSON, KML, KMZ, or zipped shapefiles. You will review every
          feature before anything is saved.
        </p>
      </div>

      <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-gray-300 bg-white px-4 py-8 text-center transition hover:border-kelly-500 hover:bg-kelly-50">
        <span className="text-sm font-medium text-gray-700">
          {parsing ? "Reading files..." : "Tap to choose files"}
        </span>
        <span className="text-xs text-gray-500">.geojson, .json, .kml, .kmz, .zip</span>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".geojson,.json,.kml,.kmz,.zip"
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
            Saved {result.saved} boundar{result.saved === 1 ? "y" : "ies"}.
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
              White = property, gold = parcel, green = field. Faded shapes are excluded.
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
                  <select
                    value={r.entityType}
                    onChange={(e) => {
                      const t = e.target.value as EntityType;
                      updateRow(r.localId, {
                        entityType: t,
                        propertyRef: t === "property" ? "" : r.propertyRef || defaultPropertyRef,
                      });
                    }}
                    className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                  >
                    <option value="property">Property</option>
                    <option value="parcel">Parcel</option>
                    <option value="field">Field</option>
                  </select>
                  <input
                    value={r.name}
                    onChange={(e) => updateRow(r.localId, { name: e.target.value })}
                    placeholder={r.entityType === "parcel" ? "Parcel number" : "Name"}
                    className="min-w-32 flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                  />
                  {r.entityType !== "property" ? (
                    <select
                      value={r.propertyRef}
                      onChange={(e) => updateRow(r.localId, { propertyRef: e.target.value })}
                      className="max-w-48 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                    >
                      <option value="">Assign to property...</option>
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
                  ) : null}
                  <span className="ml-auto whitespace-nowrap text-xs text-gray-500">
                    ~{formatAcres(r.acres)} ac
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
                : `Save ${included.length} boundar${included.length === 1 ? "y" : "ies"}`}
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
