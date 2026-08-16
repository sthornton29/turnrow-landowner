import { requireOrg } from "@/lib/auth";
import CountyImportClient from "./CountyImportClient";

export const metadata = { title: "Import from county records" };

export default async function CountyImportPage() {
  const { supabase, profile } = await requireOrg();

  const [{ data: services }, { data: properties }, { data: parcels }, { data: aliases }] =
    await Promise.all([
      supabase
        .from("county_gis_services")
        .select("*")
        .eq("status", "active")
        .order("state")
        .order("county"),
      supabase.from("properties").select("id, name, county").order("name"),
      supabase.from("parcels").select("id, parcel_number, county, property_id"),
      supabase
        .from("owner_aliases")
        .select("normalized_alias, owner_entity_id, owner_entities(display_name)"),
    ]);

  const knownAliases = (aliases ?? []).map((a) => ({
    normalized_alias: a.normalized_alias as string,
    owner_entity_id: a.owner_entity_id as string,
    entity_name:
      (a.owner_entities as unknown as { display_name: string } | null)?.display_name ??
      "",
  }));

  return (
    <CountyImportClient
      orgId={profile.organization_id!}
      services={services ?? []}
      properties={properties ?? []}
      existingParcels={parcels ?? []}
      knownAliases={knownAliases}
    />
  );
}
