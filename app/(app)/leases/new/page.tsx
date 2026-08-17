import { requireOrg } from "@/lib/auth";
import NewLeaseClient from "./NewLeaseClient";

export const metadata = { title: "New lease" };

export default async function NewLeasePage() {
  const { supabase, profile } = await requireOrg();
  const [{ data: tenants }, { data: properties }, { data: parcels }] =
    await Promise.all([
      supabase.from("tenants").select("id, name").order("name"),
      supabase
        .from("properties")
        .select("id, name, county, state, acres, fsa_numbers")
        .order("name"),
      supabase.from("parcels").select("property_id, parcel_number"),
    ]);

  return (
    <NewLeaseClient
      orgId={profile.organization_id!}
      tenants={tenants ?? []}
      properties={properties ?? []}
      parcels={parcels ?? []}
    />
  );
}
