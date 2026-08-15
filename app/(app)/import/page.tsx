import { requireOrg } from "@/lib/auth";
import ImportClient from "@/components/import/ImportClient";

export const metadata = { title: "Import" };

export default async function ImportPage() {
  const { supabase, profile } = await requireOrg();

  const { data: properties } = await supabase
    .from("properties")
    .select("id, name")
    .order("name");

  return (
    <ImportClient
      orgId={profile.organization_id!}
      existingProperties={properties ?? []}
    />
  );
}
