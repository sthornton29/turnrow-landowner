// The intake's spatial tier, shared by /api/extract (inside the one
// pass) and /api/spatial-match (the confirm screen's Retry). Every PLSS
// reference in the document, whether the AI returned it or the regex
// read it off the verbatim description, is resolved through the plot
// engine (pinned meridian, land-index fast path, county gate) and the
// tracts are unioned into one described polygon that the
// match_boundaries RPC intersects with the caller's boundaries under
// RLS. Never throws: failures come back as notes with a reason code so
// the confirm screen can say why and offer Retry.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MultiPolygon } from "geojson";
import { resolvePlssReference, type PlssReferenceInput } from "@/lib/plssResolve";
import { countyStateOf, extractPlssReferences, statedAcresOf } from "@/lib/legalRefs";
import { meridiansForCounty } from "@/lib/plssMeridians";
import { meridianCode } from "@/lib/plss";
import type { SpatialEvidence, SpatialMatch } from "@/lib/documentMatch";

const MAX_TRACTS = 6;
const PER_TRACT_BUDGET_MS = 12000;

type Ref = PlssReferenceInput & { from: "ai" | "text" | "anchor" };

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function refKey(r: PlssReferenceInput): string | null {
  const s = num(r.section);
  const t = num(r.township_num);
  const g = num(r.range_num);
  const td = String(r.township_dir ?? "").toUpperCase().slice(0, 1);
  const rd = String(r.range_dir ?? "").toUpperCase().slice(0, 1);
  if (!s || !t || !g || !"NS".includes(td) || !"EW".includes(rd) || !td || !rd) return null;
  return `${s}|${t}${td}|${g}${rd}`;
}

// Every reference the extraction carries, deduped by section/T/R.
export function collectReferences(extraction: Record<string, unknown>): Ref[] {
  const fields = (extraction.fields ?? {}) as Record<string, unknown>;
  const hints = (extraction.property_hints ?? {}) as { counties?: string[]; states?: string[]; legal_description_snippet?: string | null };
  const legal =
    (typeof fields.legal_description === "string" ? fields.legal_description : null) ??
    (typeof extraction.legal_description === "string" ? (extraction.legal_description as string) : null) ??
    hints.legal_description_snippet ??
    null;
  const cs = countyStateOf(legal);
  const defaultCounty = cs.county ?? hints.counties?.[0] ?? null;
  const defaultState = cs.state ?? hints.states?.[0] ?? null;

  const out: Ref[] = [];
  const seen = new Set<string>();
  const push = (r: Ref) => {
    const k = refKey(r);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push({ ...r, county: r.county ?? defaultCounty, state: r.state ?? defaultState });
  };

  const aiRefs: unknown[] = [
    ...(Array.isArray(extraction.plss_references) ? (extraction.plss_references as unknown[]) : []),
    extraction.plss_reference ?? null,
  ];
  for (const raw of aiRefs) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as PlssReferenceInput;
    if (!r.section) continue;
    push({ ...r, from: "ai" });
  }
  const mb = (extraction.mb_anchor ?? null) as
    | { county: string | null; state: string | null; section: number | null; township: string | null; range: string | null }
    | null;
  if (mb && mb.section && mb.township && mb.range) {
    const t = /^(\d+)\s*([NS])/i.exec(String(mb.township));
    const r = /^(\d+)\s*([EW])/i.exec(String(mb.range));
    if (t && r) {
      push({
        from: "anchor",
        county: mb.county,
        state: mb.state,
        township_num: Number(t[1]),
        township_dir: t[2].toUpperCase(),
        range_num: Number(r[1]),
        range_dir: r[2].toUpperCase(),
        section: mb.section,
        aliquot_text: null,
        exceptions: [],
      });
    }
  }
  // The verbatim description, read deterministically. Fills anything
  // the AI left out and never swaps a direction letter.
  for (const t of extractPlssReferences(legal)) {
    push({
      from: "text",
      county: defaultCounty,
      state: defaultState,
      township_num: t.township_num,
      township_dir: t.township_dir,
      range_num: t.range_num,
      range_dir: t.range_dir,
      section: t.section,
      aliquot_text: t.aliquot_text,
      exceptions: [],
    });
  }
  return out.slice(0, MAX_TRACTS);
}

