"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Geometry, MultiPolygon, Polygon } from "geojson";
import { createClient } from "@/lib/supabase/client";
import { formatAcres, formatNumber } from "@/lib/format";
import { displayTitle } from "@/lib/documentTitle";
import {
  parseBearing,
  traverse,
  toGeoJSON,
  formatClosure,
  type Call,
  type Unit,
} from "@/lib/geo/traverse";
import {
  parseAliquot,
  resolveDescription,
  type AliquotPart,
  type AliquotToken,
} from "@/lib/geo/aliquot";
import { MERIDIANS } from "@/lib/plss";
import { meridiansForCounty } from "@/lib/plssMeridians";
import { countyMatches } from "@/lib/countyLookup";
import { approxAcres, toMultiPolygon } from "@/lib/geo/normalize";
import {
  ALIQUOT_TOKENS,
  PLOT_DISTANCE_WARN_MILES,
  centroidOf,
  chainLargestFirst,
  closureGrade,
  cornerLabel,
  nearestBoundary,
  nearestVertices,
  partsToText,
  tokenLabel,
  unionAll,
} from "@/lib/geo/plotPreview";
import type { PlssCandidate } from "@/lib/plss";
import type { DocumentRow, ParcelGeo, PropertyGeo } from "@/types/db";
import PlotMap from "@/components/documents/plot/PlotMap";

// ---------------------------------------------------------------- types

type DescKind = "aliquot" | "metes_bounds" | "mixed" | "unknown";

interface Tract {
  description: string;
  section: string;
  township_num: string;
  township_dir: "N" | "S" | "";
  range_num: string;
  range_dir: "E" | "W" | "";
  meridian: string;
  aliquot_text: string;
  exceptions: string[];
  // resolution state
  candidates?: PlssCandidate[];
  chosenKey?: string | null;
  polygon?: MultiPolygon | null;
  acres?: number;
  notes?: string[];
  error?: string | null;
  loading?: boolean;
  // Diagnostics and sanity gates (set after a resolution)
  resolution?: {
    meridian: string;
    meridianKey: string | null;
    meridianName: string | null;
    source: "stated" | "county" | "alternate";
    certain: boolean;
    service: string;
    cached: boolean;
  } | null;
  gateCounty?: string | null; // county the resolved section actually sits in
  gateOk?: boolean | null; // null = not checked / unknown
  gateChecking?: boolean;
  distanceMi?: number | null; // to the nearest existing boundary
  nearestName?: string | null;
  needMeridian?: boolean;
}

interface CallRow {
  id: string;
  bearing_text: string;
  distance: string;
  unit: Unit;
  isCurve: boolean;
  direction: "left" | "right";
  radius: string;
  arc_length: string;
  chord_bearing: string;
  chord_length: string;
  delta: string;
  note: string;
}

interface Extraction {
  kind: DescKind;
  source_text: string | null;
  aliquot: {
    tracts: Array<{
      description: string | null;
      section: number | string | null;
      township_num: number | string | null;
      township_dir: string | null;
      range_num: number | string | null;
      range_dir: string | null;
      meridian: string | null;
      aliquot_text: string | null;
      exceptions: string[] | null;
    }>;
  } | null;
  metes_bounds: {
    pob_description: string | null;
    basis_of_bearing: string | null;
    calls: Array<{
      seq: number | null;
      bearing_text: string | null;
      distance: number | null;
      unit: string | null;
      curve: {
        direction: string | null;
        radius: number | null;
        arc_length: number | null;
        chord_bearing: string | null;
        chord_length: number | null;
        delta: number | null;
      } | null;
      note: string | null;
    }>;
  } | null;
  unsure_fields: string[];
}

type TargetMode = "new_property" | "new_parcel" | "replace_property" | "replace_parcel";

const UNITS: Unit[] = ["feet", "chains", "poles", "links", "varas", "meters", "yards"];

const inputClass =
  "w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:border-kelly-500 focus:outline-none";
const amberClass =
  "w-full rounded-lg border border-amber-400 bg-amber-50 px-2.5 py-1.5 text-sm ring-2 ring-amber-100 focus:outline-none";

function newCallRow(partial: Partial<CallRow> = {}): CallRow {
  return {
    id: crypto.randomUUID(),
    bearing_text: "",
    distance: "",
    unit: "feet",
    isCurve: false,
    direction: "right",
    radius: "",
    arc_length: "",
    chord_bearing: "",
    chord_length: "",
    delta: "",
    note: "",
    ...partial,
  };
}

function asUnit(u: string | null | undefined): Unit {
  const s = (u ?? "feet").toLowerCase();
  if (s.startsWith("chain")) return "chains";
  if (s.startsWith("pole") || s.startsWith("rod") || s.startsWith("perch")) return "poles";
  if (s.startsWith("link")) return "links";
  if (s.startsWith("vara")) return "varas";
  if (s.startsWith("meter") || s === "m") return "meters";
  if (s.startsWith("yard")) return "yards";
  return "feet";
}

function rowsToCalls(rows: CallRow[]): { calls: Call[]; bad: number } {
  const calls: Call[] = [];
  let bad = 0;
  for (const r of rows) {
    const d = Number(r.distance);
    const hasBearing = parseBearing(r.bearing_text) !== null;
    if (r.isCurve) {
      const chordB = r.chord_bearing.trim();
      const call: Call = {
        bearing: hasBearing ? r.bearing_text : chordB || 0,
        distance: Number.isFinite(d) && d > 0 ? d : Number(r.chord_length) || 0,
        unit: r.unit,
        curve: {
          direction: r.direction,
          radius: r.radius ? Number(r.radius) : undefined,
          arcLength: r.arc_length ? Number(r.arc_length) : undefined,
          chordBearing: chordB || undefined,
          chordLength: r.chord_length ? Number(r.chord_length) : undefined,
          delta: r.delta ? Number(r.delta) : undefined,
        },
      };
      calls.push(call);
      continue;
    }
    if (!hasBearing || !(d > 0)) {
      bad++;
      continue;
    }
    calls.push({ bearing: r.bearing_text, distance: d, unit: r.unit });
  }
  return { calls, bad };
}

// ---------------------------------------------------------------- component

