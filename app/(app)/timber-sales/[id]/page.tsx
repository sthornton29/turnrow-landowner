import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import { effectiveStage } from "@/lib/timberSaleSteps";
import SaleSteps, { type StepsBid, type StepsCost } from "@/components/timber/SaleSteps";
import TimberSaleDetail from "./TimberSaleDetail";

export const metadata = { title: "Timber sale" };

export default async function TimberSaleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, profile } = await requireOrg();

  const [{ data: sale }, { data: tenants }, { data: stands }] = await Promise.all([
    supabase.from("timber_sales").select("*").eq("id", id).single(),
    supabase.from("tenants").select("id, name").order("name"),
    supabase
      .from("timber_stands")
      .select("id, property_id, name, acres, last_thinning_year")
      .order("name"),
  ]);
  if (!sale) notFound();

  // Sale steps (migration 0048). Queries for the new tables degrade to
  // empty so the page still renders if the migration is missing.
  const [
    { data: links },
    { data: bids },
    { data: costs },
    { data: settlements },
    { data: payments },
    { data: properties },
    { data: accounts },
  ] = await Promise.all([
    supabase.from("timber_sale_stands").select("timber_stand_id").eq("timber_sale_id", id),
    supabase.from("timber_sale_bids").select("id, bidder, amount, received_date, is_winner").eq("timber_sale_id", id),
    supabase
      .from("timber_costs")
      .select("id, paid_date, amount, vendor, description, property_id")
      .eq("timber_sale_id", id)
      .eq("tax_category", "selling_expense")
      .order("paid_date"),
    supabase.from("timber_settlements").select("total_amount").eq("timber_sale_id", id),
    supabase.from("payments").select("amount").eq("timber_sale_id", id),
    supabase.from("properties").select("id, name"),
    supabase.from("timber_accounts").select("id, property_id"),
  ]);
  const standProp = new Map((stands ?? []).map((s) => [s.id, s.property_id]));
  const standsByProperty: Record<string, string[]> = {};
  for (const l of links ?? []) {
    const pid = standProp.get(l.timber_stand_id);
    if (!pid) continue;
    standsByProperty[pid] = [...(standsByProperty[pid] ?? []), l.timber_stand_id];
  }
  const saleProperties = (properties ?? []).filter((p) => standsByProperty[p.id]);
  const accountByProperty: Record<string, string | null> = {};
  for (const p of saleProperties) accountByProperty[p.id] = (accounts ?? []).find((a) => a.property_id === p.id)?.id ?? null;
  const received =
    (settlements ?? []).reduce((s, x) => s + (Number(x.total_amount) || 0), 0) +
    (payments ?? []).reduce((s, x) => s + (Number(x.amount) || 0), 0);

  const workflow = (
    <SaleSteps
      orgId={profile.organization_id!}
      sale={{
        id: sale.id,
        harvest_type: sale.harvest_type ?? null,
        stage: effectiveStage(sale, (settlements ?? []).length > 0),
        checklist: (sale.checklist as Record<string, string>) ?? {},
        forester_name: sale.forester_name ?? null,
        forester_fee_pct: sale.forester_fee_pct ?? null,
        min_bid: sale.min_bid ?? null,
        bid_date: sale.bid_date ?? null,
        harvest_start: sale.harvest_start ?? null,
        harvest_end: sale.harvest_end ?? null,
        closeout_date: sale.closeout_date ?? null,
        deposit_returned_date: sale.deposit_returned_date ?? null,
        reforestation_due: sale.reforestation_due ?? null,
        form_1099s_received: !!sale.form_1099s_received,
        form_1099s_amount: sale.form_1099s_amount ?? null,
      }}
      bids={(bids ?? []) as StepsBid[]}
      costs={(costs ?? []) as StepsCost[]}
      received={Math.round(received * 100) / 100}
      properties={saleProperties}
      standsByProperty={standsByProperty}
      accountByProperty={accountByProperty}
    />
  );

  return (
    <TimberSaleDetail
      orgId={profile.organization_id!}
      sale={sale}
      tenants={tenants ?? []}
      allStands={stands ?? []}
      workflow={workflow}
    />
  );
}
