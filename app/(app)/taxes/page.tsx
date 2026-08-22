import { Suspense } from "react";
import { requireOrg } from "@/lib/auth";
import TaxStatusClient from "./TaxStatusClient";

export const metadata = { title: "Property Taxes" };

// Statements are HEADERS (how the county billed) with LINES (the
// parcels on the bill, migration 0030). Completeness keys off lines.
export default async function TaxesPage() {
  const { supabase, profile } = await requireOrg();

  const [
    { data: parcels },
    { data: properties },
    { data: statements },
    { data: lines },
    { data: payments },
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

  return (
    <Suspense fallback={<div className="p-6 text-sm text-gray-500">Loading...</div>}>
      <TaxStatusClient
        orgId={profile.organization_id!}
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
