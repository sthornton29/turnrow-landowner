import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import LeaseDetail from "./LeaseDetail";

export const metadata = { title: "Lease" };

export default async function LeaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, profile } = await requireOrg();

  const [{ data: lease }, { data: tenants }, { data: properties }, { data: fields }] =
    await Promise.all([
      supabase.from("leases").select("*").eq("id", id).single(),
      supabase
        .from("tenants")
        .select("id, name, insurance_on_file, insurance_expires, farm_connection_id, farm_entity_id, farm_entity_name")
        .order("name"),
      supabase.from("properties").select("id, name, acres").order("name"),
      supabase.from("fields").select("id, property_id, name, acres").order("name"),
    ]);
  if (!lease) notFound();

  return (
    <LeaseDetail
      orgId={profile.organization_id!}
      lease={lease}
      tenants={tenants ?? []}
      properties={properties ?? []}
      fields={fields ?? []}
    />
  );
}
