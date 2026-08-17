import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { formatAcres, formatNumber } from "@/lib/format";
import { ENTITY_TYPE_LABELS, NO_ENTITY } from "@/lib/entities";
import EntityPicker from "@/components/entities/EntityPicker";
import DeletePropertyButton from "@/components/properties/DeletePropertyButton";
import PropertySectionTabs from "@/components/entities/PropertySectionTabs";
import type { LandEntity } from "@/types/db";
import { createProperty } from "./actions";

export const metadata = { title: "Properties" };

export default async function PropertiesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { supabase, profile } = await requireOrg();
  const { view } = await searchParams;

  const [
    { data: properties },
    { data: parcels },
    { data: fields },
    { data: entities },
    { data: stands },
    { data: roads },
    { data: assets },
    { data: leaseLands },
  ] = await Promise.all([
    supabase
      .from("properties")
      .select("id, name, county, state, notes, acres, entity_id, fsa_numbers")
      .order("name"),
    supabase.from("parcels").select("id, property_id"),
    supabase.from("fields").select("id, property_id, acres"),
    supabase.from("entities").select("*").order("name"),
    supabase.from("timber_stands").select("id, property_id"),
    supabase.from("roads").select("id, property_id"),
    supabase.from("assets").select("id, property_id"),
    supabase.from("lease_lands").select("id, property_id"),
  ]);

  const parcelCount = new Map<string, number>();
  for (const p of parcels ?? []) {
    parcelCount.set(p.property_id, (parcelCount.get(p.property_id) ?? 0) + 1);
  }
  const fieldCount = new Map<string, number>();
  const fieldAcres = new Map<string, number>();
  for (const f of fields ?? []) {
    fieldCount.set(f.property_id, (fieldCount.get(f.property_id) ?? 0) + 1);
    fieldAcres.set(
      f.property_id,
      (fieldAcres.get(f.property_id) ?? 0) + (f.acres ?? 0)
    );
  }

  // What deleting each property takes with it (for the confirmation).
  const countBy = (rows: Array<{ property_id: string | null }> | null) => {
    const map = new Map<string, number>();
    for (const row of rows ?? []) {
      if (!row.property_id) continue;
      map.set(row.property_id, (map.get(row.property_id) ?? 0) + 1);
    }
    return map;
  };
  const standCount = countBy(stands);
  const roadCount = countBy(roads);
  const assetCount = countBy(assets);
  const leaseLinkCount = countBy(leaseLands);
  const cascadeSummaryOf = (propertyId: string) => {
    const parts = [
      [parcelCount.get(propertyId) ?? 0, "parcel"],
      [fieldCount.get(propertyId) ?? 0, "field"],
      [standCount.get(propertyId) ?? 0, "timber stand"],
      [roadCount.get(propertyId) ?? 0, "road"],
      [assetCount.get(propertyId) ?? 0, "asset"],
    ] as Array<[number, string]>;
    return parts
      .filter(([count]) => count > 0)
      .map(([count, label]) => `${count} ${label}${count === 1 ? "" : "s"}`)
      .join(", ");
  };

  const totalAcres = (properties ?? []).reduce((s, p) => s + (p.acres ?? 0), 0);
  const entityList = (entities ?? []) as LandEntity[];
  const hasEntities = entityList.length > 0;
  // Grouped by entity is the default once entities exist; ?view=flat keeps
  // the plain list one tap away.
  const grouped = hasEntities && view !== "flat";

  // Entity groups in name order, then the no-entity bucket last.
  const groups: Array<{ key: string; label: string | null; entity: LandEntity | null }> = [
    ...entityList.map((e) => ({ key: e.id, label: e.name, entity: e })),
    { key: NO_ENTITY, label: null, entity: null },
  ];

  const propertyCard = (p: NonNullable<typeof properties>[number]) => (
    <li key={p.id} className="rounded-xl border border-gray-200 bg-white p-4 transition hover:border-kelly-500">
      <Link href={`/properties/${p.id}`} className="block">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-semibold text-gray-900">{p.name}</span>
          <span className="whitespace-nowrap text-sm font-medium text-pine-900">
            {formatAcres(p.acres)} ac
          </span>
        </div>
        <p className="mt-0.5 text-sm text-gray-500">
          {[p.county, p.state].filter(Boolean).join(", ") || "No county set"}
          {" · "}
          {formatNumber(parcelCount.get(p.id) ?? 0)} parcels
          {" · "}
          {formatNumber(fieldCount.get(p.id) ?? 0)} ag fields (
          {formatAcres(fieldAcres.get(p.id) ?? 0)} ac)
          {(p.fsa_numbers ?? []).length > 0
            ? ` · FSA ${(p.fsa_numbers as string[]).join(", ")}`
            : ""}
        </p>
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-500">
        <span className="text-xs">Held by</span>
        <EntityPicker
          orgId={profile.organization_id!}
          propertyId={p.id}
          entities={entityList}
          value={p.entity_id}
        />
        <span className="ml-auto">
          <DeletePropertyButton
            propertyId={p.id}
            propertyName={p.name}
            cascadeSummary={cascadeSummaryOf(p.id)}
            leaseLinkCount={leaseLinkCount.get(p.id) ?? 0}
          />
        </span>
      </div>
    </li>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <PropertySectionTabs active="/properties" />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Properties</h1>
          <p className="mt-0.5 text-sm text-gray-600">
            {formatNumber((properties ?? []).length)} properties,{" "}
            {formatAcres(totalAcres)} total acres
          </p>
        </div>
        {hasEntities ? (
          <div className="flex overflow-hidden rounded-lg border border-gray-300 bg-white">
            <Link
              href="/properties"
              className={
                "px-3 py-1.5 text-sm font-medium " +
                (grouped ? "bg-kelly-500 text-white" : "text-gray-600 hover:bg-gray-50")
              }
            >
              By entity
            </Link>
            <Link
              href="/properties?view=flat"
              className={
                "px-3 py-1.5 text-sm font-medium " +
                (!grouped ? "bg-kelly-500 text-white" : "text-gray-600 hover:bg-gray-50")
              }
            >
              All
            </Link>
          </div>
        ) : null}
      </div>

      {/* Create a property without a boundary (boundary can be added on the map) */}
      <details className="rounded-xl border border-gray-200 bg-white">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-kelly-700">
          + New property
        </summary>
        <form action={createProperty} className="flex flex-wrap gap-2 px-4 pb-4">
          <input
            name="name"
            required
            placeholder="Property name"
            className="min-w-48 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <input
            name="county"
            placeholder="County"
            className="w-36 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <input
            name="state"
            placeholder="State"
            className="w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <input
            name="fsa_numbers"
            placeholder="FSA numbers (comma separated, optional)"
            className="min-w-56 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          {hasEntities ? (
            <select
              name="entity_id"
              defaultValue=""
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">No entity</option>
              {entityList.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          ) : null}
          <button
            type="submit"
            className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600"
          >
            Create
          </button>
        </form>
      </details>

      {(properties ?? []).length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          No properties yet. The fastest start:{" "}
          <Link
            href="/import/county"
            className="font-medium text-kelly-700 hover:underline"
          >
            import your parcels from county records
          </Link>{" "}
          (no files needed). You can also create one above, draw on the{" "}
          <Link href="/map" className="font-medium text-kelly-700 hover:underline">
            map
          </Link>
          , or{" "}
          <Link href="/import" className="font-medium text-kelly-700 hover:underline">
            upload boundary files
          </Link>
          .
        </div>
      ) : grouped ? (
        <div className="space-y-5">
          {groups.map((group) => {
            const rows = (properties ?? []).filter((p) =>
              group.key === NO_ENTITY ? !p.entity_id : p.entity_id === group.key
            );
            if (rows.length === 0) return null;
            const acres = rows.reduce((s, p) => s + (p.acres ?? 0), 0);
            return (
              <section key={group.key}>
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <h2 className="text-base font-semibold text-gray-900">
                    {group.entity ? (
                      <Link
                        href={`/entities/${group.entity.id}`}
                        className="hover:underline"
                      >
                        {group.entity.name}
                      </Link>
                    ) : (
                      <span className="text-gray-500">No entity</span>
                    )}{" "}
                    {group.entity ? (
                      <span className="text-xs font-normal text-gray-500">
                        {ENTITY_TYPE_LABELS[group.entity.entity_type]}
                      </span>
                    ) : null}
                  </h2>
                  <span className="text-sm font-medium text-pine-900">
                    {formatNumber(rows.length)} propert
                    {rows.length === 1 ? "y" : "ies"} · {formatAcres(acres)} ac
                  </span>
                </div>
                <ul className="space-y-2">{rows.map(propertyCard)}</ul>
              </section>
            );
          })}
        </div>
      ) : (
        <ul className="space-y-2">{(properties ?? []).map(propertyCard)}</ul>
      )}
    </div>
  );
}
