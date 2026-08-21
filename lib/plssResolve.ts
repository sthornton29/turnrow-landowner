// Server-side legal description resolver for the document intake: a
// PLSS reference read off a deed becomes a WGS84 polygon through the
// same engine the plot screen uses (pinned meridian from the deed's
// county, BLM CadNSDI section layer, aliquot subdivision) and passes
// the county gate before anyone sees it. Never throws: every failure
// returns null geometry with plain notes so the intake degrades to the
// name and number signals.

import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { MultiPolygon, Polygon } from "geojson";
import { queryLayerFeatures } from "@/lib/gisServer";
import {
  MERIDIANS,
  PLSS_SECTION_LAYER,
  PLSS_SERVICE_LABEL,
  PLSS_SERVICE_URL,
  acresOf,
  buildPlssWhere,
  cacheKey,
  meridianCode,
  meridianName,
  normalizePlssFeature,
  townshipLabel,
  type PlssCandidate,
  type PlssRequest,
} from "@/lib/plss";
import { meridiansForCounty } from "@/lib/plssMeridians";
import { countyMatches, lookupCounty } from "@/lib/countyLookup";
import { parseAliquot, resolveDescription } from "@/lib/geo/aliquot";

export interface PlssReferenceInput {
  county: string | null;
  state: string | null;
  meridian_hint?: string | null;
  township_num: number | string | null;
  township_dir: string | null;
  range_num: number | string | null;
  range_dir: string | null;
  section: number | string | null;
  aliquot_text?: string | null;
  exceptions?: string[] | null;
}

export interface SpatialResolution {
  meridian: string | null; // BLM code
  meridianName: string | null;
  source: "stated" | "county" | "alternate" | null;
  tried: string[];
  service: string;
  cached: boolean;
}

export interface SpatialResolveResult {
  polygon: MultiPolygon | null;
  sectionPolygon: Polygon | MultiPolygon | null;
  referenceLabel: string | null; // "Sec 12, T4S R8W, Huntsville PM"
  describedAcres: number | null;
  resolution: SpatialResolution;
  countyCheck: { deed: string | null; resolved: string | null; matches: boolean | null };
  notes: string[];
}

const TOTAL_BUDGET_MS = 12000;

function serviceRole() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}

function toRequest(ref: PlssReferenceInput): PlssRequest | null {
  const state = String(ref.state ?? "").trim().toUpperCase();
  const tNum = Number(ref.township_num);
  const rNum = Number(ref.range_num);
  const sec = Number(ref.section);
  const tDir = String(ref.township_dir ?? "").trim().toUpperCase().slice(0, 1);
  const rDir = String(ref.range_dir ?? "").trim().toUpperCase().slice(0, 1);
  if (
    !/^[A-Z]{2}$/.test(state) ||
    !(tNum >= 1 && tNum <= 999) ||
    !(rNum >= 1 && rNum <= 999) ||
    !(sec >= 1 && sec <= 36) ||
    (tDir !== "N" && tDir !== "S") ||
    (rDir !== "E" && rDir !== "W")
  ) {
    return null;
  }
  return {
    state,
    township: { num: tNum, dir: tDir as "N" | "S" },
    range: { num: rNum, dir: rDir as "E" | "W" },
    section: Math.floor(sec),
    meridian: null,
  };
}

function firstPolygon(g: Polygon | MultiPolygon): Polygon {
  return g.type === "Polygon" ? g : { type: "Polygon", coordinates: g.coordinates[0] };
}

function centroidOf(g: Polygon | MultiPolygon): [number, number] {
  const ring = firstPolygon(g).coordinates[0] ?? [];
  if (ring.length === 0) return [0, 0];
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p[0];
    y += p[1];
  }
  return [x / ring.length, y / ring.length];
}

