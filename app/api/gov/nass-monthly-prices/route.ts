import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { NassError, lookupMonthly, type CommodityRow } from "@/lib/gov/nassServer";

export const maxDuration = 30;

// Monthly "prices received" from the USDA NASS Quick Stats API, the
// primary MYA source (docs/GOV_PAYMENTS_PATHWAYS.md section 1.1). Values
// come back for USER CONFIRMATION; a platform admin may POST confirmed
// months into mya_monthly_prices (RLS enforces the admin policy).

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const url = new URL(request.url);
  const slug = String(url.searchParams.get("commodity") ?? "").trim();
  const marketingYear = Number(url.searchParams.get("year"));
  if (!slug || !Number.isInteger(marketingYear)) {
    return NextResponse.json({ error: "commodity and year are required." }, { status: 400 });
  }
  const apiKey = process.env.NASS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "NASS_API_KEY is not configured. Get a free key at quickstats.nass.usda.gov/api and add it to the environment." },
      { status: 503 }
    );
  }
  const { data: commodity } = await supabase
    .from("covered_commodities")
    .select("slug, name, unit, marketing_year_start_month, lint_share, cottonseed_share")
    .eq("slug", slug)
    .maybeSingle();
  if (!commodity) return NextResponse.json({ error: "Unknown commodity." }, { status: 400 });
  try {
    const data = await lookupMonthly(apiKey, commodity as CommodityRow, marketingYear);
    return NextResponse.json({ data: { ...data, source: "nass" } });
  } catch (e) {
    if (e instanceof NassError) return NextResponse.json({ error: e.message }, { status: 502 });
    throw e;
  }
}

// Platform admins confirm months into mya_monthly_prices (RLS enforces
// the admin policy; a non-admin gets a permission error).
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const slug = String(body?.commodity ?? "");
  const marketingYear = Number(body?.year);
  const months = Array.isArray(body?.months) ? body.months : [];
  if (!slug || !Number.isInteger(marketingYear) || months.length === 0) {
    return NextResponse.json({ error: "commodity, year and months are required." }, { status: 400 });
  }
  const rows = months
    .map((m: { month: unknown; year: unknown; price: unknown; note?: unknown; source?: unknown }) => ({
      commodity: slug,
      marketing_year: marketingYear,
      month: Number(m.month),
      year: Number(m.year),
      price: Number(m.price),
      note: m.note ? String(m.note) : null,
      source: m.source === "manual" ? "manual" : "usda",
    }))
    .filter((r: { month: number; price: number }) => Number.isInteger(r.month) && Number.isFinite(r.price));
  const { error } = await supabase
    .from("mya_monthly_prices")
    .upsert(rows, { onConflict: "commodity,marketing_year,month" });
  if (error) return NextResponse.json({ error: error.message }, { status: 403 });
  return NextResponse.json({ saved: rows.length });
}
