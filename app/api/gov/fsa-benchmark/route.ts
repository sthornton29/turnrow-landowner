import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
  describeFsaFileSource,
  findBenchmarkFileLinks,
  findFileUrlInDocumentPage,
  lookupBenchmarkRows,
  normalizeCountyName,
  normalizeStateCode,
  parseBenchmarkWorkbook,
  pickBenchmarkFile,
  type BenchmarkYieldMatch,
  type ParsedWorkbook,
} from "@/lib/gov/fsaBenchmarkFile";

export const maxDuration = 60;

// ARC-CO benchmark county yields (and the national benchmark price) from
// FSA's annual workbook (docs/GOV_PAYMENTS_PATHWAYS.md section 2). Cache
// first; fsa.usda.gov at most once per 24 h per year x state; write-then-
// swap per data_year x state slice via the service role (the cache tables
// have no client write policies). Values are returned for confirmation and
// for the projection engine's benchmark lookup; data_year reports the file
// year actually used.

const FSA_PAGE_URL = "https://www.fsa.usda.gov/resources/programs/arc-plc/program-data";
const FETCH_GUARD_MS = 24 * 60 * 60 * 1000;
const INSERT_CHUNK = 1000;
const UA = { "user-agent": "turnrow-landowner (benchmark lookup)" };

const wbMemo = new Map<string, { expires: number; promise: Promise<ParsedWorkbook> }>();

function serviceRole() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

async function downloadAndParseWorkbook(url: string): Promise<ParsedWorkbook> {
  const now = Date.now();
  const hit = wbMemo.get(url);
  if (hit && hit.expires > now) return hit.promise;
  const promise = (async () => {
    let resp = await fetch(url, { cache: "no-store", headers: UA });
    if (!resp.ok) throw new Error(`FSA file download failed (HTTP ${resp.status}).`);
    let buf = await resp.arrayBuffer();
    if ((resp.headers.get("content-type") ?? "").includes("html")) {
      const fileUrl = findFileUrlInDocumentPage(new TextDecoder().decode(buf));
      if (!fileUrl) throw new Error("FSA document page had no Excel link; the page format may have changed.");
      resp = await fetch(fileUrl, { cache: "no-store", headers: UA });
      if (!resp.ok) throw new Error(`FSA workbook download failed (HTTP ${resp.status}).`);
      buf = await resp.arrayBuffer();
    }
    const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
    const sheets = wb.SheetNames.map((name) => ({
      name,
      rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null }) as (string | number | null)[][],
    }));
    const parsed = parseBenchmarkWorkbook(sheets);
    if (parsed.rows.length === 0) {
      console.error(`[fsa-benchmark] Workbook layout not recognized at ${url}. Sheets: ${parsed.sheetsSkipped.join(", ")}`);
      throw new Error("FSA workbook layout not recognized; the file format may have changed.");
    }
    return parsed;
  })();
  wbMemo.set(url, { expires: now + 60 * 60 * 1000, promise });
  promise.catch(() => {
    if (wbMemo.get(url)?.promise === promise) wbMemo.delete(url);
  });
  return promise;
}

type CacheRow = {
  data_year: number;
  state_code: string;
  county: string;
  commodity: string;
  practice: "irrigated" | "non_irrigated" | "all";
  benchmark_yield: number | null;
  benchmark_price: number | null;
  benchmark_revenue: number | null;
  fetched_at: string;
  source_url: string | null;
};
type CacheHit = { rows: BenchmarkYieldMatch[]; dataYear: number; fetchedAt: string | null; fileUrl: string | null };

