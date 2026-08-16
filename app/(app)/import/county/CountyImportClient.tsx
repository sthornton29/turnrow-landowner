"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import { formatAcres, formatNumber } from "@/lib/format";
import { toMultiPolygon } from "@/lib/geo/normalize";
import { normalizeParcelNumber } from "@/lib/tax";
import { clusterOwners, displayOwnerName, pickDisplayName } from "@/lib/ownerNames";
import { ENTITY_TYPE_LABELS, guessEntityType } from "@/lib/entities";
import MiniParcelSketch from "@/components/county/MiniParcelSketch";
import type { CountyGisService, EntityParcelFeature } from "@/lib/gis";
import type { LandEntityType } from "@/types/db";
import type { MultiPolygon } from "geojson";

const CountySearchMap = dynamic(
  () => import("@/components/county/CountySearchMap"),
  { ssr: false }
);

interface ResultRow extends EntityParcelFeature {
  localId: string;
  // null when the county returned no boundary: flagged, not importable.
  multiPolygon: MultiPolygon | null;
}

// Acres preference: the county's deeded figure when it is a real
// positive number, otherwise the geodesic estimate computed by the
// proxy from the boundary. Junk 0.0 attributes (Colbert) never show.
function acresOf(
  r: ResultRow
): { value: number; estimated: boolean } | null {
  if (r.deeded_acres !== null && r.deeded_acres > 0) {
    return { value: r.deeded_acres, estimated: false };
  }
  if (r.computed_acres !== null) {
    return { value: r.computed_acres, estimated: true };
  }
  return null;
}

function acresText(r: ResultRow): string {
  const acres = acresOf(r);
  if (!acres) return "no boundary returned";
  return `${formatAcres(acres.value)} ac${acres.estimated ? " est." : ""}`;
}

interface KnownAlias {
  normalized_alias: string;
  entity_id: string;
  entity_name: string;
}

// Sentinel for the assign step's entity choice. Entities are never
// created automatically: "" means no entity (an existing property keeps
// whatever it has), and ENTITY_NEW opens the explicit create form.
const ENTITY_NEW = "__new__";

// A proposed entity: one owner however the county wrote the name.
// Membership is a list of result-row ids; inclusion in the import is
// derived from the shared `selected` set so map taps, group checkboxes,
// and per-parcel checkboxes all stay in sync.
interface OwnerGroup {
  id: string;
  displayName: string;
  rowIds: string[];
  knownEntity: { id: string; name: string } | null;
}

type SearchMode = "entity" | "owner" | "parcel";

const inputClass = "rounded-lg border border-gray-300 px-3 py-2 text-sm";

