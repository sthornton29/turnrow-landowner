import { requireAdmin } from "@/lib/auth";
import NewLeaseClient from "./NewLeaseClient";

export const metadata = { title: "New lease" };

export default async function NewLeasePage() {
  // Creating a lease is admin work (row level security refuses it for
  // anyone else, migration 0034): other members go back to the list.
  const { supabase, profile } = await requireAdmin("/leases");
  const [{ data: tenants }, { data: properties }, { data: parcels }] =
    await Promise.all([
      supabase.from("tenants").select("id, name, farm_connection_id").order("name"),
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
