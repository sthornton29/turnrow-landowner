import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import type { DocumentRow, ParcelGeo, PropertyGeo } from "@/types/db";
import PlotClient from "./PlotClient";

export const metadata = { title: "Plot boundary" };

// Plot a property or parcel boundary from a deed, plat, or legal
// description. The server loads the document and the org's existing
// boundaries (RLS via the session client); the client does the work.
export default async function PlotBoundaryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, profile } = await requireOrg();

  const [{ data: doc }, { data: properties }, { data: parcels }] = await Promise.all([
    supabase.from("documents").select("*").eq("id", id).single(),
    supabase.from("properties_geo").select("*").order("name"),
    supabase.from("parcels_geo").select("*").order("parcel_number"),
  ]);
  if (!doc) notFound();

  return (
    <PlotClient
      orgId={profile.organization_id!}
      document={doc as DocumentRow}
      properties={(properties as PropertyGeo[]) ?? []}
      parcels={(parcels as ParcelGeo[]) ?? []}
    />
  );
}
