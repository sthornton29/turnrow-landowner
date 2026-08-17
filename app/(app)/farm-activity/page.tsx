import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import { formatAcres, formatDollars, formatNumber } from "@/lib/format";
import {
  harvestStatus,
  yieldPerAcre,
  yieldUnitLabel,
  type FarmFieldDataRow,
  type FieldMappingRow,
} from "@/lib/farmDisplay";

export const metadata = { title: "Farm Data" };

export default async function FarmActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; connection?: string; property?: string }>;
}) {
  const { supabase } = await requireOrg();
  const params = await searchParams;

  const [
    { data: connections },
    { data: mappings },
    { data: farmData },
    { data: fields },
    { data: properties },
    { data: marketingPrices },
  ] = await Promise.all([
    supabase.from("farm_connections").select("id, label, scopes, status, last_synced_at, last_error"),
    supabase.from("field_mappings").select("*"),
    supabase.from("farm_field_data").select("*").order("crop_year", { ascending: false }),
    supabase.from("fields").select("id, name, property_id"),
    supabase.from("properties").select("id, name").order("name"),
    supabase
      .from("farm_marketing_prices")
      .select("crop, crop_year, projected_avg_price, unit, is_final, as_of")
      .eq("crop_year", new Date().getFullYear()),
  ]);

  // Farm Data lands on the DATA. With no connections yet, the share-code
  // entry stays front and center on the connections page instead.
  if ((connections ?? []).length === 0) redirect("/farms");

  const allData = (farmData ?? []) as FarmFieldDataRow[];
  const years = Array.from(new Set(allData.map((d) => d.crop_year))).sort((a, b) => b - a);
  const currentYear = new Date().getFullYear();
  const year = Number(params.year) || years[0] || currentYear;
  const connectionFilter = params.connection ?? "";
  const propertyFilter = params.property ?? "";

  const fieldById = new Map((fields ?? []).map((f) => [f.id, f]));
  const propertyNameById = new Map((properties ?? []).map((p) => [p.id, p.name]));
  const connectionById = new Map((connections ?? []).map((c) => [c.id, c]));
  const mappingByKey = new Map(
    ((mappings ?? []) as FieldMappingRow[]).map((m) => [
      `${m.farm_connection_id}|${m.remote_field_id}`,
      m,
    ])
  );

  interface Row {
    data: FarmFieldDataRow;
    mapping: FieldMappingRow | null;
    fieldName: string;
    propertyId: string | null;
    propertyName: string;
  }

  const rows: Row[] = allData
    .filter((d) => d.crop_year === year)
    .filter((d) => !connectionFilter || d.farm_connection_id === connectionFilter)
    .map((d) => {
      const mapping = mappingByKey.get(`${d.farm_connection_id}|${d.remote_field_id}`) ?? null;
      const localField = mapping?.local_field_id
        ? fieldById.get(mapping.local_field_id)
        : null;
      const propertyId =
        localField?.property_id ?? mapping?.local_property_id ?? null;
      return {
        data: d,
        mapping,
        fieldName: localField?.name ?? mapping?.remote_name ?? d.remote_field_id,
        propertyId,
        propertyName: propertyId
          ? (propertyNameById.get(propertyId) ?? "Property")
          : "Not mapped to your land yet",
      };
    })
    .filter((r) => !propertyFilter || r.propertyId === propertyFilter)
    .sort(
      (a, b) =>
        a.propertyName.localeCompare(b.propertyName) ||
        a.fieldName.localeCompare(b.fieldName)
    );

  // Group rows by property for the per-property view
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = row.propertyName;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const totalPlanted = rows.reduce((s, r) => s + (r.data.planted_acres ?? 0), 0);
  const totalHarvested = rows.reduce((s, r) => s + (r.data.harvested_acres ?? 0), 0);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Farm Data</h1>
          <p className="mt-0.5 text-sm text-gray-600">
            What your tenants planted and harvested on your land, from their
            farm software.
          </p>
        </div>
        <form className="ml-auto flex flex-wrap gap-2" method="get">
          <select name="year" defaultValue={year} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
            {(years.length ? years : [currentYear]).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <select
            name="connection"
            defaultValue={connectionFilter}
            className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="">All connections</option>
            {(connections ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <select
            name="property"
            defaultValue={propertyFilter}
            className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="">All properties</option>
            {(properties ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button className="rounded-lg bg-kelly-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-kelly-600">
            Apply
          </button>
        </form>
      </div>

      {/* Connection health strip: status + last sync at a glance, with
          the management page tucked behind Manage connections. Error
          states still surface loudly below. */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
        {(connections ?? []).map((c) => (
          <span key={c.id} className="flex items-center gap-1.5">
            <span
              className={
                "h-2 w-2 rounded-full " +
                (c.status === "active"
                  ? "bg-kelly-500"
                  : c.status === "revoked"
                    ? "bg-gray-400"
                    : "bg-red-500")
              }
            />
            <span className="font-medium text-gray-800">{c.label}</span>
            {c.last_synced_at ? (
              <span>synced {new Date(c.last_synced_at).toLocaleDateString()}</span>
            ) : null}
          </span>
        ))}
        <Link
          href="/farms"
          className="ml-auto flex items-center gap-1 font-medium text-kelly-700 hover:underline"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.765.383-.93.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.397.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.273-.806.108-1.204-.165-.397-.506-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.108-1.204l-.526-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Manage connections
        </Link>
      </div>
      {(connections ?? []).some((c) => c.status !== "active") ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {(connections ?? [])
            .filter((c) => c.status !== "active")
            .map((c) => (
              <p key={c.id}>
                {c.label}:{" "}
                {c.status === "revoked"
                  ? "your farmer ended this share."
                  : (c.last_error ?? "sync problem.")}{" "}
                <Link href="/farms" className="font-medium underline">
                  Manage connections
                </Link>
              </p>
            ))}
        </div>
      ) : null}

      {(marketingPrices ?? []).length > 0 ? (
        <div className="rounded-xl border border-kelly-100 bg-white">
          <h2 className="border-b border-kelly-100 bg-kelly-50 px-4 py-2 text-sm font-semibold text-pine-900">
            Tenant prices ({new Date().getFullYear()})
          </h2>
          <div className="flex flex-wrap gap-x-6 gap-y-1 px-4 py-2.5 text-sm">
            {(marketingPrices ?? []).map((p) => (
              <span key={p.crop} className="flex items-center gap-1.5">
                <span className="font-medium text-gray-900">{p.crop}</span>
                <span className="tabular-nums text-gray-700">
                  {p.unit === "cents_per_lb"
                    ? `${formatNumber(p.projected_avg_price ?? 0)} c/lb`
                    : `${formatDollars(p.projected_avg_price ?? 0)}/bu`}
                </span>
                <span
                  className={
                    "rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase " +
                    (p.is_final
                      ? "bg-pine-800 text-white"
                      : "bg-amber-100 text-amber-800")
                  }
                >
                  {p.is_final ? "final" : "projected"}
                </span>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {rows.length > 0 ? (
        <p className="text-sm text-gray-600">
          {formatNumber(rows.length)} plantings · {formatAcres(totalPlanted)} acres
          planted · {formatAcres(totalHarvested)} harvested
        </p>
      ) : null}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          Nothing synced for {year} yet.{" "}
          <Link href="/farms" className="font-medium text-kelly-700 hover:underline">
            Connect a farm
          </Link>{" "}
          or press Refresh now on a connection.
        </div>
      ) : (
        Array.from(groups.entries()).map(([groupName, groupRows]) => (
          <section key={groupName} className="rounded-xl border border-gray-200 bg-white">
            <h2 className="border-b border-gray-200 px-4 py-2.5 text-base font-semibold text-gray-900">
              {groupName}
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-2">Field</th>
                    <th className="px-4 py-2">Crop</th>
                    <th className="px-4 py-2 text-right">Acres</th>
                    <th className="px-4 py-2">Planted</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2 text-right">Yield</th>
                  </tr>
                </thead>
                <tbody>
                  {groupRows.map((r) => {
                    const status = harvestStatus(r.data);
                    const perAcre = yieldPerAcre(r.data);
                    const connection = connectionById.get(r.data.farm_connection_id);
                    const yieldsShared =
                      r.data.yield_shared || Boolean(connection?.scopes?.yields);
                    return (
                      <tr key={r.data.id} className="border-b border-gray-100 last:border-0">
                        <td className="px-4 py-2 font-medium text-gray-900">{r.fieldName}</td>
                        <td className="px-4 py-2">
                          {r.data.crop || "Unknown"}
                          {r.data.varieties?.length
                            ? ` (${r.data.varieties.map((v) => v.variety).join(", ")})`
                            : ""}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {formatAcres(r.data.planted_acres)}
                        </td>
                        <td className="px-4 py-2">{r.data.planting_date ?? ""}</td>
                        <td className="px-4 py-2">
                          <span
                            className={
                              "rounded-full px-2 py-0.5 text-xs font-medium " +
                              (status === "harvested"
                                ? "bg-kelly-50 text-pine-900"
                                : "bg-gray-100 text-gray-600")
                            }
                          >
                            {status === "harvested" ? "Harvested" : "Growing"}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {perAcre !== null
                            ? `${formatNumber(Math.round(perAcre * 10) / 10)} ${yieldUnitLabel(r.data.production_unit)}`
                            : status === "harvested" && !yieldsShared
                              ? "Not shared"
                              : ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </div>
  );
}