// Is this section already in the caller's land index (migration 0029)?
async function indexedSection(supabase: SupabaseClient, ref: PlssReferenceInput): Promise<boolean> {
  const state = String(ref.state ?? "").toUpperCase();
  const plan = meridiansForCounty(state, ref.county ? String(ref.county) : null);
  const codes = [plan.primary, ...plan.alternates].map((k) => meridianCode(k)).filter(Boolean) as string[];
  let q = supabase
    .from("land_sections")
    .select("id")
    .eq("state", state)
    .eq("township", `${Number(ref.township_num)}${String(ref.township_dir).toUpperCase()}`)
    .eq("range", `${Number(ref.range_num)}${String(ref.range_dir).toUpperCase()}`)
    .eq("section", Number(ref.section))
    .limit(1);
  if (codes.length > 0) q = q.in("meridian", codes);
  const { data } = await q;
  return (data ?? []).length > 0;
}

export async function spatialEvidenceFor(
  supabase: SupabaseClient,
  extraction: Record<string, unknown>
): Promise<SpatialEvidence> {
  const refs = collectReferences(extraction);
  const fields = (extraction.fields ?? {}) as Record<string, unknown>;
  const legal =
    (typeof fields.legal_description === "string" ? fields.legal_description : null) ??
    (typeof extraction.legal_description === "string" ? (extraction.legal_description as string) : null);
  const stated = num(fields.stated_acres) ?? statedAcresOf(legal);
  const base: SpatialEvidence = {
    computed: false,
    notes: [],
    stated_acres: stated,
    references: refs.map((r) => ({ ...r })),
    tract_count: refs.length,
  };
  if (refs.length === 0) {
    return {
      ...base,
      reason: "no_reference",
      notes: ["No section, township, and range were read from the description."],
    };
  }

  const polygons: MultiPolygon["coordinates"] = [];
  const labels: string[] = [];
  const notes: string[] = [];
  let describedAcres = 0;
  let wholeSection = false;
  let countyCheck: SpatialEvidence["county_check"] = null;
  let resolution: SpatialEvidence["resolution"] = null;
  let countyFailed = false;
  for (const ref of refs) {
    const known = await indexedSection(supabase, ref).catch(() => false);
    const r = await resolvePlssReference(ref, { knownSection: known, budgetMs: PER_TRACT_BUDGET_MS });
    if (r.referenceLabel) labels.push(r.referenceLabel);
    notes.push(...r.notes.map((n) => (refs.length > 1 && r.referenceLabel ? `${r.referenceLabel}: ${n}` : n)));
    if (!resolution) resolution = r.resolution;
    if (!countyCheck || r.countyCheck.matches === false) countyCheck = r.countyCheck;
    if (r.countyCheck.matches === false) countyFailed = true;
    if (!r.polygon) continue;
    polygons.push(...r.polygon.coordinates);
    describedAcres += r.describedAcres ?? 0;
    if (r.notes.some((n) => /whole section/i.test(n))) wholeSection = true;
  }
  const label = labels.length <= 1 ? (labels[0] ?? null) : `${labels.length} tracts: ${labels.join("; ")}`;
  if (polygons.length === 0) {
    return {
      ...base,
      reference_label: label,
      resolution,
      county_check: countyCheck,
      reason: countyFailed ? "county_mismatch" : "lookup_failed",
      notes,
    };
  }
  const polygon: MultiPolygon = { type: "MultiPolygon", coordinates: polygons };
  const { data, error } = await supabase.rpc("match_boundaries", { p_geojson: polygon });
  if (error) {
    return {
      ...base,
      reference_label: label,
      resolution,
      county_check: countyCheck,
      described_acres: Math.round(describedAcres * 10) / 10,
      polygon,
      whole_section: wholeSection,
      reason: "overlap_failed",
      notes: [...notes, "Overlap check unavailable: " + error.message],
    };
  }
  const matches: SpatialMatch[] = ((data as Array<Record<string, unknown>> | null) ?? []).map((m) => ({
    entity_type: String(m.entity_type),
    id: String(m.id),
    name: String(m.name ?? ""),
    overlap_acres: Number(m.overlap_acres) || 0,
    pct_of_described: Number(m.pct_of_described) || 0,
    pct_of_boundary: m.pct_of_boundary === null ? null : Number(m.pct_of_boundary) || 0,
  }));
  return {
    ...base,
    computed: true,
    reference_label: label,
    resolution,
    county_check: countyCheck,
    described_acres: Math.round(describedAcres * 10) / 10,
    polygon,
    whole_section: wholeSection,
    matches,
    notes,
    reason: null,
  };
}
