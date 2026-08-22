import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import { formatAcres, formatDollars } from "@/lib/format";
import { allocateByLines } from "@/lib/tax";
import {
  ActionLink,
  DetailsCard,
  MapThumb,
  RelatedSection,
  SummaryHeader,
} from "@/components/summary/Summary";
import EntityDocuments from "@/components/documents/EntityDocuments";
import RowEditor from "@/components/lists/RowEditor";
import ParcelIdentifiers, { type ParcelIdentifierRow } from "@/components/parcels/ParcelIdentifiers";

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
      // This parcel's LINES with their statement headers (migration 0030).
      supabase
        .from("tax_statement_lines")
        .select("id, tax_year, tax_due, tax_statement_id, tax_statements(id, amount_due, due_date, county, account_number)")
        .eq("parcel_id", id)
        .order("tax_year", { ascending: false }),
      supabase.from("tax_payments").select("tax_statement_id, amount"),
    ]);

  // Paid on each statement, then this parcel's share by its line's
  // part of the statement's lines.
  const paidByStatement = new Map<string, number>();
  for (const p of taxPayments ?? []) {
    paidByStatement.set(
      p.tax_statement_id,
      (paidByStatement.get(p.tax_statement_id) ?? 0) + p.amount
    );
  }
  const statementIds = [...new Set((statements ?? []).map((l) => l.tax_statement_id))];
  const { data: siblingLines } = statementIds.length
    ? await supabase.from("tax_statement_lines").select("id, tax_statement_id, tax_due").in("tax_statement_id", statementIds)
    : { data: [] as Array<{ id: string; tax_statement_id: string; tax_due: number }> };
  const paidShareByLine = new Map<string, number>();
  for (const sid of statementIds) {
    const lines = (siblingLines ?? []).filter((l) => l.tax_statement_id === sid);
    const shares = allocateByLines(paidByStatement.get(sid) ?? 0, lines);
    for (const [lineId, amt] of shares) paidShareByLine.set(lineId, amt);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
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
      <ParcelIdentifiers parcelId={id} orgId={profile.organization_id!} initial={((await supabase.from("parcel_identifiers").select("id, kind, label, value, source, last_seen_at").eq("parcel_id", id).order("kind")).data ?? []) as ParcelIdentifierRow[]} />

      {(statements ?? []).length > 0 ? (
        <RelatedSection title="Tax statements">
          <ul className="space-y-2">
            {(statements ?? []).map((l) => {
              const header = Array.isArray(l.tax_statements) ? l.tax_statements[0] : l.tax_statements;
              const paid = paidShareByLine.get(l.id) ?? 0;
              return (
                <li
                  key={l.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                >
                  <Link
                    href={`/taxes?year=${l.tax_year}`}
                    className="font-medium text-gray-900 hover:underline"
                  >
                    {l.tax_year}
                  </Link>
                  <span className="text-gray-500">
                    {header?.county ? `${header.county} · ` : ""}due {header?.due_date ?? "n/a"}
                    {header?.account_number ? ` · account ${header.account_number}` : ""}
                  </span>
                  <span className="ml-auto tabular-nums text-gray-700">
                    {formatDollars(l.tax_due)} this parcel
                    {header && Math.abs(header.amount_due - l.tax_due) > 0.005
                      ? ` of ${formatDollars(header.amount_due)} on the statement`
                      : ""}
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