export default function PlotClient({
  orgId,
  document: doc,
  properties,
  parcels,
}: {
  orgId: string;
  document: DocumentRow;
  properties: PropertyGeo[];
  parcels: ParcelGeo[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const stored = (doc.extracted ?? {}) as Record<string, unknown>;
  const storedExtraction = stored.legal_description_extraction as Extraction | undefined;
  const storedLegalText =
    typeof stored.legal_description === "string" ? (stored.legal_description as string) : null;

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1 state
  const [kind, setKind] = useState<DescKind>(storedExtraction?.kind ?? "unknown");
  const [sourceText, setSourceText] = useState(
    storedExtraction?.source_text ?? storedLegalText ?? ""
  );
  const [unsure, setUnsure] = useState<string[]>(storedExtraction?.unsure_fields ?? []);
  const [tracts, setTracts] = useState<Tract[]>([]);
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [pobDescription, setPobDescription] = useState("");
  const [basisOfBearing, setBasisOfBearing] = useState("");
  const [hasExtraction, setHasExtraction] = useState(!!storedExtraction);

  // Step 2 state (metes and bounds)
  const [forceClose, setForceClose] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [pob, setPob] = useState<[number, number] | null>(null);
  const [defaultState, setDefaultState] = useState(
    (properties.find((p) => p.state)?.state ?? "AL").toUpperCase().slice(0, 2)
  );
  // The county the deed states: it pins the principal meridian and is
  // the reference for the county gate after resolution.
  const [deedCounty, setDeedCounty] = useState<string>(
    countyFromText(storedExtraction?.source_text ?? storedLegalText ?? "") ??
      properties.find((p) => p.county)?.county ??
      ""
  );
  const [pobCounty, setPobCounty] = useState<string | null>(null);
  const meridianPlan = meridiansForCounty(defaultState, deedCounty);
  const meridianOptions = (meridianPlan.stateMeridians.length > 0
    ? meridianPlan.stateMeridians
    : Object.keys(MERIDIANS)
  ).filter((k) => MERIDIANS[k]);

  // Target
  const [targetMode, setTargetMode] = useState<TargetMode>("new_property");
  // The target starts on the document's OWN property (or its parcel's
  // property), never the first name in the list: an alphabetical
  // default once pointed a Courtland deed at a property near Trinity,
  // so the preview map stretched miles east to fit both. With no
  // attachment the target stays empty until a tract resolves, then
  // follows the nearest boundary unless the user has picked one.
  const attachedParcel = doc.entity_type === "parcel" ? parcels.find((p) => p.id === doc.entity_id) ?? null : null;
  const attachedPropertyId =
    doc.entity_type === "property"
      ? doc.entity_id
      : (attachedParcel?.property_id ?? null);
  const [targetPropertyId, setTargetPropertyId] = useState(
    attachedPropertyId && properties.some((p) => p.id === attachedPropertyId) ? attachedPropertyId : ""
  );
  const [targetParcelId, setTargetParcelId] = useState(attachedParcel?.id ?? "");
  const [targetTouched, setTargetTouched] = useState(!!attachedPropertyId);
  const [newName, setNewName] = useState("");
  const [newCounty, setNewCounty] = useState("");
  const [newState, setNewState] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedLink, setSavedLink] = useState<string | null>(null);

  useEffect(() => {
    if (storedExtraction) applyExtraction(storedExtraction);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyExtraction(x: Extraction) {
    setKind(x.kind ?? "unknown");
    setSourceText(x.source_text ?? storedLegalText ?? "");
    const c = countyFromText(x.source_text ?? "");
    if (c) setDeedCounty(c);
    setUnsure(x.unsure_fields ?? []);
    setTracts(
      (x.aliquot?.tracts ?? []).map((t) => ({
        description: t.description ?? "",
        section: t.section == null ? "" : String(t.section),
        township_num: t.township_num == null ? "" : String(t.township_num),
        township_dir: (t.township_dir ?? "").toUpperCase().startsWith("N")
          ? "N"
          : (t.township_dir ?? "").toUpperCase().startsWith("S")
            ? "S"
            : "",
        range_num: t.range_num == null ? "" : String(t.range_num),
        range_dir: (t.range_dir ?? "").toUpperCase().startsWith("E")
          ? "E"
          : (t.range_dir ?? "").toUpperCase().startsWith("W")
            ? "W"
            : "",
        meridian: t.meridian ?? "",
        aliquot_text: t.aliquot_text ?? t.description ?? "",
        exceptions: t.exceptions ?? [],
      }))
    );
    const mb = x.metes_bounds;
    setPobDescription(mb?.pob_description ?? "");
    setBasisOfBearing(mb?.basis_of_bearing ?? "");
    setCalls(
      (mb?.calls ?? [])
        .slice()
        .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
        .map((c) =>
          newCallRow({
            bearing_text: c.bearing_text ?? "",
            distance: c.distance == null ? "" : String(c.distance),
            unit: asUnit(c.unit),
            isCurve: !!c.curve,
            direction: (c.curve?.direction ?? "right").toLowerCase().startsWith("l")
              ? "left"
              : "right",
            radius: c.curve?.radius == null ? "" : String(c.curve.radius),
            arc_length: c.curve?.arc_length == null ? "" : String(c.curve.arc_length),
            chord_bearing: c.curve?.chord_bearing ?? "",
            chord_length: c.curve?.chord_length == null ? "" : String(c.curve.chord_length),
            delta: c.curve?.delta == null ? "" : String(c.curve.delta),
            note: c.note ?? "",
          })
        )
    );
    setHasExtraction(true);
  }

  async function runExtraction() {
    setExtracting(true);
    setError(null);
    try {
      const { data: signed, error: sErr } = await supabase.storage
        .from("documents")
        .createSignedUrl(doc.storage_path, 300);
      if (sErr || !signed?.signedUrl) throw new Error("Could not open the file.");
      const blob = await (await fetch(signed.signedUrl)).blob();
      const file = new File([blob], doc.file_name, {
        type: doc.content_type ?? blob.type,
      });
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", "legal_description");
      const res = await fetch("/api/extract", { method: "POST", body: fd });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Extraction failed.");
      const x = body.extraction as Extraction;
      applyExtraction(x);
      // Keep the raw extraction on the document so re-opening this page
      // does not re-spend an extraction; the review edits live in state.
      await supabase
        .from("documents")
        .update({ extracted: { ...stored, legal_description_extraction: x } })
        .eq("id", doc.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extraction failed.");
    } finally {
      setExtracting(false);
    }
  }

  // ---------------------------------------------------------- aliquot path

  async function resolveTract(i: number, chosenKey?: string, override: Partial<Tract> = {}) {
    const t = { ...tracts[i], ...override };
    if (Object.keys(override).length > 0) patchTract(i, { ...override, candidates: undefined, polygon: null });
    const tn = Number(t.township_num);
    const rn = Number(t.range_num);
    const sec = Number(t.section);
    if (!(tn > 0) || !(rn > 0) || !(sec > 0) || !t.township_dir || !t.range_dir) {
      patchTract(i, { error: "Section, township, and range are all needed." });
      return;
    }
    if (!t.meridian && !meridianPlan.primary) {
      patchTract(i, {
        error: deedCounty
          ? `The meridian for ${deedCounty} County is not on file. Pick the principal meridian.`
          : "Enter the deed's county (it decides the principal meridian) or pick the meridian.",
        needMeridian: true,
      });
      return;
    }
    patchTract(i, { loading: true, error: null, needMeridian: false, gateOk: null, gateCounty: null });
    try {
      let candidates = override.candidates === undefined && Object.keys(override).length === 0 ? t.candidates : undefined;
      let resolution: Tract["resolution"] = t.resolution ?? null;
      if (!candidates || candidates.length === 0) {
        const res = await fetch("/api/plss", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            state: defaultState,
            township: { num: tn, dir: t.township_dir },
            range: { num: rn, dir: t.range_dir },
            section: sec,
            meridian: t.meridian || undefined,
            county: deedCounty || undefined,
          }),
        });
        const body = await res.json();
        if (res.status === 422 && body.needMeridian) {
          patchTract(i, { loading: false, error: body.error, needMeridian: true });
          return;
        }
        if (!res.ok) throw new Error(body.error ?? "PLSS lookup failed.");
        candidates = body.candidates as PlssCandidate[];
        resolution = body.resolution ?? null;
        if (!candidates || candidates.length === 0) {
          patchTract(i, {
            loading: false,
            candidates: [],
            resolution: null,
            error: body.error ?? "No section found for that township and range. Check the numbers and directions.",
          });
          return;
        }
      }
      const key =
        chosenKey ?? (candidates.length === 1 ? candidates[0].key : (t.chosenKey ?? null));
      if (!key) {
        patchTract(i, { loading: false, candidates, resolution, chosenKey: null, polygon: null });
        return;
      }
      const cand = candidates.find((c) => c.key === key) ?? candidates[0];
      const sectionPoly: Polygon | null =
        cand.polygon.type === "Polygon"
          ? cand.polygon
          : { type: "Polygon", coordinates: cand.polygon.coordinates[0] };
      if (!sectionPoly) throw new Error("Section polygon was empty.");
      const parsed = parseAliquot(
        `${t.aliquot_text} Section ${sec}, T${tn}${t.township_dir} R${rn}${t.range_dir}` +
          (t.exceptions.length > 0 ? ` less and except ${t.exceptions.join("; ")}` : "")
      );
      const resolved = resolveDescription(parsed, sectionPoly);
      const notes = [...resolved.notes];
      if (parsed.parts.length === 0 && parsed.lots.length === 0) {
        notes.push(
          "No aliquot parts were recognized; the whole section is shown. Add parts with the chips (for example SE1/4, then NW1/4 of it)."
        );
      }
      if (cand.polygon.type === "MultiPolygon" && cand.polygon.coordinates.length > 1) {
        notes.push("The section polygon had several parts; the largest was used.");
      }
      const polygon =
        resolved.polygon ?? (parsed.parts.length === 0 ? toMultiPolygon(sectionPoly) : null);
      // Distance gate (client-side, instant).
      const center = centroidOf(polygon ?? sectionPoly);
      const near = center
        ? nearestBoundary(
            center,
            properties.map((p) => ({ name: p.name, geometry: p.boundary_geojson }))
          )
        : null;
      if (near && !targetTouched) {
        const nearId = properties.find((p) => p.name === near.name)?.id;
        if (nearId) setTargetPropertyId(nearId);
      }
      patchTract(i, {
        loading: false,
        candidates,
        chosenKey: key,
        resolution,
        polygon,
        acres: resolved.polygon ? resolved.acres : approxAcres(toMultiPolygon(sectionPoly)!),
        notes,
        error: null,
        distanceMi: near?.miles ?? null,
        nearestName: near?.name ?? null,
        gateChecking: !!center,
        gateCounty: null,
        gateOk: null,
      });
      // County gate (server lookup): the resolved section must sit in
      // the county the deed states.
      if (center) {
        try {
          const res = await fetch("/api/county-lookup", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ lon: center[0], lat: center[1] }),
          });
          const body = await res.json();
          const county: string | null = body?.county?.county ?? null;
          patchTract(i, {
            gateChecking: false,
            gateCounty: county,
            gateOk: county ? countyMatches(deedCounty, county) : null,
          });
        } catch {
          patchTract(i, { gateChecking: false, gateCounty: null, gateOk: null });
        }
      }
    } catch (e) {
      patchTract(i, {
        loading: false,
        error: e instanceof Error ? e.message : "Could not resolve this tract.",
      });
    }
  }

  // One-tap retries when the county gate fails: the plausible misreads.
  function retryOptions(t: Tract): Array<{ label: string; patch: Partial<Tract> }> {
    const out: Array<{ label: string; patch: Partial<Tract> }> = [];
    if (t.township_dir) {
      const flip = t.township_dir === "N" ? "S" : "N";
      out.push({ label: `Try T${t.township_num}${flip}`, patch: { township_dir: flip } });
    }
    if (t.range_dir) {
      const flip = t.range_dir === "E" ? "W" : "E";
      out.push({ label: `Try R${t.range_num}${flip}`, patch: { range_dir: flip } });
    }
    const current = t.resolution?.meridianKey ?? t.meridian ?? meridianPlan.primary;
    for (const k of meridianOptions) {
      if (k !== current) out.push({ label: `Try ${MERIDIANS[k].name} meridian`, patch: { meridian: k } });
    }
    return out;
  }

  function diagnosticLine(t: Tract): string | null {
    if (!t.polygon || !t.resolution) return null;
    const r = t.resolution;
    const mer = `${r.meridianName ?? `meridian ${r.meridian}`} PM (${
      r.source === "stated" ? "as entered" : r.source === "county" ? `from ${deedCounty || "county"} County` : `alternate for ${deedCounty || "county"} County`
    })`;
    const gate =
      t.gateChecking
        ? "county check running"
        : t.gateOk === true
          ? `county check passed (${t.gateCounty})`
          : t.gateOk === false
            ? `COUNTY MISMATCH: resolved to ${t.gateCounty}, deed says ${deedCounty}`
            : "county check unavailable";
    const dist =
      t.distanceMi != null && t.nearestName
        ? `${formatNumber(t.distanceMi)} mi from ${t.nearestName}`
        : "no existing boundaries to compare";
    return `Resolved: ${mer}, T${t.township_num}${t.township_dir} R${t.range_num}${t.range_dir}, Sec ${t.section}, ${r.service}${r.cached ? " (cached)" : ""}, ${gate}, ${dist}.`;
  }

  function patchTract(i: number, patch: Partial<Tract>) {
    setTracts((ts) => ts.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  }

  const aliquotPolygon = useMemo(
    () => unionAll(tracts.map((t) => t.polygon ?? null)),
    [tracts]
  );

  // ------------------------------------------------------ metes and bounds

  const { calls: parsedCalls, bad: badCalls } = useMemo(() => rowsToCalls(calls), [calls]);
  const trav = useMemo(
    () => (parsedCalls.length >= 2 ? traverse(parsedCalls, { forceClose }) : null),
    [parsedCalls, forceClose]
  );
  const mbPolygon = useMemo<MultiPolygon | null>(() => {
    if (!trav || !pob || trav.points.length < 3) return null;
    return toMultiPolygon(toGeoJSON(trav.points, pob, rotation));
  }, [trav, pob, rotation]);

  const useAliquot = kind === "aliquot" || kind === "mixed";
  const plotted: MultiPolygon | null = useAliquot ? aliquotPolygon : mbPolygon;
  const plottedAcres = plotted ? approxAcres(plotted) : null;

  // ------------------------------------------------------------- target

  const targetProperty = properties.find((p) => p.id === targetPropertyId) ?? null;
  const targetParcel = parcels.find((p) => p.id === targetParcelId) ?? null;
  const existingGeometry: Geometry | null =
    targetMode === "replace_property"
      ? (targetProperty?.boundary_geojson ?? null)
      : targetMode === "replace_parcel"
        ? (targetParcel?.boundary_geojson ?? null)
        : targetMode === "new_parcel"
          ? (targetProperty?.boundary_geojson ?? null)
          : null;
  const currentAcres =
    targetMode === "replace_property"
      ? (targetProperty?.acres ?? null)
      : targetMode === "replace_parcel"
        ? (targetParcel?.acres ?? null)
        : null;
  const deededAcres = targetMode === "replace_parcel" ? (targetParcel?.deeded_acres ?? null) : null;
  // "containing 120 acres, more or less": when the description states an
  // acreage and the plot is far from it (a creek-bounded portion plotted
  // as the whole section, a misread quarter), say so plainly.
  const statedAcres = useMemo(() => {
    const m = sourceText.match(/containing\s+([\d,]+(?:\.\d+)?)\s+acres?/i);
    if (!m) return null;
    const n = Number(m[1].replace(/,/g, ""));
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [sourceText]);
  const acresGap =
    statedAcres !== null && plottedAcres !== null && Math.abs(plottedAcres - statedAcres) / statedAcres > 0.25
      ? { stated: statedAcres, plotted: plottedAcres }
      : null;
  // A target that sits miles from the plotted tract is almost always the
  // wrong pick; say so and name the nearest boundary instead.
  const targetDistance = useMemo(() => {
    if (!plotted || !existingGeometry) return null;
    const c = centroidOf(plotted);
    if (!c) return null;
    const toTarget = nearestBoundary(c, [{ name: "target", geometry: existingGeometry }]);
    if (!toTarget || toTarget.miles < 2) return null;
    const nearest = nearestBoundary(
      c,
      properties.map((p) => ({ name: p.name, geometry: p.boundary_geojson }))
    );
    return { miles: toTarget.miles, nearest: nearest && nearest.miles < toTarget.miles ? nearest.name : null };
  }, [plotted, existingGeometry, properties]);

  // POB helpers: start at the chosen property's centroid.
  const referenceGeometry: Geometry | null =
    existingGeometry ?? targetProperty?.boundary_geojson ?? null;
  useEffect(() => {
    if (pob || useAliquot) return;
    const c = centroidOf(referenceGeometry);
    if (c) setPob(c);
  }, [referenceGeometry, pob, useAliquot]);
  // County under the point of beginning, beside the deed's county.
  useEffect(() => {
    if (!pob || useAliquot) return;
    const [lon, lat] = pob;
    const handle = setTimeout(async () => {
      try {
        const res = await fetch("/api/county-lookup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ lon, lat }),
        });
        const body = await res.json();
        setPobCounty(body?.county?.county ?? null);
      } catch {
        setPobCounty(null);
      }
    }, 600);
    return () => clearTimeout(handle);
  }, [pob, useAliquot]);
  const refCentroid = centroidOf(referenceGeometry);
  const cornerPicks = refCentroid
    ? nearestVertices(referenceGeometry, pob ?? refCentroid, 6)
    : [];

  async function save() {
    if (!plotted) return;
    setSaving(true);
    setError(null);
    try {
      let entityType: "property" | "parcel";
      let entityId: string;
      if (targetMode === "new_property") {
        if (!newName.trim()) throw new Error("Give the new property a name.");
        const { data, error: iErr } = await supabase
          .from("properties")
          .insert({
            organization_id: orgId,
            name: newName.trim(),
            county: newCounty.trim() || null,
            state: newState.trim() || null,
          })
          .select("id")
          .single();
        if (iErr || !data) throw new Error(iErr?.message ?? "Could not create the property.");
        entityType = "property";
        entityId = data.id;
      } else if (targetMode === "new_parcel") {
        if (!targetPropertyId) throw new Error("Pick the property this parcel belongs to.");
        if (!newName.trim()) throw new Error("Enter the parcel number.");
        const { data, error: iErr } = await supabase
          .from("parcels")
          .insert({
            organization_id: orgId,
            property_id: targetPropertyId,
            parcel_number: newName.trim(),
            county: newCounty.trim() || null,
          })
          .select("id")
          .single();
        if (iErr || !data) throw new Error(iErr?.message ?? "Could not create the parcel.");
        entityType = "parcel";
        entityId = data.id;
      } else if (targetMode === "replace_property") {
        if (!targetProperty) throw new Error("Pick the property to replace.");
        if (
          !window.confirm(
            `Replace the boundary of "${targetProperty.name}" (currently ${formatAcres(targetProperty.acres)} acres) with the plotted ${formatAcres(plottedAcres)} acres? The old boundary is not kept.`
          )
        ) {
          setSaving(false);
          return;
        }
        entityType = "property";
        entityId = targetProperty.id;
      } else {
        if (!targetParcel) throw new Error("Pick the parcel to replace.");
        if (
          !window.confirm(
            `Replace the boundary of parcel ${targetParcel.parcel_number} (currently ${formatAcres(targetParcel.acres)} acres) with the plotted ${formatAcres(plottedAcres)} acres? The old boundary is not kept.`
          )
        ) {
          setSaving(false);
          return;
        }
        entityType = "parcel";
        entityId = targetParcel.id;
      }
      const { error: gErr } = await supabase.rpc("set_geometry", {
        p_entity_type: entityType,
        p_entity_id: entityId,
        p_geojson: plotted,
      });
      if (gErr) throw new Error("Boundary save failed: " + gErr.message);
      const plotRecord = {
        kind,
        closure: trav
          ? { distance_ft: trav.closureDistanceFt, ratio: trav.closureRatio, adjusted: trav.adjusted }
          : null,
        rotation: useAliquot ? null : rotation,
        pob: useAliquot ? null : pob,
        plotted_acres: plottedAcres,
        deed_county: deedCounty || null,
        state: defaultState,
        tracts: useAliquot
          ? tracts.map((t) => ({
              section: t.section,
              township: `${t.township_num}${t.township_dir}`,
              range: `${t.range_num}${t.range_dir}`,
              meridian: t.resolution?.meridianKey ?? t.meridian ?? null,
              meridian_source: t.resolution?.source ?? null,
              aliquot: t.aliquot_text,
              resolved_county: t.gateCounty ?? null,
              county_gate: t.gateOk ?? null,
              distance_mi: t.distanceMi ?? null,
              nearest: t.nearestName ?? null,
              diagnostic: diagnosticLine(t),
            }))
          : null,
        pob_county: useAliquot ? null : pobCounty,
        saved_at: new Date().toISOString(),
        target: { entity_type: entityType, entity_id: entityId, mode: targetMode },
      };
      const { error: dErr } = await supabase
        .from("documents")
        .update({
          produced_boundary_type: entityType,
          produced_boundary_id: entityId,
          extracted: { ...stored, legal_description_plot: plotRecord },
        })
        .eq("id", doc.id);
      if (dErr) throw new Error("Saved the boundary but could not link the document: " + dErr.message);
      setSavedLink(`/map?focus=${entityType}:${entityId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  // ---------------------------------------------------------------- UI

  const amber = (key: string) => (unsure.includes(key) ? amberClass : inputClass);
  const grade = trav ? closureGrade(trav.closureRatio) : null;
  const gradeClass =
    grade === "good" || grade === "closed"
      ? "border-kelly-500 bg-kelly-50 text-pine-900"
      : grade === "fair"
        ? "border-amber-400 bg-amber-50 text-amber-900"
        : "border-red-400 bg-red-50 text-red-800";

  const canContinueFrom1 =
    hasExtraction &&
    ((useAliquot && tracts.length > 0) || (!useAliquot && calls.length >= 3));
  const gateFailed = useAliquot && tracts.some((t) => t.polygon && t.gateOk === false);
  const canContinueFrom2 = !!plotted && !gateFailed;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <p className="flex flex-wrap items-center gap-1 text-sm text-gray-500">
        <Link href="/documents" className="hover:underline">Documents</Link>
        <span>/</span>
        <Link href={`/documents/${doc.id}`} className="truncate hover:underline">{displayTitle(doc)}</Link>
      </p>
      <h1 className="text-2xl font-semibold text-gray-900">Plot boundary from this document</h1>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        <p className="font-semibold">What to expect</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          <li>Plot quality follows description quality: a vague or misread call moves the whole figure.</li>
          <li>Closure error is shown, never hidden. Forcing closure redistributes the error; it does not make the description right.</li>
          <li>Aliquot parts assume regular sections. Government lots and irregular sections are approximations; check them against the plat.</li>
          <li>When county records and county GIS agree, the county import is the faster and more exact path.</li>
        </ul>
      </div>

      {/* Stepper */}
      <ol className="flex flex-wrap gap-2 text-xs font-medium">
        {[
          [1, "Review the description"],
          [2, useAliquot ? "Resolve sections" : "Traverse and place"],
          [3, "Preview and save"],
        ].map(([n, label]) => (
          <li
            key={String(n)}
            className={
              "rounded-full px-3 py-1 " +
              (step === n
                ? "bg-kelly-500 text-white"
                : step > Number(n)
                  ? "bg-kelly-100 text-pine-900"
                  : "bg-gray-100 text-gray-500")
            }
          >
            {n}. {label}
          </li>
        ))}
      </ol>

      {error ? <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p> : null}

      {/* ---------------------------------------------------- Step 1 */}
      {step === 1 ? (
        <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Legal description</h2>
              <p className="text-xs text-gray-500">
                AI reads the description; you check every field before it is used. Amber fields were uncertain.
              </p>
            </div>
            <button
              onClick={runExtraction}
              disabled={extracting}
              className="rounded-lg bg-kelly-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-60"
            >
              {extracting
                ? "Reading the document..."
                : hasExtraction
                  ? "Re-read the document"
                  : "Read the document"}
            </button>
          </div>

          {hasExtraction ? (
            <>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Description type</label>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  {(
                    [
                      ["aliquot", "PLSS aliquot"],
                      ["metes_bounds", "Metes and bounds"],
                      ["mixed", "Mixed (use aliquot)"],
                      ["unknown", "Unknown"],
                    ] as Array<[DescKind, string]>
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setKind(k)}
                      className={
                        "rounded-lg border px-2 py-1.5 text-xs font-medium " +
                        (kind === k
                          ? "border-kelly-500 bg-kelly-50 text-pine-900"
                          : "border-gray-300 text-gray-600 hover:bg-gray-50") +
                        (unsure.includes("kind") ? " ring-2 ring-amber-100" : "")
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Description text (verbatim)
                </label>
                <textarea
                  value={sourceText}
                  onChange={(e) => setSourceText(e.target.value)}
                  rows={4}
                  className={amber("source_text")}
                />
              </div>

              {useAliquot ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2 sm:grid-cols-3">
                    <label className="text-xs font-medium text-gray-700">
                      State
                      <input
                        value={defaultState}
                        onChange={(e) => setDefaultState(e.target.value.toUpperCase().slice(0, 2))}
                        className={inputClass}
                      />
                    </label>
                    <label className="text-xs font-medium text-gray-700 sm:col-span-2">
                      County the deed states
                      <input
                        value={deedCounty}
                        onChange={(e) => setDeedCounty(e.target.value)}
                        placeholder="e.g. Lawrence"
                        className={inputClass}
                      />
                      <span className="mt-0.5 block text-[11px] font-normal text-gray-500">
                        {meridianPlan.primary
                          ? `Principal meridian from the county: ${MERIDIANS[meridianPlan.primary].name}${
                              meridianPlan.alternates.length > 0
                                ? ` (survey line crosses this county; also tries ${meridianPlan.alternates
                                    .map((k) => MERIDIANS[k]?.name ?? k)
                                    .join(", ")})`
                                : ""
                            }. The resolved section is checked against this county.`
                          : deedCounty
                            ? `The meridian for ${deedCounty} County is not on file; pick it per tract.`
                            : "Enter the county: it decides which survey (meridian) the township and range belong to."}
                      </span>
                    </label>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-gray-900">Tracts</h3>
                    <span className="text-xs text-gray-500">Check every field before resolving; nothing is fetched until you do.</span>
                    <button
                      type="button"
                      onClick={() =>
                        setTracts((ts) => [
                          ...ts,
                          {
                            description: "",
                            section: "",
                            township_num: "",
                            township_dir: "",
                            range_num: "",
                            range_dir: "",
                            meridian: "",
                            aliquot_text: "",
                            exceptions: [],
                          },
                        ])
                      }
                      className="rounded-lg border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      + Add tract
                    </button>
                  </div>
                  {tracts.length === 0 ? (
                    <p className="text-sm text-gray-500">No tracts yet. Add one and type its aliquot parts.</p>
                  ) : null}
                  {tracts.map((t, i) => (
                    <div key={i} className="space-y-2 rounded-lg border border-gray-200 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-semibold text-gray-500">Tract {i + 1}</p>
                        <button
                          type="button"
                          onClick={() => setTracts((ts) => ts.filter((_, j) => j !== i))}
                          className="text-xs text-red-600 hover:underline"
                        >
                          Remove
                        </button>
                      </div>
                      <ChainChips
                        text={t.aliquot_text}
                        exceptions={t.exceptions}
                        unsure={unsure.includes("aliquot")}
                        onChange={(aliquot_text, exceptions) =>
                          patchTract(i, { aliquot_text, exceptions, polygon: null })
                        }
                      />
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                        <label className="text-xs text-gray-600">
                          Section
                          <input
                            value={t.section}
                            onChange={(e) => patchTract(i, { section: e.target.value, candidates: undefined, polygon: null })}
                            className={inputClass}
                            inputMode="numeric"
                          />
                        </label>
                        <label className="text-xs text-gray-600">
                          Township
                          <input
                            value={t.township_num}
                            onChange={(e) => patchTract(i, { township_num: e.target.value, candidates: undefined, polygon: null })}
                            className={inputClass}
                            inputMode="numeric"
                          />
                        </label>
                        <label className="text-xs text-gray-600">
                          N/S
                          <select
                            value={t.township_dir}
                            onChange={(e) => patchTract(i, { township_dir: e.target.value as "N" | "S" | "", candidates: undefined, polygon: null })}
                            className={inputClass}
                          >
                            <option value="">?</option>
                            <option value="N">N</option>
                            <option value="S">S</option>
                          </select>
                        </label>
                        <label className="text-xs text-gray-600">
                          Range
                          <input
                            value={t.range_num}
                            onChange={(e) => patchTract(i, { range_num: e.target.value, candidates: undefined, polygon: null })}
                            className={inputClass}
                            inputMode="numeric"
                          />
                        </label>
                        <label className="text-xs text-gray-600">
                          E/W
                          <select
                            value={t.range_dir}
                            onChange={(e) => patchTract(i, { range_dir: e.target.value as "E" | "W" | "", candidates: undefined, polygon: null })}
                            className={inputClass}
                          >
                            <option value="">?</option>
                            <option value="E">E</option>
                            <option value="W">W</option>
                          </select>
                        </label>
                        <label className="text-xs text-gray-600">
                          Meridian
                          <select
                            value={t.meridian}
                            onChange={(e) => patchTract(i, { meridian: e.target.value, candidates: undefined, polygon: null })}
                            className={inputClass}
                          >
                            <option value="">
                              {meridianPlan.primary
                                ? `From county (${MERIDIANS[meridianPlan.primary].name})`
                                : "Pick..."}
                            </option>
                            {meridianOptions.map((k) => (
                              <option key={k} value={k}>
                                {MERIDIANS[k].name}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label className="text-xs font-medium text-gray-700">
                      Point of beginning (as described)
                      <input
                        value={pobDescription}
                        onChange={(e) => setPobDescription(e.target.value)}
                        className={amber("pob_description")}
                      />
                    </label>
                    <label className="text-xs font-medium text-gray-700">
                      Basis of bearing
                      <input
                        value={basisOfBearing}
                        onChange={(e) => setBasisOfBearing(e.target.value)}
                        placeholder="e.g. magnetic 1962, grid, deed"
                        className={amber("basis_of_bearing")}
                      />
                    </label>
                  </div>
                  <CallsGrid
                    rows={calls}
                    unsure={unsure.some((u) => u.startsWith("calls"))}
                    onChange={setCalls}
                  />
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-600">
              Press Read the document to extract the description.
              {storedLegalText ? " A legal description already scanned from this document will be used as context." : ""}
            </p>
          )}

          <div className="flex justify-end">
            <button
              onClick={() => setStep(2)}
              disabled={!canContinueFrom1}
              className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-60"
            >
              Continue
            </button>
          </div>
        </section>
      ) : null}

      {/* ---------------------------------------------------- Step 2 */}
      {step === 2 && useAliquot ? (
        <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-base font-semibold text-gray-900">Resolve sections</h2>
          <p className="text-xs text-gray-500">
            Each tract's section comes from the BLM public land survey. Parts are cut from the section by quarters and halves.
          </p>
          {tracts.map((t, i) => (
            <div key={i} className="space-y-2 rounded-lg border border-gray-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-gray-900">
                  Tract {i + 1}: {t.aliquot_text || "(whole section)"} of Sec {t.section}, T{t.township_num}{t.township_dir} R{t.range_num}{t.range_dir}
                </p>
                <button
                  onClick={() => resolveTract(i)}
                  disabled={t.loading}
                  className="ml-auto rounded-lg bg-kelly-500 px-3 py-1 text-xs font-semibold text-white hover:bg-kelly-600 disabled:opacity-60"
                >
                  {t.loading ? "Looking up..." : t.polygon ? "Re-resolve" : "Resolve"}
                </button>
              </div>
              {t.error ? <p className="text-xs text-red-600">{t.error}</p> : null}
              {t.candidates && t.candidates.length > 1 ? (
                <div>
                  <p className="mb-1 text-xs font-medium text-amber-800">
                    Several sections match under this meridian (duplicate township). Pick the right one:
                  </p>
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {t.candidates.map((c) => (
                      <button
                        key={c.key}
                        onClick={() => resolveTract(i, c.key)}
                        className={
                          "rounded-lg border px-2 py-1.5 text-left text-xs " +
                          (t.chosenKey === c.key
                            ? "border-kelly-500 bg-kelly-50"
                            : "border-gray-300 hover:bg-gray-50")
                        }
                      >
                        <span className="block font-medium text-gray-900">
                          {c.attrs.meridianName ?? `Meridian ${c.attrs.meridian ?? "?"}`}
                        </span>
                        <span className="text-gray-500">
                          Section {c.attrs.section}, {formatAcres(c.acres)} acres
                        </span>
                      </button>
                    ))}
                  </div>
                  <PlotMap
                    plotted={null}
                    existing={null}
                    extras={t.candidates.map((c) => ({
                      geometry: c.polygon,
                      label: c.attrs.meridianName ?? c.key,
                      highlighted: t.chosenKey === c.key,
                    }))}
                    fitKey={`cand-${i}-${t.candidates.length}`}
                    height="h-56"
                  />
                </div>
              ) : null}
              {t.needMeridian ? (
                <div className="flex flex-wrap gap-1.5">
                  {meridianOptions.map((k) => (
                    <button
                      key={k}
                      onClick={() => resolveTract(i, undefined, { meridian: k })}
                      className="rounded-full border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50"
                    >
                      Use {MERIDIANS[k].name} meridian
                    </button>
                  ))}
                </div>
              ) : null}
              {t.polygon ? (
                <p className="text-xs text-gray-700">
                  Resolved: about {formatAcres(t.acres ?? 0)} acres.
                </p>
              ) : null}
              {t.polygon && t.gateOk === false ? (
                <div className="rounded-lg border border-red-400 bg-red-50 p-2 text-xs text-red-800">
                  <p className="font-semibold">
                    County check failed: this section is in {t.gateCounty} County, the deed says {deedCounty}.
                  </p>
                  <p className="mt-0.5">
                    A flipped direction letter or the wrong survey is the usual cause. Try the likely fixes:
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {retryOptions(t).map((o) => (
                      <button
                        key={o.label}
                        onClick={() => resolveTract(i, undefined, o.patch)}
                        className="rounded-full border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-800 hover:bg-red-100"
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {t.polygon && t.distanceMi != null && t.distanceMi > PLOT_DISTANCE_WARN_MILES ? (
                <p className="rounded-lg border border-amber-400 bg-amber-50 p-2 text-xs font-medium text-amber-900">
                  This section is {formatNumber(t.distanceMi)} miles from your nearest boundary ({t.nearestName}). New land is possible, but check the township, range, directions, and county before saving.
                </p>
              ) : null}
              {diagnosticLine(t) ? (
                <p className="font-mono text-[11px] leading-snug text-gray-500">{diagnosticLine(t)}</p>
              ) : null}
              {t.notes && t.notes.length > 0 ? (
                <ul className="list-disc pl-4 text-xs text-amber-800">
                  {t.notes.map((n, k) => (
                    <li key={k}>{n}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
          <PlotMap
            plotted={aliquotPolygon}
            existing={referenceGeometry}
            extras={tracts
              .filter((t) => t.chosenKey && t.candidates)
              .map((t) => {
                const c = t.candidates!.find((x) => x.key === t.chosenKey)!;
                return { geometry: c.polygon, label: `Sec ${c.attrs.section}` };
              })}
            fitKey={`aliquot-${tracts.map((t) => t.chosenKey ?? "").join("|")}`}
          />
          {aliquotPolygon ? (
            <p className="text-sm font-medium text-pine-900">
              Plotted area: {formatAcres(plottedAcres)} acres
            </p>
          ) : null}
          <div className="flex justify-between">
            <button onClick={() => setStep(1)} className="text-sm font-medium text-gray-600 hover:underline">
              &larr; Back
            </button>
            <button
              onClick={() => setStep(3)}
              disabled={!canContinueFrom2}
              className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-60"
            >
              Continue
            </button>
          </div>
        </section>
      ) : null}

      {step === 2 && !useAliquot ? (
        <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-base font-semibold text-gray-900">Traverse and place</h2>
          {trav ? (
            <div className={"rounded-lg border p-3 " + gradeClass}>
              <p className="text-sm font-semibold">
                {formatClosure(trav)}
                {trav.adjusted ? " (adjusted by compass rule)" : ""}
              </p>
              <p className="text-xs">
                {grade === "closed" || grade === "good"
                  ? "Good closure for rural survey work."
                  : grade === "fair"
                    ? "Usable, but check the calls marked amber and the units."
                    : "Poor closure: a call is probably misread or missing. Fix the grid before trusting the shape."}
                {badCalls > 0 ? ` ${badCalls} call${badCalls === 1 ? "" : "s"} could not be read and were skipped.` : ""}
              </p>
              <p className="mt-1 text-xs">
                Area {formatAcres(trav.areaAcres)} acres, perimeter {formatNumber(Math.round(trav.perimeterFt))} ft
              </p>
              {trav.warnings.length > 0 ? (
                <ul className="mt-1 list-disc pl-4 text-xs">
                  {trav.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              ) : null}
              <label className="mt-2 flex items-center gap-2 text-xs font-medium">
                <input
                  type="checkbox"
                  checked={forceClose}
                  onChange={(e) => setForceClose(e.target.checked)}
                  className="h-4 w-4 accent-kelly-500"
                />
                Force close (compass rule): distributes the closure error across the courses. The drawn courses no longer match the deed exactly.
              </label>
            </div>
          ) : (
            <p className="text-sm text-gray-600">At least two readable calls are needed to traverse.</p>
          )}

          <details className="rounded-lg border border-gray-200 p-2">
            <summary className="cursor-pointer text-sm font-medium text-gray-700">Edit calls</summary>
            <div className="mt-2">
              <CallsGrid rows={calls} unsure={false} onChange={setCalls} />
            </div>
          </details>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Reference boundary (for placing the point of beginning)</label>
              <select
                value={targetPropertyId}
                onChange={(e) => {
                  setTargetTouched(true);
                  setTargetPropertyId(e.target.value);
                  setPob(null);
                }}
                className={inputClass}
              >
                <option value="">None</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Rotation (basis of bearing): {rotation.toFixed(1)} degrees
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={-15}
                  max={15}
                  step={0.1}
                  value={rotation}
                  onChange={(e) => setRotation(Number(e.target.value))}
                  className="flex-1 accent-kelly-500"
                />
                <input
                  type="number"
                  step={0.1}
                  value={rotation}
                  onChange={(e) => setRotation(Math.max(-15, Math.min(15, Number(e.target.value) || 0)))}
                  className="w-20 rounded-lg border border-gray-300 px-2 py-1 text-sm"
                />
              </div>
            </div>
          </div>

          <p className="text-xs text-gray-600">
            Tap the map or drag the marker to set the point of beginning{pobDescription ? ` (${pobDescription})` : ""}. The figure follows live.
          </p>
          {cornerPicks.length > 0 && refCentroid ? (
            <div className="flex flex-wrap gap-1.5">
              {cornerPicks.map((c) => (
                <button
                  key={c.coord.join(",")}
                  onClick={() => setPob(c.coord)}
                  className="rounded-full border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50"
                >
                  Use {cornerLabel(c.coord, refCentroid)}
                </button>
              ))}
            </div>
          ) : null}
          <PlotMap
            plotted={mbPolygon}
            existing={referenceGeometry}
            pob={pob}
            onPobChange={setPob}
            fitKey={`mb-${targetPropertyId}`}
          />
          {pob ? (
            <p className="text-xs text-gray-500">
              POB {pob[1].toFixed(6)}, {pob[0].toFixed(6)}
              {plottedAcres !== null ? ` · plotted ${formatAcres(plottedAcres)} acres` : ""}
              {pobCounty ? ` · pin is in ${pobCounty} County` : ""}
              {deedCounty ? ` · deed says ${deedCounty}` : ""}
            </p>
          ) : null}
          {pob && pobCounty && deedCounty && !countyMatches(deedCounty, pobCounty) ? (
            <p className="rounded-lg border border-red-400 bg-red-50 p-2 text-xs font-medium text-red-800">
              The point of beginning is pinned in {pobCounty} County but the deed describes land in {deedCounty} County. Move the pin before saving.
            </p>
          ) : null}
          <div className="flex justify-between">
            <button onClick={() => setStep(1)} className="text-sm font-medium text-gray-600 hover:underline">
              &larr; Back
            </button>
            <button
              onClick={() => setStep(3)}
              disabled={!canContinueFrom2}
              className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-60"
            >
              Continue
            </button>
          </div>
        </section>
      ) : null}

      {/* ---------------------------------------------------- Step 3 */}
      {step === 3 ? (
        <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-base font-semibold text-gray-900">Preview and save</h2>
          {savedLink ? (
            <div className="rounded-lg border border-kelly-200 bg-kelly-50 p-3 text-sm text-pine-900">
              <p className="font-semibold">Boundary saved and linked to this document.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Link href={savedLink} className="rounded-lg bg-kelly-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-kelly-600">
                  View on map
                </Link>
                <Link href="/documents" className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
                  Back to documents
                </Link>
              </div>
            </div>
          ) : (
            <>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Save as</label>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  {(
                    [
                      ["new_property", "New property"],
                      ["new_parcel", "New parcel"],
                      ["replace_property", "Replace property boundary"],
                      ["replace_parcel", "Replace parcel boundary"],
                    ] as Array<[TargetMode, string]>
                  ).map(([m, label]) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setTargetMode(m)}
                      className={
                        "rounded-lg border px-2 py-1.5 text-xs font-medium " +
                        (targetMode === m
                          ? "border-kelly-500 bg-kelly-50 text-pine-900"
                          : "border-gray-300 text-gray-600 hover:bg-gray-50")
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {targetMode === "new_property" ? (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <label className="text-xs font-medium text-gray-700">
                    Name
                    <input value={newName} onChange={(e) => setNewName(e.target.value)} className={inputClass} />
                  </label>
                  <label className="text-xs font-medium text-gray-700">
                    County
                    <input value={newCounty} onChange={(e) => setNewCounty(e.target.value)} className={inputClass} />
                  </label>
                  <label className="text-xs font-medium text-gray-700">
                    State
                    <input value={newState} onChange={(e) => setNewState(e.target.value)} className={inputClass} />
                  </label>
                </div>
              ) : null}
              {targetMode === "new_parcel" ? (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <label className="text-xs font-medium text-gray-700">
                    Property
                    <select value={targetPropertyId} onChange={(e) => { setTargetTouched(true); setTargetPropertyId(e.target.value); }} className={inputClass}>
                      <option value="">Pick a property</option>
                      {properties.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs font-medium text-gray-700">
                    Parcel number
                    <input value={newName} onChange={(e) => setNewName(e.target.value)} className={inputClass} />
                  </label>
                  <label className="text-xs font-medium text-gray-700">
                    County
                    <input value={newCounty} onChange={(e) => setNewCounty(e.target.value)} className={inputClass} />
                  </label>
                </div>
              ) : null}
              {targetMode === "replace_property" ? (
                <label className="block text-xs font-medium text-gray-700">
                  Property
                  <select value={targetPropertyId} onChange={(e) => { setTargetTouched(true); setTargetPropertyId(e.target.value); }} className={inputClass}>
                    <option value="">Pick a property</option>
                    {properties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({formatAcres(p.acres)} ac)
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {targetMode === "replace_parcel" ? (
                <label className="block text-xs font-medium text-gray-700">
                  Parcel
                  <select value={targetParcelId} onChange={(e) => setTargetParcelId(e.target.value)} className={inputClass}>
                    <option value="">Pick a parcel</option>
                    {parcels.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.parcel_number} ({formatAcres(p.acres)} ac)
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {useAliquot && tracts.some(diagnosticLine) ? (
                <div className="space-y-0.5 rounded-lg bg-gray-50 p-2">
                  {tracts.map((t, i) =>
                    diagnosticLine(t) ? (
                      <p key={i} className="font-mono text-[11px] leading-snug text-gray-600">
                        Tract {i + 1}: {diagnosticLine(t)}
                      </p>
                    ) : null
                  )}
                </div>
              ) : null}
              {!useAliquot && pob ? (
                <p className="rounded-lg bg-gray-50 p-2 font-mono text-[11px] leading-snug text-gray-600">
                  Point of beginning {pob[1].toFixed(5)}, {pob[0].toFixed(5)}
                  {pobCounty ? `, in ${pobCounty} County` : ""}
                  {deedCounty ? ` (deed: ${deedCounty})` : ""}; rotation {rotation.toFixed(1)} degrees
                  {trav ? `; ${formatClosure(trav)}` : ""}.
                </p>
              ) : null}
              {acresGap ? (
                <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  The description says {formatAcres(acresGap.stated)} acres; the plot is {formatAcres(acresGap.plotted)} acres.
                  {useAliquot && tracts.every((t) => !t.aliquot_text || parseAliquot(t.aliquot_text).parts.length === 0)
                    ? " The tract is a portion of the section not defined by quarters (a creek, a road, or a deeded line), so the whole section is shown. Draw it by hand on the map or import the parcel from county records for the exact shape."
                    : " Check the quarter calls against the deed."}
                </p>
              ) : null}
              {targetDistance ? (
                <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  The plotted tract is {formatNumber(targetDistance.miles)} miles from{" "}
                  {targetMode === "replace_parcel" ? "that parcel" : targetProperty?.name ?? "that property"}.
                  {targetDistance.nearest ? ` Your nearest boundary is ${targetDistance.nearest}.` : ""} Check the target before saving.
                </p>
              ) : null}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-kelly-50 p-2">
                  <p className="text-[11px] uppercase tracking-wide text-gray-500">Plotted</p>
                  <p className="text-lg font-semibold text-pine-900">{formatAcres(plottedAcres)}</p>
                  <p className="text-[11px] text-gray-500">acres</p>
                </div>
                <div className="rounded-lg bg-gray-50 p-2">
                  <p className="text-[11px] uppercase tracking-wide text-gray-500">Current</p>
                  <p className="text-lg font-semibold text-gray-900">
                    {currentAcres !== null ? formatAcres(currentAcres) : "n/a"}
                  </p>
                  <p className="text-[11px] text-gray-500">acres</p>
                </div>
                <div className="rounded-lg bg-gray-50 p-2">
                  <p className="text-[11px] uppercase tracking-wide text-gray-500">Deeded</p>
                  <p className="text-lg font-semibold text-gray-900">
                    {deededAcres !== null ? formatAcres(deededAcres) : "n/a"}
                  </p>
                  <p className="text-[11px] text-gray-500">acres</p>
                </div>
              </div>

              <PlotMap
                plotted={plotted}
                existing={existingGeometry}
                fitKey={`preview-${targetMode}-${targetPropertyId}-${targetParcelId}`}
              />

              <div className="flex justify-between">
                <button onClick={() => setStep(2)} className="text-sm font-medium text-gray-600 hover:underline">
                  &larr; Back
                </button>
                <button
                  onClick={save}
                  disabled={saving || !plotted}
                  className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-60"
                >
                  {saving
                    ? "Saving..."
                    : targetMode.startsWith("replace")
                      ? "Replace boundary"
                      : "Save boundary"}
                </button>
              </div>
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- calls grid

function CallsGrid({
  rows,
  unsure,
  onChange,
}: {
  rows: CallRow[];
  unsure: boolean;
  onChange: (rows: CallRow[]) => void;
}) {
  const patch = (id: string, p: Partial<CallRow>) =>
    onChange(rows.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    const next = rows.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const cell = "rounded border border-gray-300 px-1.5 py-1 text-xs w-full";
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-900">
          Calls
          {unsure ? (
            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
              Some calls were uncertain; check each one
            </span>
          ) : null}
        </p>
        <button
          type="button"
          onClick={() => onChange([...rows, newCallRow()])}
          className="rounded-lg border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          + Add call
        </button>
      </div>
      {rows.length === 0 ? <p className="text-xs text-gray-500">No calls yet.</p> : null}
      <div className="space-y-1.5">
        {rows.map((r, i) => {
          const parsed = r.bearing_text.trim() ? parseBearing(r.bearing_text) : null;
          const needsBearing = !r.isCurve || !r.chord_bearing.trim();
          return (
            <div
              key={r.id}
              className={
                "rounded-lg border p-2 " +
                (unsure ? "border-amber-300 bg-amber-50/40" : "border-gray-200")
              }
            >
              <div className="grid grid-cols-12 items-end gap-1.5">
                <span className="col-span-1 pb-1 text-xs font-semibold text-gray-500">{i + 1}</span>
                <label className="col-span-5 text-[11px] text-gray-600">
                  Bearing
                  <input
                    value={r.bearing_text}
                    onChange={(e) => patch(r.id, { bearing_text: e.target.value })}
                    placeholder="N 45°30' E"
                    className={cell + (needsBearing && r.bearing_text && !parsed ? " border-red-400" : "")}
                  />
                </label>
                <label className="col-span-3 text-[11px] text-gray-600">
                  Distance
                  <input
                    value={r.distance}
                    onChange={(e) => patch(r.id, { distance: e.target.value })}
                    inputMode="decimal"
                    className={cell}
                  />
                </label>
                <label className="col-span-3 text-[11px] text-gray-600">
                  Unit
                  <select
                    value={r.unit}
                    onChange={(e) => patch(r.id, { unit: e.target.value as Unit })}
                    className={cell}
                  >
                    {UNITS.map((u) => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                <span className={parsed ? "text-gray-500" : r.bearing_text ? "font-medium text-red-600" : "text-gray-400"}>
                  {parsed
                    ? `Azimuth ${parsed.azimuthDeg.toFixed(2)} deg`
                    : r.bearing_text
                      ? "Unreadable bearing"
                      : "No bearing"}
                </span>
                <label className="flex items-center gap-1 text-gray-600">
                  <input
                    type="checkbox"
                    checked={r.isCurve}
                    onChange={(e) => patch(r.id, { isCurve: e.target.checked })}
                    className="h-3.5 w-3.5 accent-kelly-500"
                  />
                  Curve
                </label>
                <span className="ml-auto flex gap-1">
                  <button type="button" onClick={() => move(i, -1)} className="rounded border border-gray-300 px-1.5 text-gray-600 hover:bg-gray-50" title="Move up">&uarr;</button>
                  <button type="button" onClick={() => move(i, 1)} className="rounded border border-gray-300 px-1.5 text-gray-600 hover:bg-gray-50" title="Move down">&darr;</button>
                  <button type="button" onClick={() => onChange(rows.filter((x) => x.id !== r.id))} className="rounded border border-red-200 px-1.5 text-red-600 hover:bg-red-50" title="Remove">&times;</button>
                </span>
              </div>
              {r.isCurve ? (
                <div className="mt-1 grid grid-cols-2 gap-1.5 sm:grid-cols-6">
                  <label className="text-[11px] text-gray-600">
                    Direction
                    <select value={r.direction} onChange={(e) => patch(r.id, { direction: e.target.value as "left" | "right" })} className={cell}>
                      <option value="right">Right</option>
                      <option value="left">Left</option>
                    </select>
                  </label>
                  <label className="text-[11px] text-gray-600">
                    Radius (ft)
                    <input value={r.radius} onChange={(e) => patch(r.id, { radius: e.target.value })} inputMode="decimal" className={cell} />
                  </label>
                  <label className="text-[11px] text-gray-600">
                    Arc (ft)
                    <input value={r.arc_length} onChange={(e) => patch(r.id, { arc_length: e.target.value })} inputMode="decimal" className={cell} />
                  </label>
                  <label className="text-[11px] text-gray-600">
                    Chord bearing
                    <input value={r.chord_bearing} onChange={(e) => patch(r.id, { chord_bearing: e.target.value })} className={cell} />
                  </label>
                  <label className="text-[11px] text-gray-600">
                    Chord (ft)
                    <input value={r.chord_length} onChange={(e) => patch(r.id, { chord_length: e.target.value })} inputMode="decimal" className={cell} />
                  </label>
                  <label className="text-[11px] text-gray-600">
                    Delta (deg)
                    <input value={r.delta} onChange={(e) => patch(r.id, { delta: e.target.value })} inputMode="decimal" className={cell} />
                  </label>
                </div>
              ) : null}
              {r.note ? <p className="mt-1 text-[11px] text-gray-500">{r.note}</p> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// "... in Lawrence County, Alabama ..." -> "Lawrence" (first county named).
function countyFromText(text: string): string | null {
  const m = /\b([A-Z][A-Za-z.'\- ]{2,30}?)\s+(?:County|Parish)\b/.exec(text ?? "");
  if (!m) return null;
  const name = m[1].trim().replace(/^(of|in|the)\s+/i, "");
  return name.length > 1 ? name : null;
}

// The aliquot chain as ORDERED, EDITABLE chips (largest division first,
// each smaller division "of" the previous), with exception chips. The
// text stays as the source of truth underneath; chips rewrite it.
function ChainChips({
  text,
  exceptions,
  unsure,
  onChange,
}: {
  text: string;
  exceptions: string[];
  unsure: boolean;
  onChange: (text: string, exceptions: string[]) => void;
}) {
  const parsed = parseAliquot(text);
  const parts: AliquotPart[] = parsed.parts;
  const [exDraft, setExDraft] = useState("");
  const setParts = (next: AliquotPart[]) => onChange(partsToText(next), exceptions);
  const addPart = () => setParts([...parts, ["NE"]]);
  const removePart = (pi: number) => setParts(parts.filter((_, j) => j !== pi));
  const setToken = (pi: number, ti: number, tok: AliquotToken) =>
    setParts(parts.map((p, j) => (j === pi ? p.map((x, k) => (k === ti ? tok : x)) : p)));
  const addSmaller = (pi: number) =>
    setParts(parts.map((p, j) => (j === pi ? ["NE", ...p] : p)));
  const dropSmallest = (pi: number) =>
    setParts(parts.map((p, j) => (j === pi && p.length > 1 ? p.slice(1) : p)));
  return (
    <div className={"space-y-2 rounded-lg border p-2 " + (unsure ? "border-amber-400 bg-amber-50" : "border-gray-200")}>
      <p className="text-xs font-medium text-gray-700">
        Aliquot parts, largest division first (each next chip is a part of the one before it)
      </p>
      {parts.length === 0 ? (
        <p className="text-xs text-gray-500">No parts yet: the whole section. Add a part below.</p>
      ) : null}
      {parts.map((part, pi) => (
        <div key={pi} className="flex flex-wrap items-center gap-1">
          {chainLargestFirst(part).map((tok, k) => {
            const ti = part.length - 1 - k; // index in the smallest-first chain
            return (
              <span key={k} className="flex items-center gap-1">
                {k > 0 ? <span className="text-[11px] text-gray-400">then its</span> : null}
                <select
                  value={tok}
                  onChange={(e) => setToken(pi, ti, e.target.value as AliquotToken)}
                  className="rounded-full border border-gray-300 bg-white px-2 py-0.5 text-xs font-medium text-gray-800"
                >
                  {ALIQUOT_TOKENS.map((t) => (
                    <option key={t} value={t}>
                      {tokenLabel(t)}
                    </option>
                  ))}
                </select>
              </span>
            );
          })}
          <button type="button" onClick={() => addSmaller(pi)} className="text-[11px] font-medium text-kelly-700 hover:underline">
            + smaller part
          </button>
          {part.length > 1 ? (
            <button type="button" onClick={() => dropSmallest(pi)} className="text-[11px] text-gray-500 hover:underline">
              drop smallest
            </button>
          ) : null}
          <button type="button" onClick={() => removePart(pi)} className="text-[11px] text-red-600 hover:underline">
            remove
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={addPart} className="rounded-lg border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">
          + Add part
        </button>
        <label className="flex flex-1 items-center gap-1 text-[11px] text-gray-500">
          Text
          <input
            value={text}
            onChange={(e) => onChange(e.target.value, exceptions)}
            placeholder="NW1/4 of SE1/4 and S1/2 of NE1/4"
            className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-medium text-gray-600">Less and except:</span>
        {exceptions.map((ex, k) => (
          <span key={k} className="flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
            {ex}
            <button
              type="button"
              onClick={() => onChange(text, exceptions.filter((_, j) => j !== k))}
              className="text-gray-400 hover:text-red-600"
              aria-label="Remove exception"
            >
              &times;
            </button>
          </span>
        ))}
        <input
          value={exDraft}
          onChange={(e) => setExDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && exDraft.trim()) {
              e.preventDefault();
              onChange(text, [...exceptions, exDraft.trim()]);
              setExDraft("");
            }
          }}
          placeholder="e.g. SE1/4 of NE1/4, Enter to add"
          className="w-48 rounded border border-gray-300 px-2 py-0.5 text-xs"
        />
      </div>
    </div>
  );
}
