import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import { formatAcres, formatDollars } from "@/lib/format";
import {
  ActionLink,
  DetailsCard,
  MapThumb,
  RelatedSection,
  SummaryHeader,
} from "@/components/summary/Summary";
import EntityDocuments from "@/components/documents/EntityDocuments";
import RowEditor from "@/components/lists/RowEditor";

export const metadata = { title: "Parcel" };

export default async function ParcelSummaryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, profile } = await requireOrg();

  const { data: parcel } = await supabase
    .from("parcels_geo")
    .select("*")
    .eq("id", id)
    .single();
  if (!parcel) notFound();

  const [{ data: property }, { data: statements }, { data: taxPayments }] =
    await Promise.all([
      supabase
        .from("properties")
        .select("id, name")
        .eq("id", parcel.property_id)
        .single(),
      supabase
        .from("tax_statements")
        .select("id, tax_year, amount_due, due_date")
        .eq("parcel_id", id)
        .order("tax_year", { ascending: false }),
      supabase.from("tax_payments").select("tax_statement_id, amount"),
    ]);

  const paidByStatement = new Map<string, number>();
  for (const p of taxPayments ?? []) {
    paidByStatement.set(
      p.tax_statement_id,
      (paidByStatement.get(p.tax_statement_id) ?? 0) + p.amount
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 md:p-6">
      <SummaryHeader
        typeLabel="Parcel"
        name={`Parcel ${parcel.parcel_number}`}
        keyFigure={`${formatAcres(parcel.acres)} acres${parcel.deeded_acres != null ? ` (deeded ${formatAcres(parcel.deeded_acres)})` : ""}`}
        breadcrumb={[
          { href: "/properties", label: "Properties" },
          ...(property
            ? [{ href: `/properties/${property.id}`, label: property.name }]
            : []),
          { href: `/parcels/${id}`, label: `Parcel ${parcel.parcel_number}` },
        ]}
        actions={
          <ActionLink href={`/map?focus=parcel:${id}`} primary>
            View on map
          </ActionLink>
        }
      />

      <MapThumb geometry={parcel.boundary_geojson} focus={`parcel:${id}`} />

      <DetailsCard
        rows={[
          ["Acres (GIS)", formatAcres(parcel.acres)],
          [
            "Deeded acres",
            parcel.deeded_acres != null ? formatAcres(parcel.deeded_acres) : null,
          ],
          ["County", parcel.county],
          ["Source", parcel.source],
          ["Notes", parcel.notes],
        ]}
      />
      <RowEditor entityType="parcel" row={parcel} />

      {(statements ?? []).length > 0 ? (
        <RelatedSection title="Tax statements">
          <ul className="space-y-2">
            {(statements ?? []).map((s) => {
              const paid = paidByStatement.get(s.id) ?? 0;
              return (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                >
                  <Link
                    href={`/taxes?year=${s.tax_year}`}
                    className="font-medium text-gray-900 hover:underline"
                  >
                    {s.tax_year}
                  </Link>
                  <span className="text-gray-500">due {s.due_date ?? "n/a"}</span>
                  <span className="ml-auto tabular-nums text-gray-700">
                    {formatDollars(s.amount_due)} due
                    {paid > 0 ? ` · ${formatDollars(paid)} paid` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </RelatedSection>
      ) : null}

      <RelatedSection title="Documents and photos">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <EntityDocuments
            orgId={profile.organization_id!}
            entityType="parcel"
            entityId={id}
          />
        </div>
      </RelatedSection>
    </div>
  );
}
