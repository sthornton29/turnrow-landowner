import { Suspense } from "react";
import { requireOrg } from "@/lib/auth";
import TaxStatusClient from "./TaxStatusClient";

export const metadata = { title: "Property Taxes" };

// Statements are HEADERS (how the county billed) with LINES (the
// parcels on the bill, migration 0030). Completeness keys off lines.
export default async function TaxesPage() {
  const { supabase, profile } = await requireOrg();

  const [
    { data: parcels, error: parcelsErr },
    { data: properties, error: propertiesErr },
    { data: statements, error: statementsErr },
    { data: lines, error: linesErr },
    { data: payments, error: paymentsErr },
    { data: entities },
  ] = await Promise.all([
    supabase
      .from("parcels")
      .select("id, parcel_number, county, property_id, acres")
      .order("parcel_number"),
    supabase.from("properties").select("id, name, entity_id").order("name"),
    supabase.from("tax_statements").select("*").order("tax_year", { ascending: false }),
    supabase.from("tax_statement_lines").select("*").order("line_no"),
    supabase.from("tax_payments").select("*").order("paid_date"),
    supabase.from("entities").select("id, name").order("name"),
  ]);

  // A failed read must not look like "no statements, $0.00 due".
  if (parcelsErr || propertiesErr || statementsErr || linesErr || paymentsErr) {
    return (
      <div className="mx-auto max-w-5xl space-y-3 p-4 md:p-6">
        <h1 className="text-xl font-semibold text-gray-900">Property Taxes</h1>
        <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Could not load the tax records, so nothing is shown. Reload the page to try again. Nothing was changed.
        </p>
      </div>
    );
  }

  return (
    <Suspense fallback={<div className="p-6 text-sm text-gray-500">Loading...</div>}>
      <TaxStatusClient
        orgId={profile.organization_id!}
        canUpload={profile.role === "admin"}
        parcels={parcels ?? []}
        properties={properties ?? []}
        initialStatements={statements ?? []}
        initialLines={lines ?? []}
        initialPayments={payments ?? []}
        entities={entities ?? []}
      />
    </Suspense>
  );
}
