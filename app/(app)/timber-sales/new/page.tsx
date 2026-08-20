import { requireOrg } from "@/lib/auth";
import NewTimberClient from "./NewTimberClient";

export const metadata = { title: "New timber sale" };

export default async function NewTimberSalePage() {
  const { supabase, profile } = await requireOrg();
  const [{ data: tenants }, { data: stands }, { data: properties }] =
    await Promise.all([
      supabase.from("tenants").select("id, name").order("name"),
      supabase
        .from("timber_stands")
        .select("id, name, acres, property_id")
        .order("name"),
      supabase.from("properties").select("id, name"),
    ]);
  const propertyName = new Map((properties ?? []).map((p) => [p.id, p.name]));

  return (
    <NewTimberClient
      orgId={profile.organization_id!}
      tenants={tenants ?? []}
      stands={(stands ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        acres: s.acres,
        propertyName: propertyName.get(s.property_id) ?? null,
      }))}
    />
  );
}
