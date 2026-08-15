import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { formatAcres, formatNumber } from "@/lib/format";
import { bboxOf } from "@/lib/geo/normalize";
import type { MultiPolygon } from "geojson";

export const metadata = { title: "Dashboard" };

// Static satellite thumbnail centered on the organization's land, via the
// Mapbox Static Images API. Zoom is estimated from the bounding box span.
function staticMapUrl(box: [number, number, number, number]): string {
  const [w, s, e, n] = box;
  const lon = (w + e) / 2;
  const lat = (s + n) / 2;
  const span = Math.max(e - w, (n - s) * 1.6, 0.004);
  const zoom = Math.max(3, Math.min(15, Math.floor(Math.log2(360 / span)) - 1));
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  return `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/${lon.toFixed(5)},${lat.toFixed(5)},${zoom}/640x300@2x?access_token=${token}`;
}

export default async function DashboardPage() {
  const { supabase, profile } = await requireOrg();

  const [{ data: org }, { data: properties }, { data: parcels }, { data: fields }] =
    await Promise.all([
      supabase
        .from("organizations")
        .select("name")
        .eq("id", profile.organization_id)
        .single(),
      supabase.from("properties_geo").select("id, acres, boundary_geojson"),
      supabase.from("parcels").select("id"),
      supabase.from("fields").select("id, acres"),
    ]);

  const propertyAcres = (properties ?? []).reduce((s, p) => s + (p.acres ?? 0), 0);
  const fieldAcres = (fields ?? []).reduce((s, f) => s + (f.acres ?? 0), 0);
  const box = bboxOf(
    (properties ?? []).map((p) => p.boundary_geojson as MultiPolygon | null)
  );

  const stats = [
    { label: "Total acres", value: formatAcres(propertyAcres) },
    { label: "Properties", value: formatNumber((properties ?? []).length) },
    { label: "Fields", value: formatNumber((fields ?? []).length) },
    { label: "Field acres", value: formatAcres(fieldAcres) },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">
          {org?.name ?? "Dashboard"}
        </h1>
        <p className="mt-0.5 text-sm text-gray-600">
          Welcome back{profile.full_name ? `, ${profile.full_name}` : ""}.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-2xl font-semibold tabular-nums text-gray-900">{s.value}</p>
            <p className="mt-0.5 text-sm text-gray-500">{s.label}</p>
          </div>
        ))}
      </div>

      <Link href="/map" className="block overflow-hidden rounded-xl border border-gray-200">
        {box ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={staticMapUrl(box)}
            alt="Map of your property"
            className="h-48 w-full object-cover md:h-64"
          />
        ) : (
          <div className="flex h-48 items-center justify-center bg-pine-900 md:h-64">
            <p className="px-6 text-center text-sm text-white/80">
              No boundaries yet. Open the map to draw your first one, or import
              your files.
            </p>
          </div>
        )}
        <div className="flex items-center justify-between bg-white px-4 py-3">
          <span className="text-sm font-medium text-gray-900">Open the map</span>
          <span className="text-kelly-600">&rarr;</span>
        </div>
      </Link>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Link
          href="/import"
          className="rounded-xl border border-gray-200 bg-white p-4 transition hover:border-kelly-500"
        >
          <p className="font-medium text-gray-900">Import boundaries</p>
          <p className="mt-0.5 text-sm text-gray-500">
            GeoJSON, KML, KMZ, or shapefiles
          </p>
        </Link>
        <Link
          href="/properties"
          className="rounded-xl border border-gray-200 bg-white p-4 transition hover:border-kelly-500"
        >
          <p className="font-medium text-gray-900">Properties</p>
          <p className="mt-0.5 text-sm text-gray-500">
            Browse and edit without the map
          </p>
        </Link>
        <Link
          href="/settings/members"
          className="rounded-xl border border-gray-200 bg-white p-4 transition hover:border-kelly-500"
        >
          <p className="font-medium text-gray-900">Members</p>
          <p className="mt-0.5 text-sm text-gray-500">Invite family or your manager</p>
        </Link>
      </div>
    </div>
  );
}
