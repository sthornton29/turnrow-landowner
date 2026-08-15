import { requireOrg } from "@/lib/auth";
import NewTimberClient from "./NewTimberClient";

export const metadata = { title: "New timber sale" };

export default async function NewTimberSalePage() {
  const { supabase, profile } = await requireOrg();
  const { data: tenants } = await supabase
    .from("tenants")
    .select("id, name")
    .order("name");

  return (
    <NewTimberClient orgId={profile.organization_id!} tenants={tenants ?? []} />
  );
}
