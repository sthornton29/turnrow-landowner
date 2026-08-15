import { requireOrg } from "@/lib/auth";
import FarmsClient from "./FarmsClient";

export const metadata = { title: "Farm data" };

export default async function FarmsPage() {
  const { supabase } = await requireOrg();
  const { data: connections } = await supabase
    .from("farm_connections")
    .select(
      "id, label, status, scopes, operation_name, landowner_name, field_count, last_synced_at, last_error, created_at"
    )
    .order("created_at");

  return <FarmsClient initialConnections={connections ?? []} />;
}
