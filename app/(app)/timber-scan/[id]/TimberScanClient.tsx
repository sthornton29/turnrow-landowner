"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import mapboxgl, { GeoJSONSource } from "mapbox-gl";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import turfArea from "@turf/area";
import buffer from "@turf/buffer";
import difference from "@turf/difference";
import union from "@turf/union";
import "mapbox-gl/dist/mapbox-gl.css";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";
import { createClient } from "@/lib/supabase/client";
import { formatAcres, formatNumber } from "@/lib/format";
import { bboxOf } from "@/lib/geo/normalize";
import { ACRE_M2, TIMBER_CLASSES, type TimberClass } from "@/lib/timberScan/raster";
import type { ScanProposal, ScanResult } from "@/lib/timberScan/types";
import type { StandType } from "@/types/db";

// DRAFT colors only: these mark unconfirmed proposals over satellite and
// disappear once saved, when stands take the normal timber styling.
const CLASS_COLORS: Record<TimberClass, string> = {
  pine: "#fbbf24", // amber
  hardwood: "#38bdf8", // sky blue
  mixed: "#a78bfa", // violet
  wetland: "#2dd4bf", // teal
};
const CLASS_LABELS: Record<TimberClass, string> = {
  pine: "Pine",
  hardwood: "Hardwood",
  mixed: "Mixed",
  wetland: "Wetland hardwood",
};

