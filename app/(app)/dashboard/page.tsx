import Link from "next/link";
import AskEntryCard from "@/components/assistant/AskEntryCard";
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

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string }>;
}) {
  const { supabase, profile } = await requireOrg();
  const { entity: entityParam } = await searchParams;

  const [
    { data: org },
    { data: properties },
    { data: parcels },
    { data: fields },
    { data: pastures },
    { data: wetlands },
    { data: timber },
    { data: assets },
    { data: entities },
    { data: expectedPayments },
    { data: paymentRows },
    { data: leases },
    { data: timberSales },
    { data: taxStatements },
    { data: taxPayments },
    { data: taxLines },
    { data: farmData },
  ] = await Promise.all([
    supabase
      .from("organizations")
      .select("name")
      .eq("id", profile.organization_id)
      .single(),
    supabase.from("properties_geo").select("id, acres, boundary_geojson, entity_id"),
    supabase.from("parcels").select("id, property_id"),
    supabase.from("fields").select("id, acres, irrigated_acres, property_id"),
    supabase.from("pastures").select("id, acres, property_id"),
    supabase.from("wetlands").select("id, acres, property_id"),
    supabase.from("timber_stands").select("id, acres, property_id"),
    supabase
      .from("assets")
      .select("id, asset_type, property_id")
      .eq("is_active", true),
    supabase.from("entities").select("id, name").order("name"),
    supabase
      .from("expected_payments")
      .select("id, lease_id, timber_sale_id, label, due_date, expected_amount")
      .order("due_date"),
    supabase.from("payments").select("expected_payment_id, amount"),
    supabase.from("leases").select("id, name"),
    supabase.from("timber_sales").select("id, sale_name"),
    supabase
      .from("tax_statements")
      .select("id, tax_year, amount_due, delinquent_date")
      .eq("tax_year", new Date().getFullYear()),
    supabase.from("tax_payments").select("tax_statement_id, amount"),
    supabase
      .from("tax_statement_lines")
      .select("parcel_id, line_type")
      .eq("tax_year", new Date().getFullYear())
      .not("parcel_id", "is", null),
    supabase
      .from("farm_field_data")
      .select("planted_acres, harvested_acres")
      .eq("crop_year", new Date().getFullYear()),
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

  // Entity filter for the stat tiles (only shown when the org holds land
  // in more than one entity). Alerts and cards below stay org-wide.
  const entityList = entities ?? [];
  const showEntityChips = entityList.length > 1;
  const entityFilter = showEntityChips ? (entityParam ?? "") : "";
  const filteredProperties = entityFilter
    ? (properties ?? []).filter((p) =>
        entityFilter === "none" ? !p.entity_id : p.entity_id === entityFilter
      )
    : (properties ?? []);
  const propertyIds = new Set(filteredProperties.map((p) => p.id));
  const inScope = (row: { property_id: string | null }) =>
    !entityFilter || (row.property_id !== null && propertyIds.has(row.property_id));
  const scopedFields = (fields ?? []).filter(inScope);
  const scopedPastures = (pastures ?? []).filter(inScope);
  const scopedWetlands = (wetlands ?? []).filter(inScope);
  const scopedTimber = (timber ?? []).filter(inScope);
  const scopedAssets = (assets ?? []).filter(inScope);

  const propertyAcres = filteredProperties.reduce((s, p) => s + (p.acres ?? 0), 0);
  const fieldAcres = scopedFields.reduce((s, f) => s + (f.acres ?? 0), 0);
  const irrigatedAcres = scopedFields.reduce(
    (s, f) => s + ((f as { irrigated_acres?: number | null }).irrigated_acres ?? 0),
    0
  );
  const pastureAcres = scopedPastures.reduce((s, p) => s + (p.acres ?? 0), 0);
  const wetlandAcres = scopedWetlands.reduce((s, w) => s + (w.acres ?? 0), 0);
  const timberAcres = scopedTimber.reduce((s, t) => s + (t.acres ?? 0), 0);
  const box = bboxOf(
    (properties ?? []).map((p) => p.boundary_geojson as MultiPolygon | null)
  );

  // Property tax card for the current year (only once statements exist).
  const taxYear = new Date().getFullYear();
  const taxPaidByStatement = new Map<string, number>();
  for (const p of taxPayments ?? []) {
    taxPaidByStatement.set(
      p.tax_statement_id,
      (taxPaidByStatement.get(p.tax_statement_id) ?? 0) + p.amount
    );
  }
  const yearStatements = taxStatements ?? [];
  // Covered = a real-property LINE for the year links to the parcel.
  const coveredParcels = new Set(
    (taxLines ?? []).filter((l) => l.line_type === "real_property").map((l) => l.parcel_id)
  );
  const unpaidStatements = yearStatements.filter(
    (s) => (taxPaidByStatement.get(s.id) ?? 0) < s.amount_due - 0.005
  );
  const taxUnpaidTotal = unpaidStatements.reduce(
    (sum, s) => sum + s.amount_due - (taxPaidByStatement.get(s.id) ?? 0),
    0
  );
  const nearestDelinquent = unpaidStatements
    .map((s) => s.delinquent_date)
    .filter((d): d is string => !!d)
    .sort()[0];
  let taxTier: "ok" | "warn" | "danger" = "ok";
  if (taxUnpaidTotal > 0 && nearestDelinquent) {
    const delinquent = new Date(nearestDelinquent + "T00:00:00");
    const daysLeft = Math.ceil((delinquent.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    taxTier = daysLeft < 0 ? "danger" : daysLeft <= 60 ? "warn" : "ok";
  }
  const taxCardBorder =
    taxTier === "danger"
      ? "border-red-200"
      : taxTier === "warn"
        ? "border-amber-200"
        : "border-gray-200";
  const taxHeaderClasses =
    taxTier === "danger"
      ? "border-red-100 bg-red-50 text-red-800"
      : taxTier === "warn"
        ? "border-amber-100 bg-amber-50 text-amber-900"
        : "border-gray-100 bg-white text-gray-900";

  // Harvest progress card (shown during harvest: acres are being cut)
  const farmPlanted = (farmData ?? []).reduce((s, d) => s + (d.planted_acres ?? 0), 0);
  const farmHarvested = (farmData ?? []).reduce((s, d) => s + (d.harvested_acres ?? 0), 0);
  const showHarvestCard = farmHarvested > 0 && farmPlanted > 0;
  const harvestPct = showHarvestCard
    ? Math.min(Math.round((farmHarvested / farmPlanted) * 100), 100)
    : 0;

  const countOf = (...types: string[]) =>
    scopedAssets.filter((a) => types.includes(a.asset_type)).length;

  const stats = [
    { label: "Total acres", value: formatAcres(propertyAcres) },
    { label: "Properties", value: formatNumber(filteredProperties.length) },
    { label: "Ag field acres", value: formatAcres(fieldAcres) },
    ...(irrigatedAcres > 0.05
      ? [{ label: "Irrigated acres", value: formatAcres(irrigatedAcres) }]
      : []),
    ...(pastureAcres > 0.05
      ? [{ label: "Pasture/Grassland acres", value: formatAcres(pastureAcres) }]
      : []),
    ...(wetlandAcres > 0.05
      ? [{ label: "Wetland acres", value: formatAcres(wetlandAcres) }]
      : []),
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

      {showHarvestCard ? (
        <Link href="/farm-activity" className="block rounded-xl border border-kelly-100 bg-white">
          <h2 className="rounded-t-xl border-b border-kelly-100 bg-kelly-50 px-4 py-3 text-base font-semibold text-pine-900">
            Harvest progress
          </h2>
          <div className="space-y-2 px-4 py-3">
            <p className="text-sm text-gray-700">
              <span className="font-semibold tabular-nums text-gray-900">
                {formatAcres(farmHarvested)}
              </span>{" "}
              of{" "}
              <span className="font-semibold tabular-nums text-gray-900">
                {formatAcres(farmPlanted)}
              </span>{" "}
              connected acres harvested ({harvestPct}%)
            </p>
            <div className="h-2 overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-kelly-500"
                style={{ width: `${harvestPct}%` }}
              />
            </div>
          </div>
        </Link>
      ) : null}

      {yearStatements.length > 0 ? (
        <Link
          href="/taxes"
          className={`block rounded-xl border bg-white ${taxCardBorder}`}
        >
          <h2
            className={`rounded-t-xl border-b px-4 py-3 text-base font-semibold ${taxHeaderClasses}`}
          >
            {taxYear} property taxes
          </h2>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3 text-sm">
            <span className="text-gray-700">
              <span className="font-semibold tabular-nums text-gray-900">
                {formatNumber(coveredParcels.size)} of {formatNumber((parcels ?? []).length)}
              </span>{" "}
              parcels covered
            </span>
            <span className="text-gray-700">
              <span className="font-semibold tabular-nums text-gray-900">
                {formatDollars(taxUnpaidTotal)}
              </span>{" "}
              unpaid
            </span>
            {taxUnpaidTotal > 0 && nearestDelinquent ? (
              <span
                className={
                  taxTier === "danger"
                    ? "font-medium text-red-700"
                    : taxTier === "warn"
                      ? "font-medium text-amber-800"
                      : "text-gray-500"
                }
              >
                {taxTier === "danger"
                  ? `Delinquent since ${nearestDelinquent}`
                  : `Delinquent ${nearestDelinquent}`}
              </span>
            ) : null}
            <span className="ml-auto text-kelly-600">&rarr;</span>
          </div>
        </Link>
      ) : null}

      {showEntityChips ? (
        <div className="flex flex-wrap gap-1.5">
          {[
            { key: "", label: "All entities" },
            ...entityList.map((e) => ({ key: e.id, label: e.name })),
            { key: "none", label: "No entity" },
          ].map((chip) => (
            <Link
              key={chip.key || "all"}
              href={chip.key ? `/dashboard?entity=${chip.key}` : "/dashboard"}
              className={
                "rounded-full border px-3 py-1 text-sm font-medium " +
                (entityFilter === chip.key
                  ? "border-kelly-500 bg-kelly-50 text-pine-900"
                  : "border-gray-200 bg-white text-gray-600 hover:border-gray-300")
              }
            >
              {chip.label}
            </Link>
          ))}
        </div>
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

      <AskEntryCard />

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
