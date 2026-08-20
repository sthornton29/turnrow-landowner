import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { GisError, queryLayerFeatures } from "@/lib/gisServer";
import {
  PLSS_SECTION_LAYER,
  PLSS_SERVICE_LABEL,
  PLSS_SERVICE_URL,
  buildPlssWhere,
  cacheKey,
  meridianCode,
  normalizePlssFeature,
  townshipLabel,
  type PlssCandidate,
  type PlssRequest,
} from "@/lib/plss";

// Section polygon lookup for aliquot plotting. Session required; reads
// the global plss_cache first (section geometry is static), otherwise
// queries the BLM service server-side and caches through the service
// role (the cache table has no client write policies). Several
// candidates come back when the meridian was not given and the same
// township/range exists under more than one meridian; the UI asks.
export const maxDuration = 60;

function serviceRole() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

function parseRequest(body: Record<string, unknown>): PlssRequest | null {
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
  };
}

interface CacheRow {
  key: string;
  state: string;
  township: string;
  range: string;
  section: number;
  meridian: string | null;
  geojson: PlssCandidate["polygon"];
  attrs: PlssCandidate["attrs"];
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

  const { township, range } = townshipLabel(req);
  const code = meridianCode(req.meridian);

  // 1. Cache (session client; read-all policy). An explicit meridian
  //    matches one row; "any" matches every row for the section.
  let q = supabase
    .from("plss_cache")
    .select("*")
    .eq("state", req.state)
    .eq("township", township)
    .eq("range", range)
    .eq("section", req.section);
  if (code) q = q.eq("meridian", code);
  const { data: cached } = await q;
  const cachedRows = (cached as CacheRow[] | null) ?? [];
  // A prior any-meridian miss is not recorded, so an empty read always
  // tries the service; a hit (one or more rows) serves from cache.
  if (cachedRows.length > 0) {
    return NextResponse.json({
      cached: true,
      candidates: cachedRows.map((r) => ({
        key: r.key,
        polygon: r.geojson,
        attrs: r.attrs,
        acres: r.attrs && typeof (r.attrs as { acres?: number }).acres === "number"
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
      where: buildPlssWhere(req),
      maxFeatures: 10,
      outFields: "PLSSID,FRSTDIVNO,FRSTDIVDUP,FRSTDIVTYP",
      timeoutMs: 25000,
      serviceLabel: PLSS_SERVICE_LABEL,
    });
    const candidates = features
      .map(normalizePlssFeature)
      .filter((c): c is PlssCandidate => c !== null);
    if (candidates.length === 0) {
      return NextResponse.json({
        cached: false,
        candidates: [],
        error: `No section ${req.section} found for T${township} R${range} in ${req.state}${
          code ? "" : " under any meridian"
        }. Check the township, range, and direction letters.`,
      });
    }

    // 3. Cache through the service role, keyed per meridian so an
    //    explicit later lookup hits too.
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

    return NextResponse.json({ cached: false, candidates });
  } catch (err) {
    const status = err instanceof GisError ? err.status : 502;
    const message =
      err instanceof GisError
        ? err.message
        : "Could not look up the section from the BLM PLSS service right now.";
    return NextResponse.json({ error: message }, { status });
  }
}
