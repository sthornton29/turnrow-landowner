import Link from "next/link";
import AskEntryCard from "@/components/assistant/AskEntryCard";
import { requireOrg } from "@/lib/auth";
import { formatAcres, formatDate, formatDollars, formatNumber, todayISO } from "@/lib/format";
import { seasonYear, withoutIgnoredFields } from "@/lib/farmDisplay";
import { addDaysISO, isAfterEndedLease, taxAlertText, unpaidTaxByYear } from "@/lib/ops/brief";
import { NO_ENTITY, parseEntityParam } from "@/lib/entities";
import EntityFilterChips from "@/components/entities/EntityFilterChips";
import { bboxOf } from "@/lib/geo/normalize";
import {
  PAYMENT_STATUS_LABELS,
  STATUS_BADGE_CLASSES,
  paymentStatus,
} from "@/lib/leaseLogic";
import type { MultiPolygon } from "geojson";

export const metadata = { title: "Home" };

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
  const { supabase, profile, isAdmin } = await requireOrg();
  const { entity: entityParam } = await searchParams;

  // "Today" is the calendar day where the land is (US Central). The
  // server runs in UTC and would call it tomorrow every evening.
  const today = todayISO();
  const todayStart = new Date(today + "T00:00:00");
  const in60 = addDaysISO(today, 60);
  const in90 = addDaysISO(today, 90);
  const currentYear = Number(today.slice(0, 4));

  const results = await Promise.all([
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
    supabase.from("pollinator_habitats").select("id, acres, property_id"),
    supabase.from("timber_stands").select("id, acres, property_id"),
    supabase
      .from("assets")
      .select("id, asset_type, property_id")
      .eq("is_active", true),
    supabase.from("entities").select("id, name").order("name"),
    supabase
      .from("expected_payments")
      .select("id, lease_id, timber_sale_id, year, label, due_date, expected_amount")
      .order("due_date"),
    supabase.from("payments").select("expected_payment_id, amount"),
    supabase
      .from("leases")
      .select("id, name, status, lease_type, end_date, auto_renew, tenant_id, terms"),
    supabase.from("timber_sales").select("id, sale_name"),
    // Every tax year, newest first: last year's bills go delinquent on
    // January 1, so "this calendar year only" hid them the day it mattered.
    supabase
      .from("tax_statements")
      .select("id, tax_year, amount_due, delinquent_date")
      .order("tax_year", { ascending: false }),
    supabase.from("tax_payments").select("tax_statement_id, amount"),
    // This crop year and the one before: harvest often finishes in January.
    supabase
      .from("farm_field_data")
      .select("farm_connection_id, remote_field_id, crop_year, planted_acres, harvested_acres, harvest_status")
      .in("crop_year", [currentYear - 1, currentYear])
      .order("crop_year", { ascending: false }),
    supabase
      .from("field_mappings")
      .select("farm_connection_id, remote_field_id, status")
      .eq("status", "ignored"),
    supabase.from("tenants").select("id, name, insurance_on_file, insurance_expires"),
    supabase
      .from("maintenance_issues")
      .select("id, severity")
      .eq("status", "open"),
  ]);
  const [
    { data: org },
    { data: properties },
    { data: parcels },
    { data: fields },
    { data: pastures },
    { data: wetlands },
    { data: habitats },
    { data: timber },
    { data: assets },
    { data: entities },
    { data: expectedPayments },
    { data: paymentRows },
    { data: leases },
    { data: timberSales },
    { data: taxStatements },
    { data: taxPayments },
    { data: farmData },
    { data: ignoredMappings },
    { data: tenants },
    { data: openIssues },
  ] = results;

  // Property tax card: the latest tax year that has statements (this
  // calendar year when there are none yet). Its parcel coverage needs
  // that year's statement lines.
  const allStatements = taxStatements ?? [];
  const taxYear = allStatements.reduce((latest, s) => Math.max(latest, s.tax_year), 0) || currentYear;
  const { data: taxLines, error: taxLinesError } =
    allStatements.length > 0
      ? await supabase
          .from("tax_statement_lines")
          .select("parcel_id, line_type")
          .eq("tax_year", taxYear)
          .not("parcel_id", "is", null)
      : { data: [], error: null };

  // A read that failed must never look like an empty or a healthy
  // account: no all-clear line and no setup steps when anything is missing.
  const loadFailed = results.some((r) => r.error) || Boolean(taxLinesError);

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
  const leaseById = new Map((leases ?? []).map((l) => [l.id, l]));
  const saleName = new Map((timberSales ?? []).map((s) => [s.id, s.sale_name]));
  const owed = (expectedPayments ?? [])
    .map((e) => {
      const received = receivedByExpected.get(e.id) ?? 0;
      const status = paymentStatus(e.expected_amount, received, e.due_date, todayStart);
      return { ...e, received, status };
    })
    .filter(
      (e) =>
        e.status !== "paid" &&
        // A schedule row for a year after an expired or terminated
        // lease ended is not owed; rent for the lease's own years still
        // is, even when it falls due after the lease's last day (a crop
        // share settlement the following summer).
        !isAfterEndedLease(e, e.lease_id ? leaseById.get(e.lease_id) : null, e.received) &&
        (e.status === "past_due" || e.status === "partial" || e.due_date <= in60)
    );
  // Overdue first, the most recently due at the top (oldest-first let
  // years-old rows fill the list and hide this season's), then what is
  // coming due, soonest first. The rest are one tap away on Income.
  const attentionAll = [
    ...owed.filter((e) => e.due_date < today).sort((a, b) => b.due_date.localeCompare(a.due_date)),
    ...owed.filter((e) => e.due_date >= today).sort((a, b) => a.due_date.localeCompare(b.due_date)),
  ];
  const attention = attentionAll.slice(0, 8);
  const attentionMore = attentionAll.length - attention.length;

  // Everything else an absentee owner would want flagged without opening
  // each page: leases running out, tenant insurance lapsing, and open
  // problems on the ground. Each alert links to the page that fixes it.
  type Alert = { key: string; href: string; title: string; detail: string; tone: "red" | "amber" };
  const alerts: Alert[] = [];
  const activeLeases = (leases ?? []).filter((l) => l.status === "active");
  for (const l of activeLeases) {
    if (!l.end_date || l.auto_renew) continue;
    if (l.end_date < today) {
      alerts.push({
        key: `lease-ended-${l.id}`,
        href: `/leases/${l.id}`,
        title: l.name,
        detail: `Lease ended ${formatDate(l.end_date)} and is still marked active. Renew it or mark it expired.`,
        tone: "red",
      });
    } else if (l.end_date <= in90) {
      alerts.push({
        key: `lease-ending-${l.id}`,
        href: `/leases/${l.id}`,
        title: l.name,
        detail: `Lease ends ${formatDate(l.end_date)}. Time to talk renewal with your tenant.`,
        tone: "amber",
      });
    }
  }
  const tenantById = new Map((tenants ?? []).map((t) => [t.id, t]));
  const flaggedTenants = new Set<string>();
  for (const l of activeLeases) {
    const t = tenantById.get(l.tenant_id);
    if (!t || flaggedTenants.has(t.id)) continue;
    const terms = (l.terms ?? {}) as { insurance_required?: boolean };
    const required = l.lease_type === "hunting" && terms.insurance_required === true;
    if (required && !t.insurance_on_file) {
      flaggedTenants.add(t.id);
      alerts.push({
        key: `ins-none-${t.id}`,
        href: `/tenants/${t.id}`,
        title: t.name,
        detail: `${l.name} requires insurance but no certificate is on file.`,
        tone: "red",
      });
    } else if (t.insurance_on_file && t.insurance_expires && t.insurance_expires < today) {
      flaggedTenants.add(t.id);
      alerts.push({
        key: `ins-expired-${t.id}`,
        href: `/tenants/${t.id}`,
        title: t.name,
        detail: `Insurance certificate expired ${formatDate(t.insurance_expires)}. Ask for a current one.`,
        tone: required ? "red" : "amber",
      });
    } else if (t.insurance_on_file && t.insurance_expires && t.insurance_expires <= in60) {
      flaggedTenants.add(t.id);
      alerts.push({
        key: `ins-soon-${t.id}`,
        href: `/tenants/${t.id}`,
        title: t.name,
        detail: `Insurance certificate expires ${formatDate(t.insurance_expires)}.`,
        tone: "amber",
      });
    }
  }
  const openCount = (openIssues ?? []).length;
  const highCount = (openIssues ?? []).filter((i) => i.severity === "high").length;
  if (openCount > 0) {
    alerts.push({
      key: "maintenance",
      href: "/maintenance",
      title: "Maintenance",
      detail:
        `${formatNumber(openCount)} open issue${openCount === 1 ? "" : "s"} on the land` +
        (highCount > 0 ? ` (${formatNumber(highCount)} high severity)` : "") +
        ".",
      tone: highCount > 0 ? "red" : "amber",
    });
  }
  alerts.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === "red" ? -1 : 1));
  // No land in view means two different things. An admin has setup to
  // do. A member who has not been granted an entity yet can do none of
  // it (row level security refuses), so they are told whom to ask.
  const noLand = (properties ?? []).length === 0;
  const setupStage = noLand && isAdmin && !loadFailed;
  const noAccess = noLand && !isAdmin && !loadFailed;
  let askWhom = "the person who invited you";
  if (noAccess) {
    const [{ data: admins }, { data: invite }] = await Promise.all([
      supabase.from("profiles").select("id, full_name").eq("role", "admin"),
      supabase.from("invites").select("invited_by").ilike("email", profile.email).limit(1),
    ]);
    const named = (admins ?? []).filter((a) => (a.full_name ?? "").trim() !== "");
    const inviter = named.find((a) => a.id === invite?.[0]?.invited_by);
    askWhom = inviter?.full_name ?? (named.length === 1 ? named[0].full_name : null) ?? askWhom;
  }

  // Entity filter for the stat tiles (only shown when the org holds land
  // in more than one entity). Alerts and cards below stay org-wide.
  // MULTI-SELECT comma list, shared semantics (and the shared NO_ENTITY
  // key - this page used a stray "none" literal before) with the income
  // and gov payments pages.
  const entityList = entities ?? [];
  const showEntityChips = entityList.length > 1;
  const selectedKeys = showEntityChips
    ? parseEntityParam(entityParam).filter(
        (k) => k === NO_ENTITY || entityList.some((e) => e.id === k)
      )
    : [];
  const filtering = selectedKeys.length > 0;
  const selectedSet = new Set(selectedKeys);
  const filteredProperties = filtering
    ? (properties ?? []).filter((p) => selectedSet.has(p.entity_id ?? NO_ENTITY))
    : (properties ?? []);
  const propertyIds = new Set(filteredProperties.map((p) => p.id));
  const inScope = (row: { property_id: string | null }) =>
    !filtering || (row.property_id !== null && propertyIds.has(row.property_id));
  const scopedFields = (fields ?? []).filter(inScope);
  const scopedPastures = (pastures ?? []).filter(inScope);
  const scopedWetlands = (wetlands ?? []).filter(inScope);
  const scopedHabitats = (habitats ?? []).filter(inScope);
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
  const habitatAcres = scopedHabitats.reduce((s, h) => s + (h.acres ?? 0), 0);
  const timberAcres = scopedTimber.reduce((s, t) => s + (t.acres ?? 0), 0);
  const box = bboxOf(
    (properties ?? []).map((p) => p.boundary_geojson as MultiPolygon | null)
  );

  // Property tax card for the latest tax year on file (only once
  // statements exist).
  const taxPaidByStatement = new Map<string, number>();
  for (const p of taxPayments ?? []) {
    taxPaidByStatement.set(
      p.tax_statement_id,
      (taxPaidByStatement.get(p.tax_statement_id) ?? 0) + p.amount
    );
  }
  const yearStatements = allStatements.filter((s) => s.tax_year === taxYear);
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
  // delinquent_date is the FIRST delinquent day: the bill is delinquent
  // from that morning, and the last day to pay is the day before.
  let taxTier: "ok" | "warn" | "danger" = "ok";
  if (taxUnpaidTotal > 0 && nearestDelinquent) {
    taxTier = nearestDelinquent <= today ? "danger" : nearestDelinquent <= in60 ? "warn" : "ok";
  }
  // Taxes near or past delinquency join the attention list too, for
  // EVERY tax year that still has a balance (not only the card's year),
  // each named by its own tax year. Property tax for a year is due
  // October 1 and goes delinquent January 1 of the NEXT year.
  const taxAlerts = unpaidTaxByYear(allStatements, taxPaidByStatement, today, in60);
  for (const a of taxAlerts) {
    alerts.push({
      key: `taxes-${a.taxYear}`,
      href: `/taxes?year=${a.taxYear}`,
      title: `${a.taxYear} property taxes`,
      detail: taxAlertText(a),
      tone: a.delinquentStatements > 0 ? "red" : "amber",
    });
  }
  if (taxAlerts.length > 0) {
    alerts.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === "red" ? -1 : 1));
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

  // Harvest progress card (shown during harvest: acres are being cut).
  // Harvested counts only harvest-COMPLETE fields; fields mid-harvest
  // (harvest_status in_progress) show as their own acres line. Rows
  // synced before the farm API sent statuses fall back to the old
  // harvested-acres inference. Shows this crop year once it has
  // plantings, otherwise the year before (harvest often finishes in
  // January), and says which. Fields marked "Ignore this field" on the
  // mapping screen are left out.
  const farmRows = withoutIgnoredFields(farmData ?? [], ignoredMappings ?? []);
  const harvestYear = seasonYear(farmRows, currentYear);
  const harvestRows = farmRows.filter((d) => d.crop_year === harvestYear);
  const farmPlanted = harvestRows.reduce((s, d) => s + (d.planted_acres ?? 0), 0);
  const farmHarvested = harvestRows.reduce(
    (s, d) =>
      s +
      ((d.harvest_status ?? ((d.harvested_acres ?? 0) > 0 ? "complete" : null)) === "complete"
        ? (d.harvested_acres ?? 0)
        : 0),
    0
  );
  const farmInProgress = harvestRows.reduce(
    (s, d) => s + (d.harvest_status === "in_progress" ? (d.planted_acres ?? 0) : 0),
    0
  );
  const showHarvestCard = (farmHarvested > 0 || farmInProgress > 0) && farmPlanted > 0;
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
    ...(habitatAcres > 0.05
      ? [{ label: "Pollinator habitat acres", value: formatAcres(habitatAcres) }]
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

      {loadFailed ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
          Some of your records could not be loaded just now. Reload to try again.
        </p>
      ) : null}

      {noAccess ? (
        <p className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700">
          You have not been given access to any land yet. Ask {askWhom} to add you to an entity
          in Settings.
        </p>
      ) : null}

      {attention.length > 0 || alerts.length > 0 ? (
        <section className="rounded-xl border border-amber-200 bg-white">
          <h2 className="border-b border-amber-100 bg-amber-50 px-4 py-3 text-base font-semibold text-amber-900">
            Needs your attention
          </h2>
          <ul className="divide-y divide-gray-100">
            {alerts.map((a) => (
              <li key={a.key} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-4 py-2.5 text-sm">
                <span
                  aria-hidden
                  className={
                    "inline-block h-2 w-2 shrink-0 rounded-full " +
                    (a.tone === "red" ? "bg-red-500" : "bg-amber-400")
                  }
                />
                <Link href={a.href} className="font-medium text-gray-900 hover:underline">
                  {a.title}
                </Link>
                <span className="text-gray-600">{a.detail}</span>
              </li>
            ))}
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
                  {e.label} · due {formatDate(e.due_date)}
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
            {attentionMore > 0 ? (
              <li className="px-4 py-2.5 text-sm">
                <Link href="/income" className="font-medium text-kelly-700 hover:underline">
                  and {formatNumber(attentionMore)} more on the Income page
                </Link>
              </li>
            ) : null}
          </ul>
        </section>
      ) : !noLand && !loadFailed ? (
        <p className="rounded-xl border border-kelly-100 bg-kelly-50 px-4 py-3 text-sm font-medium text-pine-900">
          Nothing needs your attention right now. Payments, leases, tenant insurance, taxes, and
          maintenance are all in order.
        </p>
      ) : null}

      {showHarvestCard ? (
        <Link
          href={`/farm-activity?year=${harvestYear}`}
          className="block rounded-xl border border-kelly-100 bg-white"
        >
          <h2 className="rounded-t-xl border-b border-kelly-100 bg-kelly-50 px-4 py-3 text-base font-semibold text-pine-900">
            {harvestYear} harvest progress
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
              connected acres harvest-complete ({harvestPct}%)
              {farmInProgress > 0 ? (
                <span className="text-gray-600">
                  {" "}· {formatAcres(farmInProgress)} ac being harvested
                </span>
              ) : null}
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
          href={`/taxes?year=${taxYear}`}
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
                  ? `Delinquent since ${formatDate(nearestDelinquent)}`
                  : `Pay by ${formatDate(addDaysISO(nearestDelinquent, -1))}`}
              </span>
            ) : null}
            <span className="ml-auto text-kelly-600">&rarr;</span>
          </div>
        </Link>
      ) : null}

      {showEntityChips ? (
        <EntityFilterChips
          entities={entityList}
          selected={selectedKeys}
          basePath="/dashboard"
        />
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
              {isAdmin
                ? "No boundaries yet. Open the map to draw your first one, or import your files."
                : "No boundaries to show yet."}
            </p>
          </div>
        )}
        <div className="flex items-center justify-between bg-white px-4 py-3">
          <span className="text-sm font-medium text-gray-900">Open the map</span>
          <span className="text-kelly-600">&rarr;</span>
        </div>
      </Link>

      {setupStage ? (
        <section className="rounded-xl border border-kelly-100 bg-white">
          <h2 className="rounded-t-xl border-b border-kelly-100 bg-kelly-50 px-4 py-3 text-base font-semibold text-pine-900">
            Set up your land in four steps
          </h2>
          <ol className="divide-y divide-gray-100">
            {[
              {
                href: "/import/county",
                title: "Bring in your parcels from county records",
                detail: "Search by owner name and the boundaries arrive already drawn. No files needed.",
              },
              {
                href: "/entities",
                title: "Name who holds the land",
                detail: "An LLC, a trust, your own name. Every page can then be filtered by owner.",
              },
              {
                href: "/leases/new",
                title: "Add your leases",
                detail: "Upload the lease and it is read for you, or enter the terms by hand. Payments due follow.",
              },
              {
                href: "/taxes/upload",
                title: "Upload this year's tax statements",
                detail: "Each parcel is matched to its statement so nothing quietly goes delinquent.",
              },
            ].map((step, i) => (
              <li key={step.href}>
                <Link href={step.href} className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-kelly-500 text-xs font-semibold text-white">
                    {i + 1}
                  </span>
                  <span>
                    <span className="block text-sm font-medium text-gray-900">{step.title}</span>
                    <span className="block text-sm text-gray-500">{step.detail}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <AskEntryCard />

      {/* Importing and inviting are admin work; a member sees only what
          they can use. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {isAdmin ? (
          <Link
            href="/import"
            className="rounded-xl border border-gray-200 bg-white p-4 transition hover:border-kelly-500"
          >
            <p className="font-medium text-gray-900">Import boundaries</p>
            <p className="mt-0.5 text-sm text-gray-500">
              GeoJSON, KML, KMZ, or shapefiles
            </p>
          </Link>
        ) : null}
        <Link
          href="/properties"
          className="rounded-xl border border-gray-200 bg-white p-4 transition hover:border-kelly-500"
        >
          <p className="font-medium text-gray-900">Properties</p>
          <p className="mt-0.5 text-sm text-gray-500">
            Browse and edit without the map
          </p>
        </Link>
        {isAdmin ? (
          <Link
            href="/settings/members"
            className="rounded-xl border border-gray-200 bg-white p-4 transition hover:border-kelly-500"
          >
            <p className="font-medium text-gray-900">Members</p>
            <p className="mt-0.5 text-sm text-gray-500">Invite family or your manager</p>
          </Link>
        ) : null}
      </div>
    </div>
  );
}
