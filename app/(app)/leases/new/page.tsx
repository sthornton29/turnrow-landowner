import { requireOrg } from "@/lib/auth";
import NewLeaseClient from "./NewLeaseClient";

export const metadata = { title: "New lease" };

export default async function NewLeasePage() {
  const { supabase, profile } = await requireOrg();
  const { data: tenants } = await supabase
    .from("tenants")
    .select("id, name")
    .order("name");

  return (
    <NewLeaseClient orgId={profile.organization_id!} tenants={tenants ?? []} />
  );
}
