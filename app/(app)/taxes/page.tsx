import { requireOrg } from "@/lib/auth";
import TaxStatusClient from "./TaxStatusClient";

export const metadata = { title: "Taxes" };

export default async function TaxesPage() {
  const { supabase, profile } = await requireOrg();

  const [
    { data: parcels },
    { data: properties },
    { data: statements },
    { data: payments },
    { data: entities },
  ] = await Promise.all([
    supabase
      .from("parcels")
      .select("id, parcel_number, county, property_id, acres")
      .order("parcel_number"),
    supabase.from("properties").select("id, name, entity_id").order("name"),
    supabase.from("tax_statements").select("*").order("tax_year", { ascending: false }),
    supabase.from("tax_payments").select("*").order("paid_date"),
    supabase.from("entities").select("id, name").order("name"),
  ]);

  return (
    <TaxStatusClient
      orgId={profile.organization_id!}
      parcels={parcels ?? []}
      properties={properties ?? []}
      initialStatements={statements ?? []}
      initialPayments={payments ?? []}
      entities={entities ?? []}
    />
  );
}
