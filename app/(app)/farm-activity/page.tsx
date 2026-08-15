import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { formatAcres, formatNumber } from "@/lib/format";
import {
  harvestStatus,
  yieldPerAcre,
  yieldUnitLabel,
  type FarmFieldDataRow,
  type FieldMappingRow,
} from "@/lib/farmDisplay";

export const metadata = { title: "Farm activity" };

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
  ] = await Promise.all([
    supabase.from("farm_connections").select("id, label, scopes, status, last_synced_at"),
    supabase.from("field_mappings").select("*"),
    supabase.from("farm_field_data").select("*").order("crop_year", { ascending: false }),
    supabase.from("fields").select("id, name, property_id"),
    supabase.from("properties").select("id, name").order("name"),
  ]);

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
          <h1 className="text-xl font-semibold text-gray-900">Farm activity</h1>
          <p className="mt-0.5 text-sm text-gray-600">
            What your tenants planted and harvested on your land, from their
            farm software.{" "}
            <Link href="/farms" className="font-medium text-kelly-700 hover:underline">
              Manage connections
            </Link>
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
