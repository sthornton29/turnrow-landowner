import { requireOrg } from "@/lib/auth";
import type { MaintenanceIssueGeo } from "@/types/db";
import MaintenanceClient from "./MaintenanceClient";

export const metadata = { title: "Maintenance" };

// The to-do list behind the map's maintenance layer: open issues by
// property and ag field, each with a Mark resolved button and a link
// to its spot on the map. Session client only; RLS scopes everything.
export default async function MaintenancePage() {
  const { supabase } = await requireOrg();
  const [{ data: issues }, { data: properties }, { data: fields }] = await Promise.all([
    supabase.from("maintenance_issues_geo").select("*").order("created_at", { ascending: false }),
    supabase.from("properties").select("id, name").order("name"),
    supabase.from("fields").select("id, name, property_id").order("name"),
  ]);
  return (
    <MaintenanceClient
      initialIssues={(issues as MaintenanceIssueGeo[]) ?? []}
      properties={(properties ?? []) as Array<{ id: string; name: string }>}
      fields={(fields ?? []) as Array<{ id: string; name: string; property_id: string }>}
    />
  );
}
