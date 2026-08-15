"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatAcres, formatNumber } from "@/lib/format";
import { approxAcres, toMultiPolygon } from "@/lib/geo/normalize";
import { normalizeParcelNumber } from "@/lib/tax";
import type { CountyGisService, CountyParcelFeature } from "@/lib/gis";
import type { MultiPolygon } from "geojson";

const CountySearchMap = dynamic(
  () => import("@/components/county/CountySearchMap"),
  { ssr: false }
);

interface ResultRow extends CountyParcelFeature {
  localId: string;
  multiPolygon: MultiPolygon;
  gisAcres: number;
}

const inputClass = "rounded-lg border border-gray-300 px-3 py-2 text-sm";

export default function CountyImportClient({
  orgId,
  services,
  properties,
  existingParcels,
}: {
  orgId: string;
  services: CountyGisService[];
  properties: Array<{ id: string; name: string; county: string | null }>;
  existingParcels: Array<{
    id: string;
    parcel_number: string;
    county: string | null;
    property_id: string;
  }>;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [searchType, setSearchType] = useState<"owner" | "parcel">("owner");
  const [text, setText] = useState("");
  const [results, setResults] = useState<ResultRow[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Assignment
  const [assignMode, setAssignMode] = useState<"existing" | "new">(
    properties.length > 0 ? "existing" : "new"
  );
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? "");
  const [newPropertyName, setNewPropertyName] = useState("");
  const [mergeOutline, setMergeOutline] = useState(true);
  const [dupChoices, setDupChoices] = useState<Record<string, "skip" | "update">>({});
  const [importing, setImporting] = useState(false);

  const service = services.find((s) => s.id === serviceId) ?? null;

  async function search() {
    if (!service) return;
    setSearching(true);
    setError(null);
    setSelected(new Set());
    setHighlighted(null);
    try {
      const res = await fetch("/api/gis/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service_id: service.id,
          search_type: searchType,
          text,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Search failed.");
      const rows: ResultRow[] = [];
      for (const f of body.features as CountyParcelFeature[]) {
        const mp = toMultiPolygon(f.geometry);
        if (!mp) continue;
        rows.push({
          ...f,
          localId: crypto.randomUUID(),
          multiPolygon: mp,
          gisAcres: approxAcres(mp),
        });
      }
      setResults(rows);
      setTruncated(Boolean(body.truncated));
      setSearched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed.");
    } finally {
      setSearching(false);
    }
  }

  function toggle(localId: string) {
    setSelected((set) => {
      const next = new Set(set);
      if (next.has(localId)) next.delete(localId);
      else next.add(localId);
      return next;
    });
    setHighlighted(localId);
  }

  const selectedRows = results.filter((r) => selected.has(r.localId));
  const selectedAcres = selectedRows.reduce(
    (sum, r) => sum + (r.deeded_acres ?? r.gisAcres),
    0
  );

  // Duplicate detection: same normalized parcel number in the same county
  const duplicates = useMemo(() => {
    if (!service) return new Map<string, { id: string; parcel_number: string }>();
    const map = new Map<string, { id: string; parcel_number: string }>();
    const county = service.county.toLowerCase();
    const pool = existingParcels.filter(
      (p) => (p.county ?? "").toLowerCase() === county || !p.county
    );
    for (const row of selectedRows) {
      const norm = normalizeParcelNumber(row.parcel_number);
      const hit = pool.find((p) => normalizeParcelNumber(p.parcel_number) === norm);
      if (hit) map.set(row.localId, hit);
    }
    return map;
  }, [selectedRows, existingParcels, service]);

  async function runImport() {
    if (!service || selectedRows.length === 0) return;
    setImporting(true);
    setError(null);

    // Resolve the target property
    let targetPropertyId = propertyId;
    let createdProperty = false;
    if (assignMode === "new") {
      if (!newPropertyName.trim()) {
        setError("Name the new property.");
        setImporting(false);
        return;
      }
      const { data, error: err } = await supabase
        .from("properties")
        .insert({
          organization_id: orgId,
          name: newPropertyName.trim(),
          county: service.county,
          state: service.state,
        })
        .select("id")
        .single();
      if (err || !data) {
        setError("Could not create the property: " + (err?.message ?? ""));
        setImporting(false);
        return;
      }
      targetPropertyId = data.id;
      createdProperty = true;
    }
    if (!targetPropertyId) {
      setError("Pick a property.");
      setImporting(false);
      return;
    }

    const source = `Imported from ${service.display_name} county records on ${new Date().toISOString().slice(0, 10)}`;
    const failures: string[] = [];
    let firstParcelId: string | null = null;
    let importedCount = 0;

    for (const row of selectedRows) {
      const dup = duplicates.get(row.localId);
      if (dup) {
        const choice = dupChoices[row.localId] ?? "skip";
        if (choice === "skip") continue;
        // Update geometry (and provenance) on the existing parcel
        const { error: gErr } = await supabase.rpc("set_geometry", {
          p_entity_type: "parcel",
          p_entity_id: dup.id,
          p_geojson: row.multiPolygon,
        });
        if (gErr) {
          failures.push(`${row.parcel_number}: ${gErr.message}`);
          continue;
        }
        await supabase
          .from("parcels")
          .update({ deeded_acres: row.deeded_acres, source })
          .eq("id", dup.id);
        firstParcelId = firstParcelId ?? dup.id;
        importedCount++;
        continue;
      }

      const { data, error: err } = await supabase
        .from("parcels")
        .insert({
          organization_id: orgId,
          property_id: targetPropertyId,
          parcel_number: row.parcel_number || "UNKNOWN",
          county: service.county,
          notes: row.owner_name ? `Owner as recorded: ${row.owner_name}` : null,
          deeded_acres: row.deeded_acres,
          source,
        })
        .select("id")
        .single();
      if (err || !data) {
        failures.push(`${row.parcel_number}: ${err?.message ?? "insert failed"}`);
        continue;
      }
      const { error: gErr } = await supabase.rpc("set_geometry", {
        p_entity_type: "parcel",
        p_entity_id: data.id,
        p_geojson: row.multiPolygon,
      });
      if (gErr) failures.push(`${row.parcel_number}: geometry failed (${gErr.message})`);
      firstParcelId = firstParcelId ?? data.id;
      importedCount++;
    }

    // Merged property outline
    if (mergeOutline && importedCount > 0) {
      const { error: mErr } = await supabase.rpc("set_property_boundary_from_parcels", {
        p_property_id: targetPropertyId,
      });
      if (mErr) failures.push("Property outline: " + mErr.message);
    }

    setImporting(false);
    if (failures.length > 0) {
      setError(
        `Imported ${importedCount}; some problems: ${failures.slice(0, 3).join("; ")}`
      );
      return;
    }
    if (importedCount === 0) {
      setError("Nothing imported (all selected parcels were skipped duplicates).");
      return;
    }
    const focus =
      mergeOutline || createdProperty
        ? `property:${targetPropertyId}`
        : `parcel:${firstParcelId}`;
    router.push(`/map?focus=${focus}`);
  }

  const mapFeatures = results.map((r) => ({
    localId: r.localId,
    geometry: r.geometry,
    selected: selected.has(r.localId),
  }));

  if (services.length === 0) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
        <h1 className="text-xl font-semibold text-gray-900">
          Import from county records
        </h1>
        <p className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-600">
          No county services are set up yet. Tell us which county your land is
          in and we will add its public parcel service. In the meantime, the{" "}
          <Link href="/import" className="font-medium text-kelly-700 hover:underline">
            file upload import
          </Link>{" "}
          works with GeoJSON, KML, KMZ, and shapefiles.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <div>
        <Link href="/import" className="text-sm text-gray-500 hover:underline">
          &larr; Import
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-gray-900">
          Import from county records
        </h1>
        <p className="mt-0.5 text-sm text-gray-600">
          Search your county{"'"}s public parcel records and import real
          boundaries in minutes. County not listed? Tell us and we will add it.
        </p>
      </div>

      {/* Search bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white p-3">
        <select
          value={serviceId}
          onChange={(e) => {
            setServiceId(e.target.value);
            setResults([]);
            setSearched(false);
            setSelected(new Set());
          }}
          className={inputClass}
        >
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.display_name}
            </option>
          ))}
        </select>
        <div className="flex overflow-hidden rounded-lg border border-gray-300">
          {(
            [
              ["owner", "Owner name"],
              ["parcel", "Parcel number"],
            ] as Array<["owner" | "parcel", string]>
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setSearchType(value)}
              className={
                "px-3 py-2 text-sm font-medium " +
                (searchType === value
                  ? "bg-kelly-500 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50")
              }
            >
              {label}
            </button>
          ))}
        </div>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") search();
          }}
          placeholder={
            searchType === "owner"
              ? "e.g. SMITH or SMITH JOHN (county records are usually LASTNAME FIRSTNAME)"
              : "Parcel number or part of one"
          }
          className={`${inputClass} min-w-52 flex-1`}
        />
        <button
          onClick={search}
          disabled={searching || text.trim().length < 2}
          className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-60"
        >
          {searching ? "Searching..." : "Search"}
        </button>
      </div>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {truncated ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          More than 200 parcels matched; only the first 200 are shown. Narrow
          your search.
        </p>
      ) : null}

      {results.length > 0 ? (
        <>
          <CountySearchMap
            features={mapFeatures}
            highlightedId={highlighted}
            onFeatureClick={toggle}
          />

          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-gray-600">
              {formatNumber(results.length)} parcel{results.length === 1 ? "" : "s"} found
            </span>
            <button
              onClick={() => setSelected(new Set(results.map((r) => r.localId)))}
              className="text-sm font-medium text-kelly-700 hover:underline"
            >
              Select all
            </button>
            <button
              onClick={() => setSelected(new Set())}
              className="text-sm font-medium text-gray-600 hover:underline"
            >
              None
            </button>
            {selected.size > 0 ? (
              <span className="ml-auto text-sm font-medium text-pine-900">
                {formatNumber(selected.size)} selected · {formatAcres(selectedAcres)} acres
              </span>
            ) : null}
          </div>

          <ul className="max-h-80 space-y-1.5 overflow-y-auto">
            {results.map((r) => (
              <li
                key={r.localId}
                onClick={() => setHighlighted(r.localId)}
                className={
                  "flex cursor-pointer flex-wrap items-center gap-2 rounded-lg border bg-white px-3 py-2 " +
                  (highlighted === r.localId
                    ? "border-kelly-500 ring-1 ring-kelly-100"
                    : "border-gray-200")
                }
              >
                <input
                  type="checkbox"
                  checked={selected.has(r.localId)}
                  onChange={() => toggle(r.localId)}
                  onClick={(e) => e.stopPropagation()}
                  className="h-4 w-4 accent-kelly-500"
                />
                <span className="font-medium text-gray-900">{r.parcel_number}</span>
                <span className="text-sm text-gray-500">{r.owner_name}</span>
                <span className="ml-auto text-sm text-gray-500">
                  {formatAcres(r.deeded_acres ?? r.gisAcres)} ac
                  {r.situs ? ` · ${r.situs}` : ""}
                </span>
              </li>
            ))}
          </ul>

          {/* Assign + import */}
          {selected.size > 0 ? (
            <div className="space-y-3 rounded-xl border border-kelly-100 bg-kelly-50 p-4">
              <h2 className="text-base font-semibold text-pine-900">
                Import {formatNumber(selected.size)} parcel
                {selected.size === 1 ? "" : "s"} ({formatAcres(selectedAcres)} acres)
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex overflow-hidden rounded-lg border border-gray-300 bg-white">
                  {properties.length > 0 ? (
                    <button
                      onClick={() => setAssignMode("existing")}
                      className={
                        "px-3 py-2 text-sm font-medium " +
                        (assignMode === "existing"
                          ? "bg-kelly-500 text-white"
                          : "text-gray-600")
                      }
                    >
                      Existing property
                    </button>
                  ) : null}
                  <button
                    onClick={() => setAssignMode("new")}
                    className={
                      "px-3 py-2 text-sm font-medium " +
                      (assignMode === "new" ? "bg-kelly-500 text-white" : "text-gray-600")
                    }
                  >
                    New property
                  </button>
                </div>
                {assignMode === "existing" ? (
                  <select
                    value={propertyId}
                    onChange={(e) => setPropertyId(e.target.value)}
                    className={`${inputClass} bg-white`}
                  >
                    {properties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={newPropertyName}
                    onChange={(e) => setNewPropertyName(e.target.value)}
                    placeholder={`Property name (county: ${service?.county})`}
                    className={`${inputClass} min-w-56 bg-white`}
                  />
                )}
                <label className="flex items-center gap-1.5 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={mergeOutline}
                    onChange={(e) => setMergeOutline(e.target.checked)}
                    className="h-4 w-4 accent-kelly-500"
                  />
                  Set property boundary to merged outline
                </label>
              </div>

              {duplicates.size > 0 ? (
                <div className="space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-sm font-medium text-amber-900">
                    {duplicates.size} selected parcel
                    {duplicates.size === 1 ? " already exists" : "s already exist"} in
                    your records:
                  </p>
                  {Array.from(duplicates.entries()).map(([localId, existing]) => {
                    const row = results.find((r) => r.localId === localId)!;
                    return (
                      <div key={localId} className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-medium text-gray-900">{row.parcel_number}</span>
                        <span className="text-gray-500">
                          (yours: {existing.parcel_number})
                        </span>
                        <span className="ml-auto flex gap-1.5">
                          {(
                            [
                              ["skip", "Skip"],
                              ["update", "Update geometry"],
                            ] as Array<["skip" | "update", string]>
                          ).map(([choice, label]) => (
                            <button
                              key={choice}
                              onClick={() =>
                                setDupChoices((c) => ({ ...c, [localId]: choice }))
                              }
                              className={
                                "rounded-lg border px-2 py-1 text-xs font-medium " +
                                ((dupChoices[localId] ?? "skip") === choice
                                  ? "border-kelly-500 bg-white text-pine-900"
                                  : "border-gray-300 bg-white text-gray-600")
                              }
                            >
                              {label}
                            </button>
                          ))}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              <button
                onClick={runImport}
                disabled={importing}
                className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-60"
              >
                {importing ? "Importing..." : "Confirm and import"}
              </button>
            </div>
          ) : null}
        </>
      ) : searched && !searching ? (
        <p className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500">
          No parcels matched. County records usually list owners as LASTNAME
          FIRSTNAME in capital letters; try just the last name.
        </p>
      ) : null}
    </div>
  );
}
