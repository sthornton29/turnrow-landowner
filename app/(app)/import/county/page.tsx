import { requireOrg } from "@/lib/auth";
import CountyImportClient from "./CountyImportClient";

export const metadata = { title: "Import from county records" };

export default async function CountyImportPage() {
  const { supabase, profile } = await requireOrg();

  const [{ data: services }, { data: properties }, { data: parcels }] =
    await Promise.all([
      supabase
        .from("county_gis_services")
        .select("*")
        .eq("status", "active")
        .order("state")
        .order("county"),
      supabase.from("properties").select("id, name, county").order("name"),
      supabase.from("parcels").select("id, parcel_number, county, property_id"),
    ]);

  return (
    <CountyImportClient
      orgId={profile.organization_id!}
      services={services ?? []}
      properties={properties ?? []}
      existingParcels={parcels ?? []}
    />
  );
}
