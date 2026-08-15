import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import MappingClient from "./MappingClient";

export const metadata = { title: "Field mapping" };

export default async function MappingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase } = await requireOrg();

  const [{ data: connection }, { data: mappings }, { data: fields }, { data: properties }] =
    await Promise.all([
      supabase
        .from("farm_connections")
        .select("id, label, status")
        .eq("id", id)
        .single(),
      supabase
        .from("field_mappings")
        .select("*")
        .eq("farm_connection_id", id)
        .order("remote_farm")
        .order("remote_name"),
      supabase
        .from("fields")
        .select("id, name, acres, property_id")
        .order("name"),
      supabase.from("properties").select("id, name").order("name"),
    ]);
  if (!connection) notFound();

  return (
    <MappingClient
      connection={connection}
      initialMappings={mappings ?? []}
      fields={fields ?? []}
      properties={properties ?? []}
    />
  );
}
