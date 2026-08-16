import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import TimberScanClient from "./TimberScanClient";

export const metadata = { title: "Timber Scan" };

export default async function TimberScanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, profile } = await requireOrg();

  const { data: property } = await supabase
    .from("properties_geo")
    .select("id, name, boundary_geojson")
    .eq("id", id)
    .single();
  if (!property) notFound();

  const { data: stands } = await supabase
    .from("timber_stands_geo")
    .select("id, name, boundary_geojson")
    .eq("property_id", id);

  if (!property.boundary_geojson) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
        <h1 className="text-xl font-semibold text-gray-900">Timber Scan</h1>
        <p className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-600">
          {property.name} has no boundary yet, and the scan works inside the
          property boundary. Draw one on the{" "}
          <Link href="/map" className="font-medium text-kelly-700 hover:underline">
            map
          </Link>{" "}
          or import it from{" "}
          <Link
            href="/import/county"
            className="font-medium text-kelly-700 hover:underline"
          >
            county records
          </Link>{" "}
          first.
        </p>
      </div>
    );
  }

  return (
    <TimberScanClient
      orgId={profile.organization_id!}
      property={{
        id: property.id,
        name: property.name,
        boundary: property.boundary_geojson,
      }}
      existingStands={(stands ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        boundary: s.boundary_geojson,
      }))}
    />
  );
}