interface LocalProposal extends ScanProposal {
  accepted: boolean;
  form: {
    name: string;
    standType: StandType | "";
    species: string;
    yearEstablished: string;
    notes: string;
  };
  aiNote: string | null; // vision assist result text
  aiSuggested: boolean; // stand_type came from the AI (amber highlight)
  edited: boolean; // geometry touched: composition becomes approximate
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const geomAcres = (g: Polygon | MultiPolygon) =>
  round1(turfArea({ type: "Feature", properties: {}, geometry: g }) / ACRE_M2);

function defaultForm(p: ScanProposal, index: number, existingCount: number) {
  const cls = p.dominant ?? p.cls;
  return {
    name: `Stand ${existingCount + index + 1}`,
    // Pine requires the planted/natural choice before saving; hardwood
    // species stays blank rather than guessing.
    standType: (cls === "pine"
      ? ""
      : cls === "mixed"
        ? "mixed"
        : "hardwood") as StandType | "",
    species: cls === "pine" ? "Loblolly pine" : "",
    yearEstablished: "",
    notes: cls === "wetland" ? "Bottomland/wet hardwood" : "",
  };
}

function compositionText(p: ScanProposal): string {
  return p.percents.map((x) => `${x.percent}% ${CLASS_LABELS[x.cls].toLowerCase()}`).join(", ");
}

export default function TimberScanClient({
  orgId,
  property,
  existingStands,
}: {
  orgId: string;
  property: { id: string; name: string; boundary: MultiPolygon };
  existingStands: Array<{ id: string; name: string; boundary: MultiPolygon | null }>;
}) {
  const supabase = useMemo(() => createClient(), []);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  const [scan, setScan] = useState<ScanResult | null>(null);
  const [proposals, setProposals] = useState<LocalProposal[]>([]);
  const [savedStands, setSavedStands] = useState(existingStands);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cachedNote, setCachedNote] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mergePickId, setMergePickId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [splittingId, setSplittingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState<Set<string>>(new Set());

  // ------------------------------------------------------------- scan
  const runScan = useCallback(
    async (force: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/timber-scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ property_id: property.id, force }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "The scan failed.");
        const result = body as ScanResult & { cached: boolean };
        setScan(result);
        setCachedNote(result.cached);
        setProposals(
          result.proposals.map((p, i) => ({
            ...p,
            accepted: false,
            form: defaultForm(p, i, existingStands.length),
            aiNote: null,
            aiSuggested: false,
            edited: false,
          }))
        );
        setSelectedId(null);
        setMergePickId(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "The scan failed.");
      } finally {
        setLoading(false);
      }
    },
    [property.id, existingStands.length]
  );

  useEffect(() => {
    runScan(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------- map
  const splittingRef = useRef<string | null>(null);
  splittingRef.current = splittingId;
  const proposalsRef = useRef<LocalProposal[]>([]);
  proposalsRef.current = proposals;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/satellite-streets-v12",
      center: [-87.0, 34.5],
      zoom: 12,
    });
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right");
    const draw = new MapboxDraw({ displayControlsDefault: false });
    map.addControl(draw);
    drawRef.current = draw;

    map.on("load", () => {
      const empty: FeatureCollection = { type: "FeatureCollection", features: [] };
      map.addSource("property", { type: "geojson", data: empty });
      map.addSource("saved-stands", { type: "geojson", data: empty });
      map.addSource("proposals", { type: "geojson", data: empty });

      map.addLayer({ id: "property-line", type: "line", source: "property",
        paint: { "line-color": "#ffffff", "line-width": 2.5 } });
      // Saved stands take the normal timber styling.
      map.addLayer({ id: "saved-fill", type: "fill", source: "saved-stands",
        paint: { "fill-color": "#14532d", "fill-opacity": 0.35 } });
      map.addLayer({ id: "saved-line", type: "line", source: "saved-stands",
        paint: { "line-color": "#a7f3d0", "line-width": 1.8, "line-dasharray": [3, 2] } });

      const colorExpr: mapboxgl.Expression = [
        "match", ["get", "cls"],
        "pine", CLASS_COLORS.pine,
        "hardwood", CLASS_COLORS.hardwood,
        "mixed", CLASS_COLORS.mixed,
        "wetland", CLASS_COLORS.wetland,
        "#ffffff",
      ];
      map.addLayer({ id: "proposals-fill", type: "fill", source: "proposals",
        paint: {
          "fill-color": colorExpr,
          "fill-opacity": ["case", ["get", "accepted"], 0.4, 0.2],
        } });
      map.addLayer({ id: "proposals-line", type: "line", source: "proposals",
        paint: {
          "line-color": colorExpr,
          "line-width": ["case", ["get", "selected"], 4, 2],
          "line-dasharray": [2, 1.5],
        } });

      setMapLoaded(true);
    });

    map.on("click", (e) => {
      if (splittingRef.current) return; // drawing the split line
      const hits = map.queryRenderedFeatures(e.point, { layers: ["proposals-fill"] });
      if (hits.length > 0) setSelectedId(String(hits[0].properties?.id));
    });

    map.on("draw.create", (e: { features: Feature[] }) => {
      const target = splittingRef.current;
      const line = e.features[0];
      if (target && line?.geometry.type === "LineString") {
        applySplitRef.current(target, line as Feature<GeoJSON.LineString>);
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
      drawRef.current = null;
    };
  }, []);

  // Sync sources
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const setData = (source: string, fcData: FeatureCollection) =>
      (map.getSource(source) as GeoJSONSource)?.setData(fcData);
    setData("property", {
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry: property.boundary }],
    });
    setData("saved-stands", {
      type: "FeatureCollection",
      features: savedStands
        .filter((s) => s.boundary)
        .map((s) => ({ type: "Feature", properties: { name: s.name }, geometry: s.boundary! })),
    });
    setData("proposals", {
      type: "FeatureCollection",
      features: proposals
        .filter((p) => p.id !== editingId)
        .map((p) => ({
          type: "Feature",
          properties: {
            id: p.id,
            cls: p.cls,
            accepted: p.accepted,
            selected: p.id === selectedId,
          },
          geometry: p.geometry,
        })),
    });
  }, [mapLoaded, proposals, savedStands, selectedId, editingId, property.boundary]);

  // Fit once
  const didFitRef = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || didFitRef.current) return;
    const box = bboxOf([property.boundary]);
    if (box) {
      map.fitBounds(box, { padding: 40, duration: 0 });
      didFitRef.current = true;
    }
  }, [mapLoaded, property.boundary]);

  // ------------------------------------------------------------- actions
  function update(id: string, patch: Partial<LocalProposal>) {
    setProposals((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }
  function updateForm(id: string, patch: Partial<LocalProposal["form"]>) {
    setProposals((prev) =>
      prev.map((p) => (p.id === id ? { ...p, form: { ...p.form, ...patch } } : p))
    );
  }

  function removeProposal(id: string) {
    setProposals((prev) => prev.filter((p) => p.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  // Merge two proposals (allowed across classes): union the shapes,
  // blend the composition weighted by acres, re-suggest the dominant.
  function mergeInto(firstId: string, secondId: string) {
    const a = proposals.find((p) => p.id === firstId);
    const b = proposals.find((p) => p.id === secondId);
    if (!a || !b) return;
    const merged = union({
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: {}, geometry: a.geometry },
        { type: "Feature", properties: {}, geometry: b.geometry },
      ],
    });
    if (!merged) return;
    const total = a.acres + b.acres;
    const mix = new Map<TimberClass, number>();
    for (const part of [a, b]) {
      for (const pct of part.percents) {
        mix.set(pct.cls, (mix.get(pct.cls) ?? 0) + (pct.percent * part.acres) / total);
      }
    }
    const percents = Array.from(mix.entries())
      .map(([cls, percent]) => ({ cls, percent: Math.round(percent) }))
      .filter((p) => p.percent > 0)
      .sort((x, y) => y.percent - x.percent);
    const dominant = percents[0]?.cls ?? a.cls;
    setProposals((prev) =>
      prev
        .filter((p) => p.id !== secondId)
        .map((p) =>
          p.id === firstId
            ? {
                ...p,
                geometry: merged.geometry as Polygon | MultiPolygon,
                acres: geomAcres(merged.geometry as Polygon | MultiPolygon),
                percents,
                dominant,
                cls: dominant,
                agOverlapAcres: round1(p.agOverlapAcres + b.agOverlapAcres),
                form: { ...p.form, ...retypeForm(dominant, p.form) },
              }
            : p
        )
    );
    setMergePickId(null);
    setSelectedId(firstId);
  }

  function retypeForm(cls: TimberClass, form: LocalProposal["form"]) {
    if (cls === "pine") {
      return {
        standType: (form.standType === "planted_pine" || form.standType === "natural_pine"
          ? form.standType
          : "") as StandType | "",
        species: form.species || "Loblolly pine",
      };
    }
    return { standType: (cls === "mixed" ? "mixed" : "hardwood") as StandType | "" };
  }

  // Split with a drawn line: subtract a hair-thin buffer of the line,
  // then each remaining part becomes its own proposal (composition
  // percentages inherited; the raster is not re-read client-side).
  const applySplitRef = useRef<(id: string, line: Feature<GeoJSON.LineString>) => void>(
    () => {}
  );
  applySplitRef.current = (id, line) => {
    const target = proposalsRef.current.find((p) => p.id === id);
    drawRef.current?.deleteAll();
    setSplittingId(null);
    if (!target) return;
    const blade = buffer(line, 0.0005, { units: "kilometers" });
    if (!blade) return;
    const remainder = difference({
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: {}, geometry: target.geometry },
        blade,
      ],
    });
    if (!remainder) return;
    const parts: Polygon[] =
      remainder.geometry.type === "Polygon"
        ? [remainder.geometry]
        : remainder.geometry.coordinates.map((c) => ({ type: "Polygon", coordinates: c }));
    if (parts.length < 2) {
      setToast("The line did not cross the whole shape; nothing was split.");
      return;
    }
    setProposals((prev) => {
      const index = prev.findIndex((p) => p.id === id);
      const next = [...prev];
      const pieces = parts.map((geometry, i): LocalProposal => ({
        ...target,
        id: i === 0 ? target.id : crypto.randomUUID(),
        geometry,
        acres: geomAcres(geometry),
        accepted: false,
        edited: true,
        form: {
          ...target.form,
          name: i === 0 ? target.form.name : `${target.form.name} (${i + 1})`,
        },
      }));
      next.splice(index, 1, ...pieces);
      return next;
    });
    setToast("Split into " + parts.length + " proposals.");
  };

  function startSplit(id: string) {
    const draw = drawRef.current;
    if (!draw) return;
    setSplittingId(id);
    setSelectedId(id);
    draw.deleteAll();
    draw.changeMode("draw_line_string");
  }

  function startEdit(id: string) {
    const draw = drawRef.current;
    const target = proposals.find((p) => p.id === id);
    if (!draw || !target) return;
    setEditingId(id);
    setSelectedId(id);
    draw.deleteAll();
    const ids = draw.add({ type: "Feature", properties: {}, geometry: target.geometry });
    draw.changeMode("direct_select", { featureId: ids[0] });
  }

  function finishEdit(save: boolean) {
    const draw = drawRef.current;
    if (!draw || !editingId) return;
    if (save) {
      const features = draw.getAll().features;
      const geometry = features[0]?.geometry as Polygon | MultiPolygon | undefined;
      if (geometry) {
        update(editingId, {
          geometry,
          acres: geomAcres(geometry),
          edited: true,
        });
      }
    }
    draw.deleteAll();
    setEditingId(null);
  }

  // AI assist: planted vs natural for pine proposals only, on demand.
  async function suggestPlantedNatural(ids: string[]) {
    setAiBusy((prev) => new Set([...prev, ...ids]));
    for (const id of ids) {
      const target = proposalsRef.current.find((p) => p.id === id);
      if (!target) continue;
      try {
        const res = await fetch("/api/timber-scan/vision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ geometry: target.geometry }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Suggestion failed.");
        if (body.suggestion === "planted_pine" || body.suggestion === "natural_pine") {
          setProposals((prev) =>
            prev.map((p) =>
              p.id === id
                ? {
                    ...p,
                    aiSuggested: true,
                    aiNote: `AI suggests ${body.suggestion === "planted_pine" ? "planted" : "natural"} (rows ${body.row_pattern_visible}, ${body.confidence} confidence)`,
                    form: { ...p.form, standType: body.suggestion },
                  }
                : p
            )
          );
        } else {
          update(id, { aiNote: "AI could not tell planted from natural here; set it yourself." });
        }
      } catch {
        update(id, { aiNote: "Imagery suggestion failed; set planted or natural yourself." });
      }
    }
    setAiBusy((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  }

  // Save all accepted proposals through the normal insert + set_geometry
  // path; PostGIS computes the real acres as always.
  async function saveAccepted() {
    const ready = proposals.filter((p) => p.accepted);
    for (const p of ready) {
      if (!p.form.name.trim()) {
        setError("Every accepted stand needs a name.");
        return;
      }
      if (!p.form.standType) {
        setError(`Pick planted or natural pine for "${p.form.name}".`);
        return;
      }
    }
    if (ready.length === 0) return;
    setSaving(true);
    setError(null);
    const failures: string[] = [];
    let saved = 0;
    for (const p of ready) {
      const { data, error: err } = await supabase
        .from("timber_stands")
        .insert({
          organization_id: orgId,
          property_id: property.id,
          name: p.form.name.trim(),
          stand_type: p.form.standType,
          species: p.form.species.trim() || null,
          year_established: p.form.yearEstablished
            ? Number(p.form.yearEstablished)
            : null,
          notes: p.form.notes.trim() || null,
        })
        .select("id")
        .single();
      if (err || !data) {
        failures.push(`${p.form.name}: ${err?.message ?? "insert failed"}`);
        continue;
      }
      const { error: gErr } = await supabase.rpc("set_geometry", {
        p_entity_type: "timber_stand",
        p_entity_id: data.id,
        p_geojson: p.geometry,
      });
      if (gErr) {
        failures.push(`${p.form.name}: geometry failed (${gErr.message})`);
        continue;
      }
      saved++;
      setSavedStands((prev) => [
        ...prev,
        { id: data.id, name: p.form.name, boundary: toMulti(p.geometry) },
      ]);
      setProposals((prev) => prev.filter((x) => x.id !== p.id));
    }
    setSaving(false);
    if (failures.length > 0) {
      setError(`Saved ${saved}; problems: ${failures.slice(0, 3).join("; ")}`);
    } else {
      setToast(
        `Saved ${formatNumber(saved)} timber stand${saved === 1 ? "" : "s"} to ${property.name}.`
      );
    }
  }

  // ------------------------------------------------------------- render
  const accepted = proposals.filter((p) => p.accepted);
  const selected = proposals.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <div>
        <Link
          href={`/properties/${property.id}`}
          className="text-sm text-gray-500 hover:underline"
        >
          &larr; {property.name}
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-gray-900">Timber Scan</h1>
        <p className="mt-0.5 text-sm text-gray-600">
          Proposed stand boundaries from USDA land cover, broken out into
          pine, hardwood, and mixed. Correct them on the map, then confirm
          details. Nothing saves until you confirm each stand.
        </p>
      </div>

      {loading ? (
        <p className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-600">
          Scanning {property.name} against the USDA land cover layer. This
          can take 10 to 30 seconds; the government server clips the raster
          on demand.
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {toast ? (
        <p className="flex items-center gap-2 rounded-lg border border-kelly-100 bg-kelly-50 p-3 text-sm font-medium text-pine-900">
          {toast}
          <button
            onClick={() => setToast(null)}
            className="ml-auto rounded-full px-2 text-gray-400 hover:text-gray-700"
          >
            &times;
          </button>
        </p>
      ) : null}

      {scan && !loading ? (
        <>
          {/* Scan summary banner */}
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="text-lg font-semibold text-gray-900">
                {formatAcres(scan.summary.woodedAcres)} wooded acres found
              </span>
              {TIMBER_CLASSES.filter((c) => scan.summary.byClass[c] > 0).map((c) => (
                <span key={c} className="flex items-center gap-1.5 text-sm text-gray-700">
                  <span
                    className="h-3 w-3 rounded-[2px] border border-gray-300"
                    style={{ background: CLASS_COLORS[c] }}
                  />
                  {formatAcres(scan.summary.byClass[c])} {CLASS_LABELS[c].toLowerCase()}
                </span>
              ))}
              <span className="ml-auto flex items-center gap-2 text-xs text-gray-500">
                CDL {scan.year}
                {cachedNote ? " (cached)" : ""}
                <button
                  onClick={() => runScan(true)}
                  className="rounded-lg border border-gray-300 px-2 py-1 font-medium text-gray-700 hover:bg-gray-50"
                >
                  Rescan
                </button>
              </span>
            </div>
            <details className="mt-2 text-xs text-gray-500">
              <summary className="cursor-pointer font-medium">
                What the scan can and cannot see
              </summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                <li>
                  Boundaries and the pine/hardwood breakout come from 30m
                  government land cover: close but not survey-grade; nudge
                  vertices where it matters.
                </li>
                <li>
                  Hardwood drains narrower than about 100 feet can drop below
                  pixel resolution; some will need drawing by hand.
                </li>
                <li>
                  Adjacent stands of the same type merge into one proposal;
                  use Split to separate age classes or management units.
                </li>
                <li>
                  Recent clearcuts and plantings under about 5 years often
                  classify as shrub or grass and may not appear until the
                  canopy develops.
                </li>
                <li>
                  The scan finds where the timber is and the breakout;
                  species, age, and site data are your knowledge to add.
                </li>
              </ul>
            </details>
          </div>

          {/* Map with draft proposals */}
          <div className="relative">
            <div ref={containerRef} className="h-80 w-full rounded-xl md:h-[28rem]" />
            {splittingId ? (
              <div className="absolute inset-x-0 top-2 mx-auto w-fit rounded-lg bg-pine-900/95 px-3 py-2 text-xs text-white shadow-lg">
                Draw a line all the way across the shape, double tap to finish.
                <button
                  onClick={() => {
                    drawRef.current?.deleteAll();
                    setSplittingId(null);
                  }}
                  className="ml-2 rounded bg-white/15 px-2 py-0.5 font-semibold hover:bg-white/25"
                >
                  Cancel
                </button>
              </div>
            ) : null}
            {editingId ? (
              <div className="absolute inset-x-0 top-2 mx-auto w-fit rounded-lg bg-pine-900/95 px-3 py-2 text-xs text-white shadow-lg">
                Drag the points to adjust.
                <button
                  onClick={() => finishEdit(true)}
                  className="ml-2 rounded bg-kelly-500 px-2 py-0.5 font-semibold hover:bg-kelly-600"
                >
                  Save shape
                </button>
                <button
                  onClick={() => finishEdit(false)}
                  className="ml-1.5 rounded bg-white/15 px-2 py-0.5 font-semibold hover:bg-white/25"
                >
                  Cancel
                </button>
              </div>
            ) : null}
          </div>

          {/* Proposal chips */}
          {proposals.length === 0 ? (
            <p className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500">
              No unmapped timber found. Existing stands are excluded from
              proposals, and recent clearcuts may not read as forest yet.
            </p>
          ) : (
            <div className="space-y-2">
              {proposals.map((p) => (
                <div
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className={
                    "cursor-pointer rounded-xl border bg-white p-3 " +
                    (p.id === selectedId
                      ? "border-kelly-500 ring-1 ring-kelly-100"
                      : "border-gray-200")
                  }
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="h-3.5 w-3.5 shrink-0 rounded-[3px] border border-gray-400"
                      style={{ background: CLASS_COLORS[p.cls] }}
                    />
                    <span className="font-medium text-gray-900">
                      {CLASS_LABELS[p.cls]}
                    </span>
                    <span className="text-sm text-pine-900">
                      {formatAcres(p.acres)} ac
                    </span>
                    <span className="text-xs text-gray-500">
                      {compositionText(p)}
                      {p.edited ? " (before edits)" : ""}
                    </span>
                    {p.agOverlapAcres > 1 ? (
                      <span
                        className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
                        title="Usually a young pine planting on former cropland, or a raster edge error. You decide."
                      >
                        Overlaps ag field ({formatAcres(p.agOverlapAcres)} ac)
                      </span>
                    ) : null}
                    <span className="ml-auto flex flex-wrap gap-1.5">
                      {!p.accepted ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            update(p.id, { accepted: true });
                          }}
                          className="rounded-lg bg-kelly-500 px-2.5 py-1 text-xs font-semibold text-white hover:bg-kelly-600"
                        >
                          Accept
                        </button>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            update(p.id, { accepted: false });
                          }}
                          className="rounded-lg border border-kelly-500 bg-kelly-50 px-2.5 py-1 text-xs font-semibold text-pine-900"
                        >
                          Accepted
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (mergePickId === null) setMergePickId(p.id);
                          else if (mergePickId === p.id) setMergePickId(null);
                          else mergeInto(mergePickId, p.id);
                        }}
                        className={
                          "rounded-lg border px-2.5 py-1 text-xs font-medium " +
                          (mergePickId === p.id
                            ? "border-pine-800 bg-pine-800 text-white"
                            : "border-gray-300 text-gray-600 hover:bg-gray-50")
                        }
                      >
                        {mergePickId === p.id
                          ? "Pick the other one..."
                          : mergePickId
                            ? "Merge here"
                            : "Merge"}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          startEdit(p.id);
                        }}
                        className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                      >
                        Edit shape
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          startSplit(p.id);
                        }}
                        className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                      >
                        Split
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeProposal(p.id);
                        }}
                        className="rounded-lg border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                      >
                        Remove
                      </button>
                    </span>
                  </div>

                  {/* Confirm form, once accepted */}
                  {p.accepted ? (
                    <div
                      className="mt-2 grid grid-cols-1 gap-2 border-t border-gray-100 pt-2 sm:grid-cols-2 lg:grid-cols-4"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        value={p.form.name}
                        onChange={(e) => updateForm(p.id, { name: e.target.value })}
                        placeholder="Stand name"
                        className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm"
                      />
                      <div>
                        <select
                          value={p.form.standType}
                          onChange={(e) => {
                            updateForm(p.id, {
                              standType: e.target.value as StandType | "",
                            });
                            update(p.id, { aiSuggested: false });
                          }}
                          className={
                            "w-full rounded-lg border px-2.5 py-1.5 text-sm " +
                            (p.aiSuggested
                              ? "border-amber-400 bg-amber-50"
                              : "border-gray-300")
                          }
                        >
                          {p.cls === "pine" || p.dominant === "pine" ? (
                            <>
                              <option value="">Pine: planted or natural?</option>
                              <option value="planted_pine">Planted pine</option>
                              <option value="natural_pine">Natural pine</option>
                            </>
                          ) : (
                            <>
                              <option value="hardwood">Hardwood</option>
                              <option value="natural_pine">Natural pine</option>
                              <option value="planted_pine">Planted pine</option>
                            </>
                          )}
                          <option value="mixed">Mixed</option>
                          <option value="other">Other</option>
                        </select>
                        {(p.cls === "pine" || p.dominant === "pine") ? (
                          <button
                            onClick={() => suggestPlantedNatural([p.id])}
                            disabled={aiBusy.has(p.id)}
                            className="mt-1 text-xs font-medium text-kelly-700 hover:underline disabled:opacity-60"
                          >
                            {aiBusy.has(p.id)
                              ? "Looking at imagery..."
                              : "Suggest planted vs natural"}
                          </button>
                        ) : null}
                        {p.aiNote ? (
                          <p className="mt-0.5 text-xs text-amber-800">{p.aiNote}</p>
                        ) : null}
                      </div>
                      <input
                        value={p.form.species}
                        onChange={(e) => updateForm(p.id, { species: e.target.value })}
                        placeholder="Primary species"
                        className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm"
                      />
                      <input
                        value={p.form.yearEstablished}
                        onChange={(e) =>
                          updateForm(p.id, { yearEstablished: e.target.value })
                        }
                        type="number"
                        placeholder="Year established"
                        className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm"
                      />
                      <input
                        value={p.form.notes}
                        onChange={(e) => updateForm(p.id, { notes: e.target.value })}
                        placeholder="Notes"
                        className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm sm:col-span-2 lg:col-span-4"
                      />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}

          {/* Save bar */}
          {accepted.length > 0 ? (
            <div className="sticky bottom-16 z-20 flex flex-wrap items-center gap-3 rounded-xl border border-kelly-100 bg-kelly-50 p-3 shadow-md md:bottom-4">
              <span className="text-sm font-medium text-pine-900">
                {formatNumber(accepted.length)} stand
                {accepted.length === 1 ? "" : "s"} ready (
                {formatAcres(accepted.reduce((s, p) => s + p.acres, 0))} acres)
              </span>
              {accepted.some((p) => (p.cls === "pine" || p.dominant === "pine") && !p.form.standType) ? (
                <button
                  onClick={() =>
                    suggestPlantedNatural(
                      accepted
                        .filter(
                          (p) =>
                            (p.cls === "pine" || p.dominant === "pine") &&
                            !p.form.standType &&
                            !aiBusy.has(p.id)
                        )
                        .map((p) => p.id)
                    )
                  }
                  className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Suggest planted vs natural for all pine
                </button>
              ) : null}
              <button
                onClick={saveAccepted}
                disabled={saving}
                className="ml-auto rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-60"
              >
                {saving ? "Saving..." : `Save ${accepted.length} stand${accepted.length === 1 ? "" : "s"}`}
              </button>
            </div>
          ) : null}
          {/* Keep the selected chip reachable for screen readers */}
          {selected ? null : null}
        </>
      ) : null}
    </div>
  );
}

function toMulti(g: Polygon | MultiPolygon): MultiPolygon {
  return g.type === "MultiPolygon"
    ? g
    : { type: "MultiPolygon", coordinates: [g.coordinates] };
}
