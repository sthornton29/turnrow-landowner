import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
  RMA_COMMODITY_CODES,
  STATE_FIPS,
  offerToCache,
  parseRmaRevenuePrices,
  pickPrimaryRow,
  rmaCacheIsStale,
  rmaServiceUrl,
  type RmaCachedData,
} from "@/lib/rma";

// RMA benchmark prices for lease pricing. Global cache with lazy
// refresh (rmaCacheIsStale: daily while a window is active, weekly
// idle) and write-then-swap: a failed or malformed fetch NEVER blanks
// previously good data; a genuine zero-offer result is data and caches
// normally. The cache table has no client write policies; writes go
// through the service role here.

const FETCH_TIMEOUT_MS = 10000;

function serviceRole() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json();
  const crop = String(body.crop ?? "").toLowerCase().trim();
  const state = String(body.state ?? "").toUpperCase().trim();
  const year = Number(body.year);
  if (!RMA_COMMODITY_CODES[crop]) {
    return NextResponse.json(
      { error: `RMA benchmark prices cover corn, soybeans, wheat, cotton, and canola; "${crop}" is not mapped.` },
      { status: 400 }
    );
  }
  if (!STATE_FIPS[state]) {
    return NextResponse.json({ error: `Unknown state "${state}".` }, { status: 400 });
  }
  if (!year || year < 2000 || year > 2100) {
    return NextResponse.json({ error: "Invalid year." }, { status: 400 });
  }

  const { data: cached } = await supabase
    .from("rma_price_cache")
    .select("data, fetched_at")
    .eq("crop", crop)
    .eq("state", state)
    .eq("commodity_year", year)
    .maybeSingle();

  const now = new Date();
  const fresh =
    cached && !rmaCacheIsStale(cached.data as RmaCachedData, cached.fetched_at, now);
  if (fresh) {
    return NextResponse.json({
      ...(cached.data as RmaCachedData),
      fetched_at: cached.fetched_at,
      stale: false,
    });
  }

  // Refresh; on any failure fall back to the cached value with an
  // honest stale flag instead of blanking it.
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(rmaServiceUrl(year, crop, state), {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!response.ok) throw new Error(`RMA returned HTTP ${response.status}`);
    const offers = parseRmaRevenuePrices(await response.text());
    const data = offerToCache(pickPrimaryRow(offers, crop), crop);

    const fetchedAt = now.toISOString();
    await serviceRole()
      .from("rma_price_cache")
      .upsert(
        { crop, state, commodity_year: year, data, fetched_at: fetchedAt },
        { onConflict: "crop,state,commodity_year" }
      );
    return NextResponse.json({ ...data, fetched_at: fetchedAt, stale: false });
  } catch (err) {
    if (cached) {
      return NextResponse.json({
        ...(cached.data as RmaCachedData),
        fetched_at: cached.fetched_at,
        stale: true,
        stale_reason:
          err instanceof Error ? err.message : "The RMA service is unreachable.",
      });
    }
    return NextResponse.json(
      {
        error:
          "Could not reach the USDA RMA price service and no cached value exists yet. Try again in a few minutes.",
      },
      { status: 502 }
    );
  }
}