function bestCacheHit(cached: CacheRow[], q: { commodity: string; county: string; state: string }): CacheHit | null {
  const years = Array.from(new Set(cached.map((r) => r.data_year))).sort((a, b) => b - a);
  for (const y of years) {
    const yearRows = cached.filter((r) => r.data_year === y);
    const rows = lookupBenchmarkRows(yearRows, q);
    if (rows.length > 0) {
      return { rows, dataYear: y, fetchedAt: yearRows[0]?.fetched_at ?? null, fileUrl: yearRows[0]?.source_url ?? null };
    }
  }
  return null;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const commodity = String(body?.commodity ?? "").replace(/_/g, " ").trim();
  const county = String(body?.county ?? "").trim();
  const state = String(body?.state ?? "").trim();
  const year = Number(body?.year);
  if (!commodity || !county || !state || !Number.isInteger(year)) {
    return NextResponse.json({ error: "commodity, county, state and year are required." }, { status: 400 });
  }
  const stateCode = normalizeStateCode(state);
  if (!stateCode) return NextResponse.json({ error: `Unrecognized state "${state}".` }, { status: 400 });
  const countyNorm = normalizeCountyName(county);
  const q = { commodity, county, state: stateCode };

  const readCache = async (): Promise<CacheHit | null> => {
    const { data } = await supabase
      .from("fsa_benchmark_cache")
      .select("data_year, state_code, county, commodity, practice, benchmark_yield, benchmark_price, benchmark_revenue, fetched_at, source_url")
      .eq("state_code", stateCode)
      .eq("county", countyNorm)
      .lte("data_year", year)
      .order("data_year", { ascending: false });
    return bestCacheHit((data ?? []) as CacheRow[], q);
  };
  const respond = (hit: CacheHit) =>
    NextResponse.json({
      data: {
        rows: hit.rows,
        data_year: hit.dataYear,
        requested_year: year,
        county,
        state: stateCode,
        fetched_at: hit.fetchedAt,
        file_url: hit.fileUrl,
        source_description: describeFsaFileSource({
          dataYear: hit.dataYear, requestedYear: year, county, state: stateCode, fetchedAt: hit.fetchedAt,
        }),
      },
    });

  let hit = await readCache();
  if (hit && hit.dataYear === year) return respond(hit);

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    if (hit) return respond(hit);
    return NextResponse.json({ error: "The benchmark cache cannot be refreshed (service role not configured)." }, { status: 503 });
  }
  const admin = serviceRole();
  const guardAfter = new Date(Date.now() - FETCH_GUARD_MS).toISOString();
  const { data: recentChecks } = await supabase
    .from("fsa_benchmark_fetches")
    .select("id")
    .eq("requested_year", year)
    .eq("state_code", stateCode)
    .gte("checked_at", guardAfter)
    .limit(1);
  const checkedRecently = (recentChecks ?? []).length > 0;

  let fetchError: string | null = null;
  if (!checkedRecently) {
    try {
      const pageResp = await fetch(FSA_PAGE_URL, { cache: "no-store", headers: UA });
      if (!pageResp.ok) throw new Error(`FSA program-data page returned HTTP ${pageResp.status}.`);
      const links = findBenchmarkFileLinks(await pageResp.text());
      const pick = pickBenchmarkFile(links, year);
      if (pick) {
        const { count } = await admin
          .from("fsa_benchmark_cache")
          .select("id", { count: "exact", head: true })
          .eq("data_year", pick.year)
          .eq("state_code", stateCode);
        if (!count) {
          const parsedWb = await downloadAndParseWorkbook(pick.url);
          const seen = new Set<string>();
          const stateRows = parsedWb.rows.filter((r) => {
            if (r.state_code !== stateCode) return false;
            const key = `${r.county}|${r.commodity}|${r.practice}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          const now = new Date().toISOString();
          // Validate-before-replace: the parse succeeded, now swap the slice.
          await admin.from("fsa_benchmark_cache").delete().eq("data_year", pick.year).eq("state_code", stateCode);
          for (let i = 0; i < stateRows.length; i += INSERT_CHUNK) {
            const chunk = stateRows.slice(i, i + INSERT_CHUNK).map((r) => ({
              data_year: pick.year, state_code: r.state_code, county: r.county, commodity: r.commodity,
              practice: r.practice, benchmark_yield: r.benchmark_yield, benchmark_price: r.benchmark_price,
              benchmark_revenue: r.benchmark_revenue, source_url: pick.url, fetched_at: now,
            }));
            const { error } = await admin.from("fsa_benchmark_cache").insert(chunk);
            if (error) throw new Error(`Could not cache the parsed FSA rows: ${error.message}`);
          }
        }
      }
      await admin.from("fsa_benchmark_fetches").insert({
        requested_year: year, state_code: stateCode, file_year: pick?.year ?? null, file_url: pick?.url ?? null,
      });
    } catch (e) {
      fetchError = (e as Error)?.message ?? "Could not reach fsa.usda.gov.";
      console.error(`[fsa-benchmark] ${fetchError}`);
    }
    hit = await readCache();
  }

  if (hit) return respond(hit);
  if (fetchError) {
    return NextResponse.json({ error: `FSA benchmark file lookup failed: ${fetchError}` }, { status: 502 });
  }
  return NextResponse.json({
    data: {
      rows: [], not_found: true, data_year: null, requested_year: year, county, state: stateCode,
      source_description: `No FSA benchmark-file row found for ${commodity} in ${county} County, ${stateCode}.`,
    },
  });
}
