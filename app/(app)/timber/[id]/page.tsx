import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import { formatAcres, formatDollars } from "@/lib/format";
import { STAND_TYPE_LABELS } from "@/lib/assetTypes";
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
  ]);
  // The linked sales' documents (contracts, settlements) surface here
  // too: a stand's paperwork is findable from the stand.
  const { data: saleDocs } = await supabase
    .from("documents")
    .select("id, entity_id, file_name, storage_path")
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
    if (sale.sale_type === "pay_as_cut") {
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
    } else {
      const received = (payments ?? [])
        .filter((p) => p.timber_sale_id === sale.id)
        .reduce((sum, p) => sum + (p.amount ?? 0), 0);
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
    <div className="mx-auto max-w-4xl space-y-5 p-4 md:p-6">
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
          ["Year established", stand.year_established?.toString() ?? null],
          ["Site index", stand.site_index?.toString() ?? null],
          ["Last thinning", stand.last_thinning_year?.toString() ?? null],
          ["Last prescribed burn", stand.last_burn_year?.toString() ?? null],
          ["Notes", stand.notes],
        ]}
      />
      <RowEditor entityType="timber_stand" row={stand} />

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
