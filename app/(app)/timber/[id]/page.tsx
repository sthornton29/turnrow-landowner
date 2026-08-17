import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import { formatAcres } from "@/lib/format";
import { STAND_TYPE_LABELS } from "@/lib/assetTypes";
import {
  ActionLink,
  DetailsCard,
  MapThumb,
  RelatedSection,
  SummaryHeader,
} from "@/components/summary/Summary";
import EntityDocuments from "@/components/documents/EntityDocuments";
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

  const [{ data: property }, { data: saleLinks }, { data: sales }] =
    await Promise.all([
      supabase
        .from("properties")
        .select("id, name")
        .eq("id", stand.property_id)
        .single(),
      supabase.from("timber_sale_stands").select("timber_sale_id, timber_stand_id"),
      supabase.from("timber_sales").select("id, sale_name, status, sale_type"),
    ]);
  const saleIds = new Set(
    (saleLinks ?? []).filter((l) => l.timber_stand_id === id).map((l) => l.timber_sale_id)
  );
  const linkedSales = (sales ?? []).filter((s) => saleIds.has(s.id));

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
        <RelatedSection title="Timber sales">
          <ul className="space-y-2">
            {linkedSales.map((s) => (
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
                </span>
              </li>
            ))}
          </ul>
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