export default function CountyImportClient({
  orgId,
  services,
  properties,
  existingParcels,
  knownAliases,
  entities,
}: {
  orgId: string;
  services: CountyGisService[];
  properties: Array<{
    id: string;
    name: string;
    county: string | null;
    entity_id: string | null;
  }>;
  existingParcels: Array<{
    id: string;
    parcel_number: string;
    county: string | null;
    property_id: string;
  }>;
  knownAliases: KnownAlias[];
  entities: Array<{ id: string; name: string }>;
}) {
  const supabase = useMemo(() => createClient(), []);

  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [searchType, setSearchType] = useState<SearchMode>("entity");
  const [text, setText] = useState("");
  const [results, setResults] = useState<ResultRow[]>([]);
  const [groups, setGroups] = useState<OwnerGroup[]>([]);
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [mergePick, setMergePick] = useState<Set<string>>(new Set());
  const [truncated, setTruncated] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Importing is a loop: results stay cached between batches, and these
  // track what THIS session already imported (badges, duplicate pool,
  // the success toast, and the Done button's map target).
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());
  const [sessionParcels, setSessionParcels] = useState<
    Array<{ id: string; parcel_number: string; county: string | null; property_id: string }>
  >([]);
  const [importedPropertyIds, setImportedPropertyIds] = useState<Set<string>>(
    new Set()
  );
  const [toast, setToast] = useState<{ message: string; focus: string } | null>(
    null
  );

  // Properties and entities created during this session join the pickers
  // without a server round trip.
  const [localProperties, setLocalProperties] = useState(properties);
  const [localEntities, setLocalEntities] = useState(entities);

  // Assignment
  const [assignMode, setAssignMode] = useState<"existing" | "new">(
    properties.length > 0 ? "existing" : "new"
  );
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? "");
  const [newPropertyName, setNewPropertyName] = useState("");
  const [importEntityId, setImportEntityId] = useState("");
  const entityTouchedRef = useRef(false);
  const [newEntityName, setNewEntityName] = useState("");
  const [newEntityType, setNewEntityType] = useState<LandEntityType>("llc");
  const [newEntityNotes, setNewEntityNotes] = useState("");
  const [mergeOutline, setMergeOutline] = useState(true);
  const [dupChoices, setDupChoices] = useState<Record<string, "skip" | "update">>({});
  const [importing, setImporting] = useState(false);

  const service = services.find((s) => s.id === serviceId) ?? null;
  const rowById = useMemo(
    () => new Map(results.map((r) => [r.localId, r])),
    [results]
  );

  function clearResults() {
    setResults([]);
    setGroups([]);
    setExpandedGroupId(null);
    setMergePick(new Set());
    setSearched(false);
    setSelected(new Set());
    setHighlighted(null);
    setTruncated(false);
    setToast(null);
    // Imported badges are keyed to the current results; the session
    // duplicate pool and Done button survive across searches.
    setImportedIds(new Set());
  }

  async function search() {
    if (!service) return;
    setSearching(true);
    setError(null);
    setSelected(new Set());
    setHighlighted(null);
    setExpandedGroupId(null);
    setMergePick(new Set());
    setGroups([]);
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
      for (const f of body.features as EntityParcelFeature[]) {
        rows.push({
          ...f,
          owner_normalized: f.owner_normalized ?? "",
          owner_stripped: f.owner_stripped ?? [],
          localId: crypto.randomUUID(),
          multiPolygon: f.geometry ? toMultiPolygon(f.geometry) : null,
        });
      }
      setResults(rows);
      setTruncated(Boolean(body.truncated));
      setSearched(true);
      if (searchType === "entity") {
        const aliasMap = new Map(
          knownAliases.map((a) => [a.normalized_alias, a.entity_id])
        );
        const entityNames = new Map(
          knownAliases.map((a) => [a.entity_id, a.entity_name])
        );
        const clusters = clusterOwners(
          rows.map((r) => ({
            id: r.localId,
            ownerName: r.owner_name,
            normalized: r.owner_normalized,
            acres: acresOf(r)?.value ?? 0,
          })),
          aliasMap
        );
        setGroups(
          clusters.map((c) => ({
            id: crypto.randomUUID(),
            displayName:
              (c.knownEntityId ? entityNames.get(c.knownEntityId) : null) ||
              c.displayName ||
              "Owner not recorded",
            rowIds: c.recordIds,
            knownEntity: c.knownEntityId
              ? {
                  id: c.knownEntityId,
                  name: entityNames.get(c.knownEntityId) ?? "",
                }
              : null,
          }))
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed.");
    } finally {
      setSearching(false);
    }
  }

  function toggle(localId: string) {
    // Rows without a boundary, or already imported this session, cannot
    // be selected for import.
    const row = rowById.get(localId);
    if (row && (!row.multiPolygon || importedIds.has(localId))) {
      setHighlighted(localId);
      return;
    }
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
    (sum, r) => sum + (acresOf(r)?.value ?? 0),
    0
  );
  const selectedHasEstimates = selectedRows.some((r) => acresOf(r)?.estimated);

  // ---------------------------------------------------------------------
  // Owner group helpers (entity mode)
  // ---------------------------------------------------------------------

  function groupRows(group: OwnerGroup): ResultRow[] {
    return group.rowIds
      .map((id) => rowById.get(id))
      .filter((r): r is ResultRow => Boolean(r));
  }

  function groupAcres(group: OwnerGroup): number {
    return groupRows(group).reduce((sum, r) => sum + (acresOf(r)?.value ?? 0), 0);
  }

  function groupHasEstimates(group: OwnerGroup): boolean {
    return groupRows(group).some((r) => acresOf(r)?.estimated);
  }

  function groupSelectedCount(group: OwnerGroup): number {
    return group.rowIds.filter((id) => selected.has(id)).length;
  }

  function groupVariants(group: OwnerGroup): Array<{ name: string; count: number }> {
    const counts = new Map<string, number>();
    for (const row of groupRows(group)) {
      counts.set(row.owner_name, (counts.get(row.owner_name) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }

  function toggleGroup(group: OwnerGroup) {
    const include = groupSelectedCount(group) === 0;
    const next = new Set(selected);
    for (const id of group.rowIds) {
      // Only rows with a boundary, not yet imported, are importable.
      if (include && rowById.get(id)?.multiPolygon && !importedIds.has(id)) {
        next.add(id);
      } else if (!include) next.delete(id);
    }
    setSelected(next);
    // Known entity (confirmed aliases): suggest that EXISTING entity in
    // the picker. Never preselect creation, and never override a choice
    // the user already made.
    if (include && group.knownEntity && !entityTouchedRef.current) {
      setImportEntityId(group.knownEntity.id);
    } else if (!include && !entityTouchedRef.current && next.size === 0) {
      setImportEntityId("");
    }
  }

  // A variant that is not the same owner splits out into its own group.
  function removeVariant(group: OwnerGroup, variant: string) {
    const moving = group.rowIds.filter((id) => rowById.get(id)?.owner_name === variant);
    if (moving.length === 0 || moving.length === group.rowIds.length) return;
    const remaining = group.rowIds.filter((id) => !moving.includes(id));
    const remainingVariants = Array.from(
      new Set(remaining.map((id) => rowById.get(id)?.owner_name ?? ""))
    );
    const split: OwnerGroup = {
      id: crypto.randomUUID(),
      displayName: variant || "Owner not recorded",
      rowIds: moving,
      knownEntity: null,
    };
    setGroups((gs) =>
      gs.flatMap((g) =>
        g.id === group.id
          ? [
              {
                ...g,
                rowIds: remaining,
                displayName: g.knownEntity
                  ? g.displayName
                  : pickDisplayName(remainingVariants) || g.displayName,
              },
              split,
            ]
          : [g]
      )
    );
  }

  function toggleMergePick(groupId: string) {
    setMergePick((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  function mergeGroups() {
    const picked = groups.filter((g) => mergePick.has(g.id));
    if (picked.length < 2) return;
    const rowIds = picked.flatMap((g) => g.rowIds);
    const variants = Array.from(
      new Set(rowIds.map((id) => rowById.get(id)?.owner_name ?? ""))
    );
    const known = picked.find((g) => g.knownEntity)?.knownEntity ?? null;
    const merged: OwnerGroup = {
      id: crypto.randomUUID(),
      displayName: known?.name || pickDisplayName(variants) || picked[0].displayName,
      rowIds,
      knownEntity: known,
    };
    // If any merged group was included, include the whole merged owner.
    if (picked.some((g) => groupSelectedCount(g) > 0)) {
      const next = new Set(selected);
      for (const id of rowIds) next.add(id);
      setSelected(next);
    }
    setGroups((gs) => [merged, ...gs.filter((g) => !mergePick.has(g.id))]);
    setMergePick(new Set());
    setExpandedGroupId(null);
  }

  const sortedGroups = useMemo(
    () => [...groups].sort((a, b) => groupAcres(b) - groupAcres(a)),
    // groupAcres depends only on rowById, which derives from results.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, rowById]
  );

  // ---------------------------------------------------------------------
  // Duplicates and import
  // ---------------------------------------------------------------------

  // Duplicate detection: same normalized parcel number in the same
  // county, against parcels that existed at page load PLUS parcels
  // imported earlier in this session (so a later search still flags
  // them; the current results mark them with the Imported badge instead).
  const duplicates = useMemo(() => {
    if (!service) return new Map<string, { id: string; parcel_number: string }>();
    const map = new Map<string, { id: string; parcel_number: string }>();
    const county = service.county.toLowerCase();
    const pool = [...existingParcels, ...sessionParcels].filter(
      (p) => (p.county ?? "").toLowerCase() === county || !p.county
    );
    for (const row of selectedRows) {
      const norm = normalizeParcelNumber(row.parcel_number);
      const hit = pool.find((p) => normalizeParcelNumber(p.parcel_number) === norm);
      if (hit) map.set(row.localId, hit);
    }
    return map;
  }, [selectedRows, existingParcels, sessionParcels, service]);

  // Result rows already in the user's records, for the map's "already
  // imported" tint: imported this session, or matching a parcel that
  // existed before the session (normalized parcel number, same county).
  const alreadyImported = useMemo(() => {
    const set = new Set<string>();
    if (!service) return set;
    const county = service.county.toLowerCase();
    const normPool = new Set(
      [...existingParcels, ...sessionParcels]
        .filter((p) => (p.county ?? "").toLowerCase() === county || !p.county)
        .map((p) => normalizeParcelNumber(p.parcel_number))
    );
    for (const r of results) {
      if (
        importedIds.has(r.localId) ||
        (r.parcel_number && normPool.has(normalizeParcelNumber(r.parcel_number)))
      ) {
        set.add(r.localId);
      }
    }
    return set;
  }, [results, existingParcels, sessionParcels, importedIds, service]);

  // When the user imports with an entity SELECTED, remember the imported
  // groups' confirmed name variants as aliases of that entity so future
  // searches pre-group under it. Entities are never created here: the
  // only creation path is the explicit create form in the assign step.
  async function saveAliasesForImport(entityId: string, failures: string[]) {
    if (!service) return;
    const importedGroups = groups.filter((g) =>
      g.rowIds.some((id) => selected.has(id))
    );
    // One alias per normalized form; keep the most complete verbatim.
    const byNormalized = new Map<string, string>();
    for (const group of importedGroups) {
      for (const row of groupRows(group)) {
        if (!selected.has(row.localId) || row.owner_name.length === 0) continue;
        const current = byNormalized.get(row.owner_normalized);
        if (!current || row.owner_name.length > current.length) {
          byNormalized.set(row.owner_normalized, row.owner_name);
        }
      }
    }
    if (byNormalized.size === 0) return;
    const aliasRows = Array.from(byNormalized.entries()).map(
      ([normalized, verbatim]) => ({
        organization_id: orgId,
        entity_id: entityId,
        alias: verbatim,
        normalized_alias: normalized,
        source_county: service.county,
        source_state: service.state,
      })
    );
    const { error: aliasErr } = await supabase
      .from("entity_aliases")
      .upsert(aliasRows, {
        onConflict: "organization_id,normalized_alias",
        ignoreDuplicates: true,
      });
    if (aliasErr) failures.push("Owner aliases: " + aliasErr.message);
  }

  async function runImport() {
    if (!service || selectedRows.length === 0) return;
    setImporting(true);
    setError(null);

    // Resolve the entity choice. The ONLY way an entity is created here
    // is the explicit create form; null means assign nothing (and an
    // existing property keeps whatever entity it already has).
    let chosenEntityId: string | null = null;
    if (importEntityId === ENTITY_NEW) {
      if (!newEntityName.trim()) {
        setError("Name the new entity.");
        setImporting(false);
        return;
      }
      const { data, error: err } = await supabase
        .from("entities")
        .insert({
          organization_id: orgId,
          name: newEntityName.trim(),
          entity_type: newEntityType,
          notes: newEntityNotes.trim() || null,
        })
        .select("id, name")
        .single();
      if (err || !data) {
        setError("Could not create the entity: " + (err?.message ?? ""));
        setImporting(false);
        return;
      }
      chosenEntityId = data.id;
      setLocalEntities((list) =>
        [...list, { id: data.id, name: data.name }].sort((a, b) =>
          a.name.localeCompare(b.name)
        )
      );
    } else if (importEntityId !== "") {
      chosenEntityId = importEntityId;
    }

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
          entity_id: chosenEntityId,
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
    let importedCount = 0;
    const importedNow: string[] = [];
    const newSessionParcels: typeof sessionParcels = [];

    // Selection already blocks boundary-less rows; this narrows the type.
    const importRows = selectedRows.filter(
      (r): r is ResultRow & { multiPolygon: MultiPolygon } =>
        r.multiPolygon !== null
    );
    for (const row of importRows) {
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
        importedCount++;
        importedNow.push(row.localId);
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
      importedCount++;
      importedNow.push(row.localId);
      newSessionParcels.push({
        id: data.id,
        parcel_number: row.parcel_number || "UNKNOWN",
        county: service.county,
        property_id: targetPropertyId,
      });
    }

    // Merged property outline
    if (mergeOutline && importedCount > 0) {
      const { error: mErr } = await supabase.rpc("set_property_boundary_from_parcels", {
        p_property_id: targetPropertyId,
      });
      if (mErr) failures.push("Property outline: " + mErr.message);
    }

    if (chosenEntityId && importedCount > 0) {
      // Assign the chosen entity to the target property (never clears an
      // existing assignment; No entity means leave things alone).
      const { error: entErr } = await supabase
        .from("properties")
        .update({ entity_id: chosenEntityId })
        .eq("id", targetPropertyId);
      if (entErr) failures.push("Property entity: " + entErr.message);
      // Remember the imported groups' spellings as aliases of that entity.
      if (searchType === "entity") {
        await saveAliasesForImport(chosenEntityId, failures);
      }
    }

    setImporting(false);

    // Importing is a loop: record what happened, mark the rows, and
    // reset the batch state so the next selection starts clean. No
    // navigation; the cached results stay put.
    const acresNow = importedNow.reduce((sum, id) => {
      const r = rowById.get(id);
      return sum + (r ? (acresOf(r)?.value ?? 0) : 0);
    }, 0);
    const propName = createdProperty
      ? newPropertyName.trim()
      : (localProperties.find((p) => p.id === targetPropertyId)?.name ??
        "the property");

    if (importedNow.length > 0) {
      setImportedIds((prev) => new Set([...prev, ...importedNow]));
      setSessionParcels((prev) => [...prev, ...newSessionParcels]);
      setImportedPropertyIds((prev) => new Set(prev).add(targetPropertyId));
      if (createdProperty) {
        setLocalProperties((list) =>
          [
            ...list,
            {
              id: targetPropertyId,
              name: propName,
              county: service.county,
              entity_id: chosenEntityId,
            },
          ].sort((a, b) => a.name.localeCompare(b.name))
        );
        setAssignMode("existing");
        setPropertyId(targetPropertyId);
      } else if (chosenEntityId) {
        setLocalProperties((list) =>
          list.map((p) =>
            p.id === targetPropertyId ? { ...p, entity_id: chosenEntityId } : p
          )
        );
      }
      setSelected(new Set());
      setDupChoices({});
      setNewPropertyName("");
      setImportEntityId("");
      setNewEntityName("");
      setNewEntityNotes("");
      entityTouchedRef.current = false;
    }

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
    setToast({
      message: createdProperty
        ? `Property "${propName}" created with ${formatNumber(importedCount)} parcel${importedCount === 1 ? "" : "s"}, ${formatAcres(acresNow)} acres`
        : `${formatNumber(importedCount)} parcel${importedCount === 1 ? "" : "s"} added to ${propName}, ${formatAcres(acresNow)} acres`,
      focus: `property:${targetPropertyId}`,
    });
  }

  const mapFeatures = results
    .filter((r) => r.geometry !== null)
    .map((r) => ({
      localId: r.localId,
      geometry: r.geometry!,
      selected: selected.has(r.localId),
      imported: alreadyImported.has(r.localId),
      label: r.parcel_number,
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

  // Shared assign-and-import panel (identical in both modes).
  const assignPanel =
    selected.size > 0 ? (
      <div className="space-y-3 rounded-xl border border-kelly-100 bg-kelly-50 p-4">
        <h2
          className="text-base font-semibold text-pine-900"
          title={
            selectedHasEstimates
              ? "Some acres estimated from parcel boundaries"
              : undefined
          }
        >
          Import {formatNumber(selected.size)} parcel
          {selected.size === 1 ? "" : "s"} ({formatAcres(selectedAcres)} acres
          {selectedHasEstimates ? " incl. estimates" : ""})
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-gray-300 bg-white">
            {localProperties.length > 0 ? (
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
              {localProperties.map((p) => (
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

        {/* Which entity holds this property. Suggest only: a known owner
            preselects its EXISTING entity; creation is always explicit. */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-gray-700">Held by entity:</span>
            <select
              value={importEntityId}
              onChange={(e) => {
                entityTouchedRef.current = true;
                const value = e.target.value;
                setImportEntityId(value);
                if (value === ENTITY_NEW && !newEntityName.trim()) {
                  // Prefill from the grouped owner name, cleaned up for
                  // humans; purely a starting point to edit.
                  const checkedGroup = groups.find(
                    (g) => groupSelectedCount(g) > 0
                  );
                  if (checkedGroup) {
                    const prefill = displayOwnerName(checkedGroup.displayName);
                    setNewEntityName(prefill);
                    setNewEntityType(guessEntityType(prefill));
                  }
                }
              }}
              className={`${inputClass} bg-white`}
            >
              <option value="">
                {assignMode === "existing"
                  ? "No entity (keep property's current)"
                  : "No entity"}
              </option>
              {localEntities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.name}
                </option>
              ))}
              <option value={ENTITY_NEW}>Create new entity...</option>
            </select>
          </div>
          {importEntityId === ENTITY_NEW ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={newEntityName}
                onChange={(e) => setNewEntityName(e.target.value)}
                placeholder="Entity name"
                className={`${inputClass} min-w-44 bg-white`}
              />
              <select
                value={newEntityType}
                onChange={(e) => setNewEntityType(e.target.value as LandEntityType)}
                className={`${inputClass} bg-white`}
              >
                {Object.entries(ENTITY_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <input
                value={newEntityNotes}
                onChange={(e) => setNewEntityNotes(e.target.value)}
                placeholder="Notes (optional)"
                className={`${inputClass} min-w-44 flex-1 bg-white`}
              />
            </div>
          ) : null}
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
    ) : null;

  // Appears once anything has been imported this session. The map focus
  // takes one entity, so a single touched property zooms to it; several
  // open the map fitted to everything.
  const doneButton =
    importedPropertyIds.size > 0 ? (
      <Link
        href={
          importedPropertyIds.size === 1
            ? `/map?focus=property:${Array.from(importedPropertyIds)[0]}`
            : "/map"
        }
        className="rounded-lg border border-kelly-500 bg-white px-3 py-1.5 text-sm font-medium text-kelly-700 hover:bg-kelly-50"
      >
        Done, view on map
      </Link>
    ) : null;

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
      <div className="space-y-2 rounded-xl border border-gray-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={serviceId}
            onChange={(e) => {
              setServiceId(e.target.value);
              clearResults();
            }}
            className={inputClass}
          >
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.display_name}
              </option>
            ))}
          </select>
          <div className="flex w-full overflow-hidden rounded-lg border border-gray-300 sm:w-auto">
            {(
              [
                ["entity", "All parcels for an owner"],
                ["owner", "Owner name"],
                ["parcel", "Parcel number"],
              ] as Array<[SearchMode, string]>
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => {
                  setSearchType(value);
                  clearResults();
                }}
                className={
                  "flex-1 px-3 py-2 text-sm font-medium sm:flex-none " +
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
              searchType === "entity"
                ? "Owner or company name, e.g. THORNTON STUART or ALBEMARLE CORP"
                : searchType === "owner"
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
        {searchType === "entity" ? (
          <p className="text-xs text-gray-500">
            The best way to start: finds every way the county wrote a name
            (THORNTON STUART, THORNTON S R ETUX, THORNTON STUART & WIFE...) and
            groups the parcels by owner. You review the grouping before
            importing.
          </p>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {toast ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-kelly-100 bg-kelly-50 p-3 text-sm">
          <span className="font-medium text-pine-900">{toast.message}</span>
          <Link
            href={`/map?focus=${toast.focus}`}
            className="font-medium text-kelly-700 hover:underline"
          >
            View on map
          </Link>
          <button
            onClick={() => setToast(null)}
            aria-label="Dismiss"
            className="ml-auto rounded-full px-2 text-gray-400 hover:bg-kelly-100 hover:text-gray-700"
          >
            &times;
          </button>
        </div>
      ) : null}
      {truncated ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          More than 200 parcels matched; only the first 200 are shown. Narrow
          your search.
        </p>
      ) : null}

      {searchType === "entity" && results.length > 0 ? (
        <>
          {/* Owner group cards */}
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-gray-600">
              {formatNumber(sortedGroups.length)} owner
              {sortedGroups.length === 1 ? "" : "s"} found across{" "}
              {formatNumber(results.length)} parcel
              {results.length === 1 ? "" : "s"}
            </span>
            {doneButton}
            {mergePick.size > 0 ? (
              <span className="ml-auto flex items-center gap-2">
                {mergePick.size >= 2 ? (
                  <button
                    onClick={mergeGroups}
                    className="rounded-lg bg-pine-800 px-3 py-1.5 text-sm font-semibold text-white hover:bg-pine-900"
                  >
                    Merge {mergePick.size} groups
                  </button>
                ) : (
                  <span className="text-sm text-gray-500">
                    Pick another group to merge
                  </span>
                )}
                <button
                  onClick={() => setMergePick(new Set())}
                  className="text-sm font-medium text-gray-600 hover:underline"
                >
                  Cancel
                </button>
              </span>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {sortedGroups.map((group) => {
              const rows = groupRows(group);
              const variants = groupVariants(group);
              const selectedCount = groupSelectedCount(group);
              const importedCount = group.rowIds.filter((id) =>
                importedIds.has(id)
              ).length;
              const fullyImported =
                rows.length > 0 && importedCount === rows.length;
              const expanded = expandedGroupId === group.id;
              const picked = mergePick.has(group.id);
              return (
                <div
                  key={group.id}
                  className={
                    "space-y-2 rounded-xl border bg-white p-3 " +
                    (picked
                      ? "border-pine-800 ring-1 ring-pine-800"
                      : selectedCount > 0
                        ? "border-kelly-500 ring-1 ring-kelly-100"
                        : "border-gray-200")
                  }
                >
                  <div className="flex gap-3">
                    <div className="w-28 shrink-0">
                      <MiniParcelSketch
                        shapes={rows
                          .map((r) => r.multiPolygon)
                          .filter((mp): mp is MultiPolygon => mp !== null)}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-semibold text-gray-900">
                          {group.displayName}
                        </span>
                        {group.knownEntity ? (
                          <span className="rounded-full bg-kelly-100 px-2 py-0.5 text-xs font-medium text-kelly-700">
                            Known entity
                          </span>
                        ) : null}
                        {fullyImported ? (
                          <span className="rounded-full bg-pine-800 px-2 py-0.5 text-xs font-medium text-white">
                            Imported
                          </span>
                        ) : null}
                      </div>
                      <p
                        className="text-sm text-gray-600"
                        title={
                          groupHasEstimates(group)
                            ? "Some acres estimated from parcel boundaries"
                            : undefined
                        }
                      >
                        {formatNumber(rows.length)} parcel
                        {rows.length === 1 ? "" : "s"} ·{" "}
                        {formatAcres(groupAcres(group))} acres
                        {groupHasEstimates(group) ? " incl. est." : ""}
                        {importedCount > 0 && !fullyImported
                          ? ` · ${formatNumber(importedCount)} imported`
                          : ""}
                        {selectedCount > 0 && selectedCount < rows.length
                          ? ` · ${formatNumber(selectedCount)} of ${formatNumber(rows.length)} included`
                          : ""}
                      </p>
                      <button
                        onClick={() => setExpandedGroupId(expanded ? null : group.id)}
                        className="mt-1 rounded-full border border-gray-300 px-2.5 py-0.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                      >
                        {formatNumber(variants.length)} name variant
                        {variants.length === 1 ? "" : "s"} {expanded ? "▴" : "▾"}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
                      <input
                        type="checkbox"
                        checked={selectedCount > 0}
                        onChange={() => toggleGroup(group)}
                        disabled={fullyImported}
                        className="h-4 w-4 accent-kelly-500"
                      />
                      {fullyImported ? "Imported" : "Include in import"}
                    </label>
                    <button
                      onClick={() => toggleMergePick(group.id)}
                      className={
                        "ml-auto rounded-lg border px-2.5 py-1 text-xs font-medium " +
                        (picked
                          ? "border-pine-800 bg-pine-800 text-white"
                          : "border-gray-300 text-gray-600 hover:bg-gray-50")
                      }
                    >
                      {picked ? "Picked to merge" : "Merge"}
                    </button>
                  </div>

                  {expanded ? (
                    <div className="space-y-2 border-t border-gray-100 pt-2">
                      <ul className="space-y-1">
                        {variants.map((variant) => (
                          <li
                            key={variant.name || "(blank)"}
                            className="flex items-center gap-2 text-sm"
                          >
                            <span className="min-w-0 flex-1 truncate text-gray-800">
                              {variant.name || "(no owner recorded)"}
                            </span>
                            <span className="text-gray-500">
                              {formatNumber(variant.count)} parcel
                              {variant.count === 1 ? "" : "s"}
                            </span>
                            {variants.length > 1 ? (
                              <button
                                onClick={() => removeVariant(group, variant.name)}
                                className="rounded-lg border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                              >
                                Not this owner
                              </button>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                      <ul className="max-h-48 space-y-1 overflow-y-auto">
                        {rows.map((r) => (
                          <li
                            key={r.localId}
                            onClick={() => setHighlighted(r.localId)}
                            className={
                              "flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 text-sm " +
                              (highlighted === r.localId
                                ? "border-kelly-500 ring-1 ring-kelly-100"
                                : "border-gray-200")
                            }
                          >
                            {importedIds.has(r.localId) ? (
                              <span className="rounded-full bg-pine-800 px-1.5 py-0.5 text-[10px] font-medium text-white">
                                Imported
                              </span>
                            ) : (
                              <input
                                type="checkbox"
                                checked={selected.has(r.localId)}
                                onChange={() => toggle(r.localId)}
                                onClick={(e) => e.stopPropagation()}
                                disabled={!r.multiPolygon}
                                className="h-4 w-4 accent-kelly-500"
                              />
                            )}
                            <span className="font-medium text-gray-900">
                              {r.parcel_number}
                            </span>
                            {r.owner_stripped.length > 0 ? (
                              <span className="text-xs text-gray-400">
                                {r.owner_stripped.join(", ")}
                              </span>
                            ) : null}
                            <span
                              className={
                                "ml-auto " +
                                (acresOf(r)
                                  ? "text-gray-500"
                                  : "text-xs text-amber-700")
                              }
                              title={
                                acresOf(r)?.estimated
                                  ? "Estimated from parcel boundary"
                                  : undefined
                              }
                            >
                              {acresText(r)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          <CountySearchMap
            features={mapFeatures}
            highlightedId={highlighted}
            onFeatureClick={toggle}
          />
          <p className="text-xs text-gray-500">
            Tap a parcel on the map to include or exclude it from the import.
          </p>

          {assignPanel}
        </>
      ) : results.length > 0 ? (
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
              onClick={() =>
                setSelected(
                  new Set(
                    results
                      .filter((r) => r.multiPolygon && !importedIds.has(r.localId))
                      .map((r) => r.localId)
                  )
                )
              }
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
            {doneButton}
            {selected.size > 0 ? (
              <span
                className="ml-auto text-sm font-medium text-pine-900"
                title={
                  selectedHasEstimates
                    ? "Some acres estimated from parcel boundaries"
                    : undefined
                }
              >
                {formatNumber(selected.size)} selected · {formatAcres(selectedAcres)} acres
                {selectedHasEstimates ? " incl. estimates" : ""}
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
                {importedIds.has(r.localId) ? (
                  <span className="rounded-full bg-pine-800 px-1.5 py-0.5 text-[10px] font-medium text-white">
                    Imported
                  </span>
                ) : (
                  <input
                    type="checkbox"
                    checked={selected.has(r.localId)}
                    onChange={() => toggle(r.localId)}
                    onClick={(e) => e.stopPropagation()}
                    disabled={!r.multiPolygon}
                    className="h-4 w-4 accent-kelly-500"
                  />
                )}
                <span className="font-medium text-gray-900">{r.parcel_number}</span>
                <span className="text-sm text-gray-500">{r.owner_name}</span>
                <span
                  className={
                    "ml-auto text-sm " +
                    (acresOf(r) ? "text-gray-500" : "text-amber-700")
                  }
                  title={
                    acresOf(r)?.estimated
                      ? "Estimated from parcel boundary"
                      : undefined
                  }
                >
                  {acresText(r)}
                  {r.situs ? ` · ${r.situs}` : ""}
                </span>
              </li>
            ))}
          </ul>

          {assignPanel}
        </>
      ) : searched && !searching ? (
        <p className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500">
          {searchType === "entity"
            ? "No parcels matched that owner in this county. Check the spelling of the last name or company word, or try the plain owner name search."
            : "No parcels matched. County records usually list owners as LASTNAME FIRSTNAME in capital letters; try just the last name."}
        </p>
      ) : null}
    </div>
  );
}
