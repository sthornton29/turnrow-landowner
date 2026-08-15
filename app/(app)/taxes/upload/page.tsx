import { requireOrg } from "@/lib/auth";
import TaxUploadClient from "./TaxUploadClient";

export const metadata = { title: "Upload tax statements" };

export default async function TaxUploadPage() {
  const { supabase, profile } = await requireOrg();

  const [{ data: parcels }, { data: properties }, { data: defaults }] =
    await Promise.all([
      supabase
        .from("parcels")
        .select("id, parcel_number, county, property_id")
        .order("parcel_number"),
      supabase.from("properties").select("id, name").order("name"),
      supabase.from("county_tax_defaults").select("*"),
    ]);

  return (
    <TaxUploadClient
      orgId={profile.organization_id!}
      parcels={parcels ?? []}
      properties={properties ?? []}
      countyDefaults={defaults ?? []}
    />
  );
}
