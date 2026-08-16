import { requireOrg } from "@/lib/auth";
import ImportClient from "@/components/import/ImportClient";

export const metadata = { title: "Import" };

export default async function ImportPage() {
  const { supabase, profile } = await requireOrg();

  // Boundaries come along so the client can suggest which property each
  // imported feature belongs to by location.
  const { data: properties } = await supabase
    .from("properties_geo")
    .select("id, name, boundary_geojson")
    .order("name");

  return (
    <ImportClient
      orgId={profile.organization_id!}
      existingProperties={properties ?? []}
    />
  );
}
