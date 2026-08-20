import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { estimateMyaBlend, describeMyaComposition } from "@/lib/gov/myaEstimate";
import { lookupMonthly, type CommodityRow } from "@/lib/gov/nassServer";

export const maxDuration = 30;

// Blended MYA estimate per commodity x program year from NASS published
// months (docs/GOV_PAYMENTS_PATHWAYS.md 1.2; no futures feed, so published
// months only). Returns the estimate for display; persists
// mya_price_estimate via the service role ONLY when the stored row is not
// manual and has no final (the write rule from the handoff doc). Confirmed
// months already in mya_monthly_prices take precedence over the live
// NASS pull for the same month.

function serviceRole() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const programYear = Number(body?.program_year);
  const slugs: string[] = Array.isArray(body?.commodities) ? body.commodities.map(String) : [];
  if (!Number.isInteger(programYear)) {
    return NextResponse.json({ error: "program_year is required." }, { status: 400 });
  }
  const { data: me } = await supabase
    .from("profiles")
    .select("is_platform_admin")
    .eq("id", user.id)
    .maybeSingle();
  const canPersist = !!me?.is_platform_admin;
  const { data: commodities } = await supabase
    .from("covered_commodities")
    .select("slug, name, unit, marketing_year_start_month, lint_share, cottonseed_share, mya_month_weights")
    .in("slug", slugs.length > 0 ? slugs : ["corn", "soybeans", "wheat"]);
  const { data: stored } = await supabase
    .from("mya_monthly_prices")
    .select("commodity, month, price")
    .eq("marketing_year", programYear);

  const apiKey = process.env.NASS_API_KEY ?? null;
  const estimates: Array<{
    commodity: string;
    estimate: number | null;
    publishedCount: number;
    missingCount: number;
    composition: string;
    source_description: string | null;
    persisted: boolean;
  }> = [];
  let persistNote: string | null = null;

  for (const c of (commodities ?? []) as Array<CommodityRow & { mya_month_weights: number[] | null }>) {
    const confirmed = ((stored ?? []) as Array<{ commodity: string; month: number; price: number }>)
      .filter((r) => r.commodity === c.slug)
      .map((r) => ({ month: Number(r.month), price: Number(r.price) }));
    let live: Array<{ month: number; price: number }> = [];
    let sourceDescription: string | null = null;
    if (apiKey) {
      try {
        const r = await lookupMonthly(apiKey, c, programYear);
        live = r.monthly_prices.filter((m) => m.price != null).map((m) => ({ month: m.month, price: m.price as number }));
        sourceDescription = r.source_description;
      } catch (e) {
        sourceDescription = (e as Error).message;
      }
    } else {
      sourceDescription = "NASS_API_KEY is not configured; using confirmed months only.";
    }
    const byMonth = new Map<number, number>();
    for (const m of live) byMonth.set(m.month, m.price);
    for (const m of confirmed) byMonth.set(m.month, m.price); // confirmed wins
    const blend = estimateMyaBlend({
      commodityName: c.name,
      marketingYearStartMonth: Number(c.marketing_year_start_month),
      cropYear: programYear,
      monthlyPrices: Array.from(byMonth, ([month, price]) => ({ month, price })),
      weights: Array.isArray(c.mya_month_weights) ? c.mya_month_weights : null,
    });
    let persisted = false;
    if (canPersist && blend.estimate != null && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      try {
        const admin = serviceRole();
        const { data: existing } = await admin
          .from("arc_plc_price_data")
          .select("id, source, mya_price_final")
          .eq("commodity", c.slug)
          .eq("program_year", programYear)
          .maybeSingle();
        const stamp = new Date().toISOString();
        if (!existing) {
          await admin.from("arc_plc_price_data").insert({
            commodity: c.slug, program_year: programYear, mya_price_estimate: blend.estimate,
            source: "estimate", updated_at: stamp, note: describeMyaComposition(blend),
          });
          persisted = true;
        } else if (existing.source !== "manual" && existing.mya_price_final == null) {
          await admin
            .from("arc_plc_price_data")
            .update({ mya_price_estimate: blend.estimate, updated_at: stamp, note: describeMyaComposition(blend) })
            .eq("id", existing.id);
          persisted = true;
        }
      } catch (e) {
        persistNote = (e as Error).message;
      }
    }
    estimates.push({
      commodity: c.slug,
      estimate: blend.estimate,
      publishedCount: blend.publishedCount,
      missingCount: blend.missingCount,
      composition: describeMyaComposition(blend),
      source_description: sourceDescription,
      persisted,
    });
  }
  return NextResponse.json({ program_year: programYear, estimates, note: persistNote });
}
