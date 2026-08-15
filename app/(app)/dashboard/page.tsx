import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { formatAcres, formatDollars, formatNumber } from "@/lib/format";
import { bboxOf } from "@/lib/geo/normalize";
import {
  PAYMENT_STATUS_LABELS,
  STATUS_BADGE_CLASSES,
  paymentStatus,
} from "@/lib/leaseLogic";
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

  const [
    { data: org },
    { data: properties },
    { data: parcels },
    { data: fields },
    { data: timber },
    { data: assets },
    { data: expectedPayments },
    { data: paymentRows },
    { data: leases },
    { data: timberSales },
  ] = await Promise.all([
    supabase
      .from("organizations")
      .select("name")
      .eq("id", profile.organization_id)
      .single(),
    supabase.from("properties_geo").select("id, acres, boundary_geojson"),
    supabase.from("parcels").select("id"),
    supabase.from("fields").select("id, acres"),
    supabase.from("timber_stands").select("id, acres"),
    supabase.from("assets").select("id, asset_type").eq("is_active", true),
    supabase
      .from("expected_payments")
      .select("id, lease_id, timber_sale_id, label, due_date, expected_amount")
      .order("due_date"),
    supabase.from("payments").select("expected_payment_id, amount"),
    supabase.from("leases").select("id, name"),
    supabase.from("timber_sales").select("id, sale_name"),
  ]);

  // Payments needing attention: past due, or due within 60 days, not yet paid.
  const receivedByExpected = new Map<string, number>();
  for (const p of paymentRows ?? []) {
    if (p.expected_payment_id) {
      receivedByExpected.set(
        p.expected_payment_id,
        (receivedByExpected.get(p.expected_payment_id) ?? 0) + p.amount
      );
    }
  }
  const leaseName = new Map((leases ?? []).map((l) => [l.id, l.name]));
  const saleName = new Map((timberSales ?? []).map((s) => [s.id, s.sale_name]));
  const now = new Date();
  const horizon = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
  const attention = (expectedPayments ?? [])
    .map((e) => {
      const received = receivedByExpected.get(e.id) ?? 0;
      const status = paymentStatus(e.expected_amount, received, e.due_date, now);
      return { ...e, received, status };
    })
    .filter(
      (e) =>
        e.status !== "paid" &&
        (e.status === "past_due" ||
          e.status === "partial" ||
          new Date(e.due_date + "T00:00:00") <= horizon)
    )
    .slice(0, 8);

  const propertyAcres = (properties ?? []).reduce((s, p) => s + (p.acres ?? 0), 0);
  const fieldAcres = (fields ?? []).reduce((s, f) => s + (f.acres ?? 0), 0);
  const timberAcres = (timber ?? []).reduce((s, t) => s + (t.acres ?? 0), 0);
  const box = bboxOf(
    (properties ?? []).map((p) => p.boundary_geojson as MultiPolygon | null)
  );

  const countOf = (...types: string[]) =>
    (assets ?? []).filter((a) => types.includes(a.asset_type)).length;

  const stats = [
    { label: "Total acres", value: formatAcres(propertyAcres) },
    { label: "Properties", value: formatNumber((properties ?? []).length) },
    { label: "Field acres", value: formatAcres(fieldAcres) },
    { label: "Timber acres", value: formatAcres(timberAcres) },
    { label: "Wells", value: formatNumber(countOf("well")) },
    { label: "Pivots", value: formatNumber(countOf("irrigation_pivot")) },
    { label: "Grain bins", value: formatNumber(countOf("grain_bin")) },
    {
      label: "Buildings",
      value: formatNumber(countOf("shop", "shed", "barn", "house")),
    },
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

      {attention.length > 0 ? (
        <section className="rounded-xl border border-amber-200 bg-white">
          <h2 className="border-b border-amber-100 bg-amber-50 px-4 py-3 text-base font-semibold text-amber-900">
            Payments needing attention
          </h2>
          <ul className="divide-y divide-gray-100">
            {attention.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
                <Link
                  href={e.lease_id ? `/leases/${e.lease_id}` : `/timber-sales/${e.timber_sale_id}`}
                  className="font-medium text-gray-900 hover:underline"
                >
                  {e.lease_id
                    ? leaseName.get(e.lease_id) ?? "Lease"
                    : saleName.get(e.timber_sale_id!) ?? "Timber sale"}
                </Link>
                <span className="text-gray-500">
                  {e.label} · due {e.due_date}
                </span>
                <span className="ml-auto flex items-center gap-2">
                  <span className="font-medium tabular-nums text-gray-900">
                    {formatDollars(e.expected_amount - e.received)}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASSES[e.status]}`}
                  >
                    {PAYMENT_STATUS_LABELS[e.status]}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
