import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { GisError, queryLayerFeatures } from "@/lib/gisServer";
import {
  MERIDIANS,
  PLSS_SECTION_LAYER,
  PLSS_SERVICE_LABEL,
  PLSS_SERVICE_URL,
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

// Section polygon lookup for aliquot plotting. Session required. The
// principal meridian is ALWAYS pinned: stated by the caller, else
// derived from the deed's county (lib/plssMeridians.ts), primary first
// and the county's alternates only when the primary finds nothing. A
// request with neither a meridian nor a county is refused; a wildcard
// meridian once let a misread range direction resolve a Courtland
// deed to Baldwin County. Reads the global plss_cache first (section
// geometry is static), otherwise queries the BLM service server-side
// and caches through the service role (no client write policies).
export const maxDuration = 60;

function serviceRole() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

interface ParsedRequest extends PlssRequest {
  county: string | null;
}

function parseRequest(body: Record<string, unknown>): ParsedRequest | null {
  const state = String(body.state ?? "").trim().toUpperCase();
  const t = body.township as { num?: unknown; dir?: unknown } | undefined;
  const r = body.range as { num?: unknown; dir?: unknown } | undefined;
  const section = Number(body.section);
  const tNum = Number(t?.num);
  const rNum = Number(r?.num);
  const tDir = String(t?.dir ?? "").toUpperCase();
  const rDir = String(r?.dir ?? "").toUpperCase();
  if (
    !/^[A-Z]{2}$/.test(state) ||
    !(tNum >= 1 && tNum <= 999) || !(rNum >= 1 && rNum <= 999) ||
    !(section >= 1 && section <= 36) ||
    (tDir !== "N" && tDir !== "S") || (rDir !== "E" && rDir !== "W")
  ) {
    return null;
  }
  return {
    state,
    township: { num: tNum, dir: tDir },
    range: { num: rNum, dir: rDir },
    section: Math.floor(section),
    meridian: body.meridian ? String(body.meridian) : null,
    county: body.county ? String(body.county) : null,
  };
}

interface CacheRow {
  key: string;
  meridian: string | null;
  geojson: PlssCandidate["polygon"];
  attrs: PlssCandidate["attrs"];
}

export interface PlssResolution {
  meridian: string; // BLM code
  meridianKey: string | null; // HU / SS / ...
  meridianName: string | null;
  source: "stated" | "county" | "alternate";
  county: string | null;
  certain: boolean;
  tried: string[]; // meridian keys attempted, in order
  where: string;
  service: string;
  cached: boolean;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const req = parseRequest(body);
  if (!req) {
    return NextResponse.json(
      { error: "Give a state, township (number + N/S), range (number + E/W), and section 1 to 36." },
      { status: 400 }
    );
  }
  if (req.meridian && !meridianCode(req.meridian)) {
    return NextResponse.json({ error: "Unknown meridian." }, { status: 400 });
  }

  // Which meridians to try, in order.
  const byCounty = meridiansForCounty(req.state, req.county);
  let plan: Array<{ key: string; source: PlssResolution["source"] }> = [];
  if (req.meridian) {
    const key =
      Object.keys(MERIDIANS).find((k) => k === req.meridian!.toUpperCase()) ??
      Object.keys(MERIDIANS).find((k) => MERIDIANS[k].code === meridianCode(req.meridian)) ??
      null;
    plan = [{ key: key ?? req.meridian, source: "stated" }];
  } else if (byCounty.primary) {
    plan = [
      { key: byCounty.primary, source: "county" },
      ...byCounty.alternates.map((k) => ({ key: k, source: "alternate" as const })),
    ];
  } else {
    return NextResponse.json(
      {
        error: req.county
          ? `The meridian for ${req.county} County, ${req.state} is not on file. Pick the principal meridian.`
          : "Give the deed's county (the meridian comes from it) or pick the principal meridian.",
        needMeridian: true,
        stateMeridians: byCounty.stateMeridians,
      },
      { status: 422 }
    );
  }

  const { township, range } = townshipLabel(req);
  const tried: string[] = [];

  for (const step of plan) {
    const code = meridianCode(step.key);
    if (!code) continue;
    tried.push(step.key);
    const attempt: PlssRequest = { ...req, meridian: step.key };
    const where = buildPlssWhere(attempt);
    const resolution: PlssResolution = {
      meridian: code,
      meridianKey: MERIDIANS[step.key] ? step.key : null,
      meridianName: meridianName(code),
      source: step.source,
      county: req.county,
      certain: step.source === "stated" ? true : byCounty.certain,
      tried: [...tried],
      where,
      service: "BLM CadNSDI section layer",
      cached: false,
    };

    // 1. Cache (session client; read-all policy), keyed per meridian.
    const { data: cached } = await supabase
      .from("plss_cache")
      .select("key, meridian, geojson, attrs")
      .eq("state", req.state)
      .eq("township", township)
      .eq("range", range)
      .eq("section", req.section)
      .eq("meridian", code);
    const cachedRows = (cached as CacheRow[] | null) ?? [];
    if (cachedRows.length > 0) {
      return NextResponse.json({
        cached: true,
        resolution: { ...resolution, cached: true },
        candidates: cachedRows.map((r) => ({
          key: r.key,
          polygon: r.geojson,
          attrs: r.attrs,
          acres:
            r.attrs && typeof (r.attrs as { acres?: number }).acres === "number"
              ? (r.attrs as { acres?: number }).acres
              : undefined,
        })),
      });
    }

    // 2. Live query.
    try {
      const { features } = await queryLayerFeatures({
        serviceUrl: PLSS_SERVICE_URL,
        layerId: PLSS_SECTION_LAYER,
        where,
        maxFeatures: 10,
        outFields: "PLSSID,FRSTDIVNO,FRSTDIVDUP,FRSTDIVTYP",
        timeoutMs: 25000,
        serviceLabel: PLSS_SERVICE_LABEL,
      });
      const candidates = features
        .map(normalizePlssFeature)
        .filter((c): c is PlssCandidate => c !== null);
      if (candidates.length === 0) continue; // next meridian in the plan

      // 3. Cache through the service role, keyed per meridian.
      if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
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
        await serviceRole().from("plss_cache").upsert(rows, { onConflict: "key" });
      }
      return NextResponse.json({ cached: false, resolution, candidates });
    } catch (err) {
      const status = err instanceof GisError ? err.status : 502;
      const message =
        err instanceof GisError
          ? err.message
          : "Could not look up the section from the BLM PLSS service right now.";
      return NextResponse.json({ error: message }, { status });
    }
  }

  const names = tried.map((k) => MERIDIANS[k]?.name ?? k).join(", ");
  return NextResponse.json({
    cached: false,
    candidates: [],
    tried,
    error: `No section ${req.section} found for T${township} R${range} under the ${names} meridian${
      tried.length === 1 ? "" : "s"
    }${req.county ? ` (from ${req.county} County)` : ""}. Check the township and range numbers and their direction letters.`,
  });
}
