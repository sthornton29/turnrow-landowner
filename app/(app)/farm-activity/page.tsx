import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import { formatAcres, formatDollars, formatNumber } from "@/lib/format";
import {
  cropColor,
  harvestStatus,
  yieldPerAcre,
  yieldUnitLabel,
  type FarmFieldDataRow,
  type FieldMappingRow,
} from "@/lib/farmDisplay";
import {
  NO_ENTITY_KEY,
  propertyRollups,
  rollups,
  scopedRollup,
  tenantName,
  type PriceRow,
  type ProjectedYieldRow,
  type Rollup,
  type RollupConnection,
  type RollupInput,
} from "@/lib/farmRollup";

export const metadata = { title: "Farm Data" };

// Farm Data: a summary band (by entity, by tenant) above the field-level
// activity. Drilling into a card sets the matching filter in the URL, so
// the dropdowns stay in sync and clearing a filter returns to the
// summary. Scope-off values read "Not shared"; acres and harvest
// progress always work because plantings are always shared.
export default async function FarmActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; connection?: string; property?: string; entity?: string }>;
}) {
  const { supabase } = await requireOrg();
  const params = await searchParams;

  const [
    { data: connections },
    { data: mappings },
    { data: farmData },
    { data: fields },
    { data: properties },
    { data: entities },
  ] = await Promise.all([
    supabase
      .from("farm_connections")
      .select("id, label, scopes, status, operation_name, last_synced_at, last_error"),
    supabase.from("field_mappings").select("*"),
    supabase.from("farm_field_data").select("*").order("crop_year", { ascending: false }),
    supabase.from("fields").select("id, name, property_id"),
    supabase.from("properties").select("id, name, entity_id").order("name"),
    supabase.from("entities").select("id, name").order("name"),
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
  const entityFilter = params.entity ?? "";

  const [{ data: marketingPrices }, { data: projectedYields }] = await Promise.all([
    supabase
      .from("farm_marketing_prices")
      .select("farm_connection_id, crop, crop_year, projected_avg_price, unit, is_final, as_of")
      .eq("crop_year", year),
    supabase
      .from("farm_projected_yields")
      .select("farm_connection_id, remote_field_id, crop, planted_acres, yield_per_acre, unit, basis")
      .eq("crop_year", year),
  ]);

  const conns = (connections ?? []) as Array<
    RollupConnection & { status: string; last_synced_at: string | null; last_error: string | null }
  >;
  const fieldById = new Map((fields ?? []).map((f) => [f.id, f]));
  const propertyById = new Map((properties ?? []).map((p) => [p.id, p]));
  const entityNameById = new Map((entities ?? []).map((e) => [e.id, e.name]));
  const connectionById = new Map(conns.map((c) => [c.id, c]));
  const mappingByKey = new Map(
    ((mappings ?? []) as FieldMappingRow[]).map((m) => [
      `${m.farm_connection_id}|${m.remote_field_id}`,
      m,
    ])
  );

  const yearData = allData.filter((d) => d.crop_year === year);
  const rollupInput: RollupInput = {
    plantings: yearData,
    mappings: (mappings ?? []) as FieldMappingRow[],
    fields: (fields ?? []).map((f) => ({ id: f.id, name: f.name, property_id: f.property_id ?? null })),
    properties: (properties ?? []).map((p) => ({ id: p.id, name: p.name, entity_id: p.entity_id ?? null })),
    entities: (entities ?? []).map((e) => ({ id: e.id, name: e.name })),
    connections: conns.map((c) => ({
      id: c.id,
      label: c.label,
      operation_name: c.operation_name ?? null,
      scopes: (c.scopes ?? null) as RollupConnection["scopes"],
    })),
    projectedYields: ((projectedYields ?? []) as ProjectedYieldRow[]).map((p) => ({
      ...p,
      planted_acres: p.planted_acres === null ? null : Number(p.planted_acres),
      yield_per_acre: p.yield_per_acre === null ? null : Number(p.yield_per_acre),
    })),
    prices: ((marketingPrices ?? []) as PriceRow[]).map((p) => ({
      ...p,
      projected_avg_price: p.projected_avg_price === null ? null : Number(p.projected_avg_price),
    })),
  };

  interface Row {
    data: FarmFieldDataRow;
    mapping: FieldMappingRow | null;
    fieldName: string;
    propertyId: string | null;
    propertyName: string;
    entityKey: string;
  }

  const rows: Row[] = yearData
    .filter((d) => !connectionFilter || d.farm_connection_id === connectionFilter)
    .map((d) => {
      const mapping = mappingByKey.get(`${d.farm_connection_id}|${d.remote_field_id}`) ?? null;
      const localField = mapping?.local_field_id ? fieldById.get(mapping.local_field_id) : null;
      const propertyId = localField?.property_id ?? mapping?.local_property_id ?? null;
      const entityId = propertyId ? (propertyById.get(propertyId)?.entity_id ?? null) : null;
      return {
        data: d,
        mapping,
        fieldName: localField?.name ?? mapping?.remote_name ?? d.remote_field_id,
        propertyId,
        propertyName: propertyId
          ? (propertyById.get(propertyId)?.name ?? "Property")
          : "Not mapped to your land yet",
        entityKey: entityId ?? NO_ENTITY_KEY,
      };
    })
    .filter((r) => !propertyFilter || r.propertyId === propertyFilter)
    // An entity filter is a land filter: unmapped plantings have no entity.
    .filter((r) => !entityFilter || (r.propertyId !== null && r.entityKey === entityFilter))
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

  const totalPlanted = rows.reduce((s, r) => s + Number(r.data.planted_acres ?? 0), 0);
  const totalHarvested = rows.reduce((s, r) => s + Number(r.data.harvested_acres ?? 0), 0);

  // ---- summary band state
  const summary = rollups(rollupInput);
  const drillEntity = entityFilter
    ? { id: entityFilter, name: entityFilter === NO_ENTITY_KEY ? "No entity" : (entityNameById.get(entityFilter) ?? "Entity") }
    : null;
  const drillConnection = connectionFilter
    ? { id: connectionFilter, name: connectionById.get(connectionFilter) ? tenantName(connectionById.get(connectionFilter)!) : "Tenant" }
    : null;
  const drillProperty = propertyFilter
    ? { id: propertyFilter, name: propertyById.get(propertyFilter)?.name ?? "Property" }
    : null;
  const atSummary = !drillEntity && !drillConnection && !drillProperty;

  const href = (p: { entity?: string; connection?: string; property?: string }) => {
    const q = new URLSearchParams();
    q.set("year", String(year));
    if (p.entity) q.set("entity", p.entity);
    if (p.connection) q.set("connection", p.connection);
    if (p.property) q.set("property", p.property);
    return `/farm-activity?${q.toString()}`;
  };

  // Level 1 parent (entity or tenant) for the breadcrumb and rows.
  const parentHref = drillEntity
    ? href({ entity: drillEntity.id, connection: drillConnection?.id })
    : drillConnection
      ? href({ connection: drillConnection.id })
      : href({});
  const parentName = drillEntity?.name ?? drillConnection?.name ?? null;

  const headerCard: Rollup | null = atSummary
    ? null
    : scopedRollup(
        rollupInput,
        { entityId: drillEntity?.id, connectionId: drillConnection?.id, propertyId: drillProperty?.id },
        drillProperty?.name ?? parentName ?? "Your land",
        drillProperty
          ? (parentName ?? null)
          : drillEntity && drillConnection
            ? drillConnection.name
            : null
      );
  const propertyRows: Rollup[] =
    !atSummary && !drillProperty
      ? propertyRollups(rollupInput, { entityId: drillEntity?.id, connectionId: drillConnection?.id })
      : [];

  const singleCard = summary.byEntity.length <= 1 && summary.byTenant.length <= 1;

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
          {(entities ?? []).length > 0 ? (
            <select
              name="entity"
              defaultValue={entityFilter}
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
            >
              <option value="">All entities</option>
              {(entities ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
              <option value={NO_ENTITY_KEY}>No entity</option>
            </select>
          ) : null}
          <select
            name="connection"
            defaultValue={connectionFilter}
            className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="">All connections</option>
            {conns.map((c) => (
              <option key={c.id} value={c.id}>
                {tenantName(c)}
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
        {conns.map((c) => (
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
      {conns.some((c) => c.status !== "active") ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {conns
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

      {/* ---- Summary band ---- */}
      {atSummary && yearData.length > 0 ? (
        singleCard ? (
          <section>
            <SummaryCard
              rollup={{
                ...(summary.byEntity[0] ?? summary.byTenant[0]),
                name: summary.byEntity[0]?.name ?? "Your land",
                subtitle: summary.byTenant[0] ? `Farmed by ${summary.byTenant[0].name}` : null,
                // The tenant card carries the unmapped count; the entity
                // card never does. Show the land view, note the rest.
                unmappedAcres: summary.byTenant[0]?.unmappedAcres ?? 0,
              }}
              href={
                summary.byEntity[0]
                  ? href({ entity: summary.byEntity[0].key })
                  : summary.byTenant[0]
                    ? href({ connection: summary.byTenant[0].key })
                    : null
              }
              year={year}
            />
          </section>
        ) : (
          <>
            {summary.byEntity.length > 0 ? (
              <section>
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">By entity</h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {summary.byEntity.map((r) => (
                    <SummaryCard key={r.key} rollup={r} href={href({ entity: r.key })} year={year} />
                  ))}
                </div>
              </section>
            ) : null}
            {summary.byTenant.length > 0 ? (
              <section>
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">By tenant</h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {summary.byTenant.map((r) => (
                    <SummaryCard key={r.key} rollup={r} href={href({ connection: r.key })} year={year} />
                  ))}
                </div>
              </section>
            ) : null}
          </>
        )
      ) : null}

      {/* ---- Drill-in: breadcrumb, scoped card, property rows ---- */}
      {!atSummary ? (
        <section className="space-y-3">
          <p className="flex flex-wrap items-center gap-1 text-sm text-gray-500">
            <Link href={href({})} className="hover:underline">
              Farm Data
            </Link>
            {parentName ? (
              <>
                <span>/</span>
                {drillProperty ? (
                  <Link href={parentHref} className="hover:underline">
                    {parentName}
                  </Link>
                ) : (
                  <span className="text-gray-900">{parentName}</span>
                )}
              </>
            ) : null}
            {drillProperty ? (
              <>
                <span>/</span>
                <span className="text-gray-900">{drillProperty.name}</span>
              </>
            ) : null}
          </p>
          {headerCard ? <SummaryCard rollup={headerCard} href={null} year={year} /> : null}
          {propertyRows.length > 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white">
              <h2 className="border-b border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-900">
                Properties
                <span className="ml-2 text-xs font-normal text-gray-500">tap one for its fields</span>
              </h2>
              <ul className="divide-y divide-gray-100">
                {propertyRows.map((p) => (
                  <li key={p.key}>
                    <Link
                      href={href({ entity: drillEntity?.id, connection: drillConnection?.id, property: p.key })}
                      className="block px-4 py-3 hover:bg-kelly-50"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                        <span className="text-sm font-medium text-gray-900">{p.name}</span>
                        <span className="text-sm tabular-nums text-gray-700">
                          {formatAcres(p.plantedAcres)} acres in crops
                        </span>
                      </div>
                      <CropBar mix={p.cropMix} total={p.plantedAcres} />
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-600">
                        <span>{cropMixLine(p.cropMix)}</span>
                        <span>
                          {formatAcres(p.harvestedAcres)} of {formatAcres(p.plantedAcres)} harvested
                        </span>
                      </div>
                      <Chips rollup={p} compact />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {atSummary && conns.length > 1 && (marketingPrices ?? []).length > 0 ? (
        <div className="rounded-xl border border-kelly-100 bg-white">
          <h2 className="border-b border-kelly-100 bg-kelly-50 px-4 py-2 text-sm font-semibold text-pine-900">
            Tenant prices ({year})
          </h2>
          <div className="flex flex-wrap gap-x-6 gap-y-1 px-4 py-2.5 text-sm">
            {(marketingPrices ?? []).map((p) => (
              <span key={`${p.farm_connection_id}-${p.crop}`} className="flex items-center gap-1.5">
                <span className="font-medium text-gray-900">{p.crop}</span>
                <span className="tabular-nums text-gray-700">{priceText(Number(p.projected_avg_price ?? 0), p.unit)}</span>
                <PriceBadge isFinal={Boolean(p.is_final)} />
                {connectionById.get(p.farm_connection_id) ? (
                  <span className="text-xs text-gray-500">{tenantName(connectionById.get(p.farm_connection_id)!)}</span>
                ) : null}
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
          {yearData.length === 0 ? (
            <>
              Nothing synced for {year} yet.{" "}
              <Link href="/farms" className="font-medium text-kelly-700 hover:underline">
                Connect a farm
              </Link>{" "}
              or press Refresh now on a connection.
            </>
          ) : (
            <>
              Nothing planted here in {year}.{" "}
              <Link href={href({})} className="font-medium text-kelly-700 hover:underline">
                Back to the summary
              </Link>
            </>
          )}
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

// ---------------------------------------------------------------- pieces

function cropMixLine(mix: Rollup["cropMix"]): string {
  return mix.map((c) => `${c.crop} ${formatAcres(c.acres)}`).join(", ");
}

function priceText(price: number, unit: string | null): string {
  return unit === "cents_per_lb" ? `${formatNumber(price)} c/lb` : `${formatDollars(price)}/bu`;
}

function PriceBadge({ isFinal }: { isFinal: boolean }) {
  return (
    <span
      className={
        "rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase " +
        (isFinal ? "bg-pine-800 text-white" : "bg-amber-100 text-amber-800")
      }
    >
      {isFinal ? "final" : "projected"}
    </span>
  );
}

// Thin stacked bar of acres by crop, colored like the map's Crops layer.
function CropBar({ mix, total }: { mix: Rollup["cropMix"]; total: number }) {
  if (total <= 0 || mix.length === 0) return null;
  return (
    <div className="mt-1.5 flex h-1.5 w-full overflow-hidden rounded bg-gray-100">
      {mix.map((c) => (
        <span
          key={c.crop}
          title={`${c.crop} ${formatAcres(c.acres)} acres`}
          style={{ width: `${(c.acres / total) * 100}%`, backgroundColor: cropColor(c.crop) }}
          className="h-full border-r border-white last:border-0"
        />
      ))}
    </div>
  );
}

// Yield and price chips, or the quiet "not shared" note.
function Chips({ rollup, compact = false }: { rollup: Rollup; compact?: boolean }) {
  const yields = rollup.yieldByCrop.filter((y) => y.yieldPerAcre !== null);
  const size = compact ? "text-[11px]" : "text-xs";
  return (
    <div className={"mt-1.5 flex flex-wrap items-center gap-1.5 " + size}>
      {yields.length > 0 ? (
        yields.map((y) => (
          <span key={y.crop} className="rounded-full bg-kelly-50 px-2 py-0.5 text-pine-900">
            <span className="font-medium">{y.crop}</span>{" "}
            <span className="tabular-nums">{formatNumber(Math.round((y.yieldPerAcre ?? 0) * 10) / 10)}</span> {y.unit}{" "}
            <span className="text-pine-900/70">{y.basis}</span>
          </span>
        ))
      ) : (
        <span className="text-gray-400">{rollup.sharedYields ? "No yields yet" : "Yields not shared"}</span>
      )}
      {rollup.prices.length > 0 ? (
        rollup.prices.map((p) => (
          <span key={`${p.tenant}-${p.crop}`} className="flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-gray-800">
            <span className="font-medium">{p.crop}</span>
            <span className="tabular-nums">{priceText(p.price, p.unit)}</span>
            <PriceBadge isFinal={p.isFinal} />
            {rollup.connectionIds.length > 1 ? <span className="text-gray-500">{p.tenant}</span> : null}
          </span>
        ))
      ) : (
        <span className="text-gray-400">{rollup.sharedPrices ? "No prices yet" : "Prices not shared"}</span>
      )}
    </div>
  );
}

function SummaryCard({ rollup, href, year }: { rollup: Rollup; href: string | null; year: number }) {
  const pct = rollup.plantedAcres > 0 ? Math.min(100, (rollup.harvestedAcres / rollup.plantedAcres) * 100) : 0;
  const body = (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-gray-900">{rollup.name}</p>
          {rollup.subtitle ? <p className="text-xs text-gray-500">{rollup.subtitle}</p> : null}
        </div>
        <p className="text-sm font-medium tabular-nums text-pine-900">
          {formatAcres(rollup.plantedAcres)} acres in crops
        </p>
      </div>
      <CropBar mix={rollup.cropMix} total={rollup.plantedAcres} />
      <p className="mt-1 text-xs text-gray-600">{cropMixLine(rollup.cropMix)}</p>
      <div className="mt-2">
        <div className="flex items-baseline justify-between text-xs text-gray-600">
          <span>
            {formatAcres(rollup.harvestedAcres)} of {formatAcres(rollup.plantedAcres)} acres harvested
          </span>
          <span className="tabular-nums">{Math.round(pct)}%</span>
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-gray-100">
          <div className="h-full rounded bg-kelly-500" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <Chips rollup={rollup} />
      <p className="mt-1.5 text-[11px] text-gray-400">
        {year} · {formatNumber(rollup.plantings)} planting{rollup.plantings === 1 ? "" : "s"}
        {rollup.propertyCount > 0 ? ` · ${rollup.propertyCount} propert${rollup.propertyCount === 1 ? "y" : "ies"}` : ""}
        {rollup.unmappedAcres > 0 ? ` · ${formatAcres(rollup.unmappedAcres)} acres not mapped to your land yet` : ""}
      </p>
    </>
  );
  const cls = "block rounded-xl border border-gray-200 bg-white p-4";
  return href ? (
    <Link href={href} className={cls + " hover:border-kelly-500 hover:bg-kelly-50/40"}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
