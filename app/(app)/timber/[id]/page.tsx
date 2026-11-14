import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import { formatAcres, formatDollars } from "@/lib/format";
import {
  MANAGEMENT_GOAL_LABELS,
  STAND_TYPE_LABELS,
} from "@/lib/assetTypes";
import { lastYearOf } from "@/lib/standActivities";
import { planForStand } from "@/lib/timberPlan";
import { activitiesForStand, loadStandActivities } from "@/lib/timberRecords";
import StandTimeline from "@/components/timber/StandTimeline";
import {
  allocateAmount,
  allocationShares,
  resolveSettlementShares,
  type AllocationMethod,
  type SettlementAllocation,
} from "@/lib/timberAllocation";
import {
  ActionLink,
  DetailsCard,
  MapThumb,
  RelatedSection,
  SummaryHeader,
} from "@/components/summary/Summary";
import EntityDocuments from "@/components/documents/EntityDocuments";
import DocumentLinks from "@/components/documents/DocumentLinks";
import RowEditor from "@/components/lists/RowEditor";

export const metadata = { title: "Timber stand" };

export default async function TimberStandSummaryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, profile } = await requireOrg();

  const { data: stand } = await supabase
    .from("timber_stands_geo")
    .select("*")
    .eq("id", id)
    .single();
  if (!stand) notFound();

  const [
    { data: property },
    { data: saleLinks },
    { data: sales },
    { data: allStands },
    { data: settlements },
    { data: payments },
    { data: propertyStands },
    { data: propertySales },
  ] = await Promise.all([
    supabase
      .from("properties")
      .select("id, name")
      .eq("id", stand.property_id)
      .single(),
    supabase
      .from("timber_sale_stands")
      .select("timber_sale_id, timber_stand_id, allocation_pct"),
    supabase
      .from("timber_sales")
      .select("id, sale_name, status, sale_type, delivered_net, allocation_method"),
    supabase.from("timber_stands").select("id, acres"),
    supabase
      .from("timber_settlements")
      .select("timber_sale_id, total_amount, allocation"),
    supabase.from("payments").select("timber_sale_id, amount"),
    supabase
      .from("timber_stands")
      .select("id, name, acres, year_established")
      .eq("property_id", stand.property_id)
      .order("name"),
    supabase.from("timber_sales").select("id, sale_name").order("sale_name"),
  ]);
  // Stage 1 timber records (migration 0045): this stand's history and
  // the schedule generated from it.
  const activities = activitiesForStand(
    await loadStandActivities(supabase, [id]),
    id
  );
  const nowYear = new Date().getFullYear();
  // Cost-share contracts on this property (migration 0047), for linking
  // a cost to the program that helped pay it. Empty if the table is
  // missing.
  const { data: awards } = await supabase
    .from("cost_share_awards")
    .select("id, title")
    .eq("property_id", stand.property_id)
    .order("title");
  const recs = planForStand(stand, activities, nowYear);
  const lastThin = lastYearOf(activities, ["thinning"], stand.last_thinning_year);
  const lastBurn = lastYearOf(activities, ["prescribed_burn"], stand.last_burn_year);
  const plantYear = lastYearOf(activities, ["planting"], stand.year_established);
  // Sales this property's stands are part of (timber_sales has no
  // property column; it reaches land through timber_sale_stands).
  const propertyStandIds = new Set((propertyStands ?? []).map((s) => s.id));
  const propertySaleIds = new Set(
    (saleLinks ?? [])
      .filter((l) => propertyStandIds.has(l.timber_stand_id))
      .map((l) => l.timber_sale_id)
  );
  // The linked sales' documents (contracts, settlements) surface here
  // too: a stand's paperwork is findable from the stand.
  const { data: saleDocs } = await supabase
    .from("documents")
    .select("id, entity_id, file_name, title, doc_type, storage_path")
    .eq("entity_type", "timber_sale");
  const saleIds = new Set(
    (saleLinks ?? []).filter((l) => l.timber_stand_id === id).map((l) => l.timber_sale_id)
  );
  const linkedSales = (sales ?? []).filter((s) => saleIds.has(s.id));

  // Allocated timber income: dollars received on each linked sale,
  // split across its stands by the sale's allocation method (each
  // settlement may carry its own override). lib/timberAllocation.ts.
  const acresByStand = new Map((allStands ?? []).map((s) => [s.id, s.acres]));
  const allocatedBySale = new Map<string, number | null>();
  for (const sale of linkedSales) {
    const links = (saleLinks ?? []).filter((l) => l.timber_sale_id === sale.id);
    const saleStands = links.map((l) => ({
      id: l.timber_stand_id,
      acres: acresByStand.get(l.timber_stand_id) ?? null,
      allocation_pct: l.allocation_pct,
    }));
    const method = (sale.allocation_method ?? "by_acres") as AllocationMethod;
    let allocated = 0;
    let anyShares = false;
    // A sale's money counts whichever way it was recorded (settlements
    // and payments both), whatever the sale type says today.
    for (const s of (settlements ?? []).filter(
      (x) => x.timber_sale_id === sale.id
    )) {
      const shares = resolveSettlementShares(
        method,
        saleStands,
        s.allocation as SettlementAllocation | null
      );
      if (shares.length > 0) anyShares = true;
      allocated +=
        allocateAmount(s.total_amount ?? 0, shares).find(
          (a) => a.standId === id
        )?.amount ?? 0;
    }
    const received = (payments ?? [])
      .filter((p) => p.timber_sale_id === sale.id)
      .reduce((sum, p) => sum + (p.amount ?? 0), 0);
    if (received > 0 || sale.sale_type !== "pay_as_cut") {
      const shares = allocationShares(method, saleStands);
      if (shares.length > 0) anyShares = true;
      allocated +=
        allocateAmount(received, shares).find((a) => a.standId === id)?.amount ??
        0;
    }
    allocatedBySale.set(sale.id, anyShares ? Math.round(allocated * 100) / 100 : null);
  }
  const allocatedTotal = Array.from(allocatedBySale.values()).reduce<number>(
    (sum, v) => sum + (v ?? 0),
    0
  );

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <SummaryHeader
        typeLabel={
          stand.stand_type
            ? (STAND_TYPE_LABELS[stand.stand_type] ?? "Timber stand")
            : "Timber stand"
        }
        name={stand.name}
        keyFigure={`${formatAcres(stand.acres)} acres`}
        breadcrumb={[
          { href: "/properties", label: "Properties" },
          ...(property
            ? [{ href: `/properties/${property.id}`, label: property.name }]
            : []),
          { href: `/timber/${id}`, label: stand.name },
        ]}
        actions={
          <ActionLink href={`/map?focus=timber_stand:${id}`} primary>
            View on map
          </ActionLink>
        }
      />

      <MapThumb geometry={stand.boundary_geojson} focus={`timber_stand:${id}`} />

      <DetailsCard
        rows={[
          ["Acres", formatAcres(stand.acres)],
          [
            "Stand type",
            stand.stand_type ? STAND_TYPE_LABELS[stand.stand_type] : null,
          ],
          ["Species", stand.species],
          [
            "Planted or established",
            plantYear != null
              ? `${plantYear} (age ${Math.max(0, nowYear - plantYear)})`
              : null,
          ],
          ["Trees per acre planted", stand.tpa_planted?.toLocaleString("en-US") ?? null],
          [
            "Site index",
            stand.site_index != null
              ? `${stand.site_index}${stand.site_index_base_age ? ` (base ${stand.site_index_base_age})` : ""}`
              : null,
          ],
          [
            "Main goal",
            stand.management_goal ? (MANAGEMENT_GOAL_LABELS[stand.management_goal] ?? null) : null,
          ],
          ["Last thinning", lastThin?.toString() ?? null],
          ["Last prescribed burn", lastBurn?.toString() ?? null],
          ["Notes", stand.notes],
        ]}
      />
      <RowEditor entityType="timber_stand" row={stand} />

      <StandTimeline
        orgId={profile.organization_id!}
        standId={id}
        propertyId={stand.property_id}
        stands={propertyStands ?? []}
        sales={(propertySales ?? []).filter((s) => propertySaleIds.has(s.id))}
        awards={awards ?? []}
        activities={activities}
        recs={recs}
      />

      {linkedSales.length > 0 ? (
        <RelatedSection title="Timber sales and allocated income">
          <ul className="space-y-2">
            {linkedSales.map((s) => {
              const allocated = allocatedBySale.get(s.id);
              return (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                >
                  <Link
                    href={`/timber-sales/${s.id}`}
                    className="font-medium text-gray-900 hover:underline"
                  >
                    {s.sale_name}
                  </Link>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs capitalize text-gray-600">
                    {s.status}
                  </span>
                  <span className="text-gray-500">
                    {s.sale_type === "lump_sum" ? "Lump sum" : "Pay as cut"}
                    {s.delivered_net ? " · delivered (net)" : ""}
                  </span>
                  <span className="ml-auto text-gray-700">
                    {allocated !== null && allocated !== undefined
                      ? `${formatDollars(allocated)} allocated to this stand`
                      : "Income kept at sale level (not allocated)"}
                  </span>
                  <DocumentLinks
                    docs={(saleDocs ?? []).filter((d) => d.entity_id === s.id)}
                  />
                </li>
              );
            })}
          </ul>
          {allocatedTotal > 0 ? (
            <p className="mt-2 text-sm font-medium text-pine-900">
              Allocated timber income to date: {formatDollars(allocatedTotal)}
            </p>
          ) : null}
        </RelatedSection>
      ) : null}

      <RelatedSection title="Documents and photos">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <EntityDocuments
            orgId={profile.organization_id!}
            entityType="timber_stand"
            entityId={id}
          />
        </div>
      </RelatedSection>
    </div>
  );
}