async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const t = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([p, t]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Section lookup with the cache and the pinned meridian plan.
async function findSection(
  req: PlssRequest,
  county: string | null,
  stated: string | null,
  deadline: number
): Promise<{ candidate: PlssCandidate | null; resolution: SpatialResolution; notes: string[] }> {
  const notes: string[] = [];
  const byCounty = meridiansForCounty(req.state, county);
  let plan: Array<{ key: string; source: SpatialResolution["source"] }> = [];
  if (stated && meridianCode(stated)) {
    const key =
      Object.keys(MERIDIANS).find((k) => k === stated.toUpperCase()) ??
      Object.keys(MERIDIANS).find((k) => MERIDIANS[k].code === meridianCode(stated)) ??
      stated;
    plan = [{ key, source: "stated" }];
  } else if (byCounty.primary) {
    plan = [
      { key: byCounty.primary, source: "county" },
      ...byCounty.alternates.map((k) => ({ key: k, source: "alternate" as const })),
    ];
  } else {
    notes.push(
      county
        ? `No principal meridian on file for ${county} County, ${req.state}; the description was not plotted.`
        : "The description names no county, so its principal meridian could not be pinned; not plotted."
    );
    return {
      candidate: null,
      resolution: { meridian: null, meridianName: null, source: null, tried: [], service: "BLM CadNSDI section layer", cached: false },
      notes,
    };
  }

  const { township, range } = townshipLabel(req);
  const tried: string[] = [];
  const svc = serviceRole();
  for (const step of plan) {
    if (Date.now() > deadline) {
      notes.push("Section lookup ran out of time.");
      break;
    }
    const code = meridianCode(step.key);
    if (!code) continue;
    tried.push(step.key);
    const attempt: PlssRequest = { ...req, meridian: step.key };
    const resolution: SpatialResolution = {
      meridian: code,
      meridianName: meridianName(code),
      source: step.source,
      tried: [...tried],
      service: "BLM CadNSDI section layer",
      cached: false,
    };
    // Cache first (service role: read-all policy either way, but the
    // route has no session here).
    if (svc) {
      const { data } = await svc
        .from("plss_cache")
        .select("key, geojson, attrs")
        .eq("state", req.state)
        .eq("township", township)
        .eq("range", range)
        .eq("section", req.section)
        .eq("meridian", code)
        .limit(1);
      const row = (data as Array<{ key: string; geojson: PlssCandidate["polygon"]; attrs: PlssCandidate["attrs"] }> | null)?.[0];
      if (row?.geojson) {
        return {
          candidate: { key: row.key, polygon: row.geojson, attrs: row.attrs, acres: acresOf(row.geojson) },
          resolution: { ...resolution, cached: true },
          notes,
        };
      }
    }
    try {
      const remaining = Math.max(3000, deadline - Date.now());
      const { features } = await queryLayerFeatures({
        serviceUrl: PLSS_SERVICE_URL,
        layerId: PLSS_SECTION_LAYER,
        where: buildPlssWhere(attempt),
        maxFeatures: 5,
        outFields: "PLSSID,FRSTDIVNO,FRSTDIVDUP,FRSTDIVTYP",
        timeoutMs: Math.min(remaining, 20000),
        serviceLabel: PLSS_SERVICE_LABEL,
      });
      const candidates = features
        .map((f) => normalizePlssFeature(f as { geometry: PlssCandidate["polygon"] | null; properties: Record<string, unknown> }))
        .filter((c): c is PlssCandidate => c !== null);
      if (candidates.length === 0) continue;
      if (svc) {
        const rows = candidates.map((c) => ({
          key: cacheKey(req.state, township, range, req.section, c.attrs.meridian),
          state: req.state,
          township,
          range,
          section: req.section,
          meridian: c.attrs.meridian,
          geojson: c.polygon,
          attrs: { ...c.attrs, acres: c.acres },
          fetched_at: new Date().toISOString(),
        }));
        await svc.from("plss_cache").upsert(rows, { onConflict: "key" });
      }
      return { candidate: candidates[0], resolution, notes };
    } catch (err) {
      notes.push(err instanceof Error ? err.message : "The BLM PLSS service did not answer.");
      return {
        candidate: null,
        resolution: { ...resolution },
        notes,
      };
    }
  }
  const names = tried.map((k) => MERIDIANS[k]?.name ?? k).join(", ");
  notes.push(
    `No section ${req.section} found for T${township} R${range} under the ${names || "pinned"} meridian${tried.length === 1 ? "" : "s"}.`
  );
  return {
    candidate: null,
    resolution: { meridian: null, meridianName: null, source: null, tried, service: "BLM CadNSDI section layer", cached: false },
    notes,
  };
}

export async function resolvePlssReference(
  ref: PlssReferenceInput,
  opts: {
    // The land index already places this section on the caller's own
    // land (migration 0029), so the live county lookup is skipped.
    knownSection?: boolean;
    budgetMs?: number;
  } = {}
): Promise<SpatialResolveResult> {
  const deadline = Date.now() + (opts.budgetMs ?? TOTAL_BUDGET_MS);
  const empty: SpatialResolution = {
    meridian: null,
    meridianName: null,
    source: null,
    tried: [],
    service: "BLM CadNSDI section layer",
    cached: false,
  };
  const deedCounty = ref.county ? String(ref.county).replace(/\s+county$/i, "").trim() : null;
  const req = toRequest(ref);
  if (!req) {
    return {
      polygon: null,
      sectionPolygon: null,
      referenceLabel: null,
      describedAcres: null,
      resolution: empty,
      countyCheck: { deed: deedCounty, resolved: null, matches: null },
      notes: ["The description did not give a complete section, township, and range."],
    };
  }
  const { township, range } = townshipLabel(req);

  const found = await withTimeout(
    findSection(req, deedCounty, ref.meridian_hint ?? null, deadline),
    TOTAL_BUDGET_MS,
    { candidate: null, resolution: empty, notes: ["Section lookup ran out of time."] }
  );
  const label = (mer: string | null) =>
    `Sec ${req.section}, T${township} R${range}${mer ? `, ${mer} PM` : ""}`;
  if (!found.candidate) {
    return {
      polygon: null,
      sectionPolygon: null,
      referenceLabel: label(found.resolution.meridianName),
      describedAcres: null,
      resolution: found.resolution,
      countyCheck: { deed: deedCounty, resolved: null, matches: null },
      notes: found.notes,
    };
  }

  const notes = [...found.notes];
  const section = found.candidate.polygon;
  const sectionPoly = firstPolygon(section);
  if (section.type === "MultiPolygon" && section.coordinates.length > 1) {
    notes.push("The section came back in several pieces; the first was used.");
  }

  // County gate BEFORE any geometry is shown.
  const [lon, lat] = centroidOf(section);
  let resolvedCounty: string | null = null;
  let matches: boolean | null = null;
  if (opts.knownSection) {
    resolvedCounty = deedCounty;
    matches = true;
    notes.push("Section is in your land index; county check by index.");
  } else try {
    const hit = await withTimeout(lookupCounty(lon, lat), Math.max(2000, deadline - Date.now()), null);
    resolvedCounty = hit?.county ?? null;
    if (resolvedCounty && deedCounty) {
      matches = countyMatches(deedCounty, resolvedCounty);
      if (!matches) {
        notes.push(`Resolved to ${resolvedCounty} County, the deed says ${deedCounty}; not used for matching.`);
        return {
          polygon: null,
          sectionPolygon: section,
          referenceLabel: label(found.resolution.meridianName),
          describedAcres: null,
          resolution: found.resolution,
          countyCheck: { deed: deedCounty, resolved: resolvedCounty, matches: false },
          notes,
        };
      }
    }
  } catch {
    notes.push("County check unavailable.");
  }

  // Aliquot subdivision (whole section when the text is not an aliquot).
  const aliquotText = [ref.aliquot_text ?? "", ...((ref.exceptions ?? []).map((e) => `less and except ${e}`))]
    .filter(Boolean)
    .join(" ");
  let polygon: MultiPolygon | null = null;
  let acres: number | null = null;
  if (aliquotText.trim()) {
    try {
      const parsed = parseAliquot(aliquotText);
      if (parsed.parts.length > 0 || parsed.lots.length > 0) {
        const r = resolveDescription(parsed, sectionPoly);
        polygon = r.polygon;
        acres = r.polygon ? Math.round(r.acres * 10) / 10 : null;
        notes.push(...r.notes);
      }
    } catch (err) {
      notes.push(err instanceof Error ? err.message : "Could not subdivide the section.");
    }
  }
  if (!polygon) {
    polygon = section.type === "MultiPolygon" ? section : { type: "MultiPolygon", coordinates: [section.coordinates] };
    acres = Math.round(acresOf(section) * 10) / 10;
    notes.push("Whole section used; the description was not an aliquot chain.");
  }

  return {
    polygon,
    sectionPolygon: section,
    referenceLabel: label(found.resolution.meridianName),
    describedAcres: acres,
    resolution: found.resolution,
    countyCheck: { deed: deedCounty, resolved: resolvedCounty, matches },
    notes,
  };
}
