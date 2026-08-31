import { requireOrg } from "@/lib/auth";
import CountyImportClient from "./CountyImportClient";

export const metadata = { title: "Import from county records" };

export default async function CountyImportPage({
  searchParams,
}: {
  // The map's Neighbors overlay links here with a service, mode, and
  // seed preselected (run=1 fires the search on arrival); a plain visit
  // carries none of these and behaves exactly as before.
  searchParams: Promise<{ service?: string; mode?: string; q?: string; run?: string }>;
}) {
  const { service, mode, q, run } = await searchParams;
  const { supabase, profile } = await requireOrg();

  const [
    { data: services },
    { data: properties },
    { data: parcels },
    { data: aliases },
    { data: entities },
  ] = await Promise.all([
    supabase
      .from("county_gis_services")
      .select("*")
      .eq("status", "active")
      .order("state")
      .order("county"),
    supabase.from("properties").select("id, name, county, entity_id").order("name"),
    supabase.from("parcels").select("id, parcel_number, county, property_id"),
    supabase
      .from("entity_aliases")
      .select("normalized_alias, entity_id, entities(name)"),
    supabase.from("entities").select("id, name").order("name"),
  ]);

  const knownAliases = (aliases ?? []).map((a) => ({
    normalized_alias: a.normalized_alias as string,
    entity_id: a.entity_id as string,
    entity_name:
      (a.entities as unknown as { name: string } | null)?.name ?? "",
  }));

  return (
    <CountyImportClient
      orgId={profile.organization_id!}
      services={services ?? []}
      properties={properties ?? []}
      existingParcels={parcels ?? []}
      knownAliases={knownAliases}
      entities={entities ?? []}
      initial={{
        serviceId: service,
        mode: mode === "entity" || mode === "owner" || mode === "parcel" ? mode : undefined,
        text: q,
        run: run === "1",
      }}
    />
  );
}
