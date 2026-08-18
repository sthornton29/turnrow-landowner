import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import { formatAcres, formatNumber } from "@/lib/format";
import {
  ASSET_TYPES,
  ROAD_TYPE_LABELS,
  STAND_TYPE_LABELS,
} from "@/lib/assetTypes";
import { formatDollars } from "@/lib/format";
import { allocateToProperties, loadIncomeInputs } from "@/lib/income";
import type { AssetType } from "@/types/db";
import RowEditor from "@/components/lists/RowEditor";
import { MapThumb } from "@/components/summary/Summary";
import EntityPicker from "@/components/entities/EntityPicker";
import MoveChildren from "@/components/properties/MoveChildren";
import DeletePropertyButton from "@/components/properties/DeletePropertyButton";

export const metadata = { title: "Property" };

export default async function PropertyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, profile } = await requireOrg();

  const { data: property } = await supabase
    .from("properties_geo")
    .select(
      "id, name, county, state, notes, acres, entity_id, fsa_numbers, boundary_geojson"
    )
    .eq("id", id)
    .single();
  if (!property) notFound();

  const [
    { data: parcels },
    { data: fields },
    { data: pastures },
    { data: wetlandRows },
    { data: stands },
    { data: roads },
    { data: assets },
  ] = await Promise.all([
    supabase
      .from("parcels")
      .select("id, parcel_number, county, notes, acres, deeded_acres, source")
      .eq("property_id", id)
      .order("parcel_number"),
    supabase
      .from("fields")
      .select("id, name, notes, acres, irrigated_acres")
      .eq("property_id", id)
      .order("name"),
    supabase
      .from("pastures")
      .select("id, name, notes, acres")
      .eq("property_id", id)
      .order("name"),
    supabase
      .from("wetlands")
      .select("id, name, notes, acres")
      .eq("property_id", id)
      .order("name"),
    supabase
      .from("timber_stands")
      .select("id, name, stand_type, species, year_established, site_index, last_thinning_year, last_burn_year, notes, acres")
      .eq("property_id", id)
      .order("name"),
    supabase
      .from("roads")
      .select("id, name, road_type, notes, miles")
      .eq("property_id", id)
      .order("name"),
    supabase
      .from("assets")
      .select("id, name, asset_type, condition, is_active")
      .eq("property_id", id)
      .order("name"),
  ]);

  const [{ data: entities }, { data: allProperties }, { count: leaseLinkCount }] =
    await Promise.all([
      supabase.from("entities").select("id, name").order("name"),
      supabase.from("properties").select("id, name").order("name"),
      supabase
        .from("lease_lands")
        .select("id", { count: "exact", head: true })
        .eq("property_id", id),
    ]);
  const moveTargets = allProperties ?? [];

  // Annual income allocated to this property from all leases and timber sales
  const incomeInputs = await loadIncomeInputs(supabase);
  const currentYear = new Date().getFullYear();
  const incomeYears = [currentYear - 1, currentYear, currentYear + 1]
    .map((year) => ({
      year,
      totals: allocateToProperties(incomeInputs, year).get(id) ?? {
        expected: 0,
        received: 0,
        taxesDue: 0,
        taxesPaid: 0,
      },
    }))
    .filter(
      (r) =>
        r.totals.expected > 0 ||
        r.totals.received > 0 ||
        r.totals.taxesDue > 0 ||
        r.totals.taxesPaid > 0
    );

  const parcelAcres = (parcels ?? []).reduce((s, p) => s + (p.acres ?? 0), 0);
  const fieldAcres = (fields ?? []).reduce((s, f) => s + (f.acres ?? 0), 0);
  const irrigatedAcres = (fields ?? []).reduce(
    (s, f) => s + (f.irrigated_acres ?? 0),
    0
  );
  const pastureAcres = (pastures ?? []).reduce((s, p) => s + (p.acres ?? 0), 0);
  const wetlandAcres = (wetlandRows ?? []).reduce((s, w) => s + (w.acres ?? 0), 0);
  const timberAcres = (stands ?? []).reduce((s, t) => s + (t.acres ?? 0), 0);
  const roadMiles = (roads ?? []).reduce((s, r) => s + (r.miles ?? 0), 0);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <div>
        <Link href="/properties" className="text-sm text-gray-500 hover:underline">
          &larr; Properties
        </Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">{property.name}</h1>
            <p className="mt-0.5 text-sm text-gray-600">
              {[property.county, property.state].filter(Boolean).join(", ") ||
                "No county set"}
              {" · "}
              {formatAcres(property.acres)} acres
            </p>
            {(property.fsa_numbers ?? []).length > 0 ? (
              <p className="mt-1.5 flex flex-wrap gap-1.5">
                {(property.fsa_numbers as string[]).map((n) => (
                  <span
                    key={n}
                    className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700"
                  >
                    FSA {n}
                  </span>
                ))}
              </p>
            ) : null}
            {property.notes ? (
              <p className="mt-2 max-w-prose whitespace-pre-wrap text-sm text-gray-700">
                {property.notes}
              </p>
            ) : null}
            <div className="mt-2 flex items-center gap-2 text-sm text-gray-600">
              <span>Held by</span>
              <EntityPicker
                orgId={profile.organization_id!}
                propertyId={property.id}
                entities={entities ?? []}
                value={property.entity_id}
              />
            </div>
          </div>
          <span className="flex gap-2">
            <Link
              href={`/timber-scan/${property.id}`}
              className="rounded-lg border border-pine-800 px-4 py-2 text-sm font-semibold text-pine-900 hover:bg-kelly-50"
            >
              Timber Scan
            </Link>
            <Link
              href={`/map?focus=property:${property.id}`}
              className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600"
            >
              View on map
            </Link>
          </span>
        </div>
        <div className="mt-2">
          <RowEditor entityType="property" row={property} />
        </div>
      </div>

      <MapThumb
        geometry={property.boundary_geojson}
        focus={`property:${property.id}`}
      />

      <section>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">
          Parcels{" "}
          <span className="text-sm font-normal text-gray-500">
            {formatNumber((parcels ?? []).length)} · {formatAcres(parcelAcres)} ac
          </span>
        </h2>
        {(parcels ?? []).length === 0 ? (
          <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">
            No parcels yet. Add them from the map or import page.
          </p>
        ) : (
          <ul className="space-y-2">
            {(parcels ?? []).map((p) => (
              <li key={p.id} className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <Link
                    href={`/parcels/${p.id}`}
                    className="font-medium text-gray-900 hover:underline"
                  >
                    Parcel {p.parcel_number}
                  </Link>
                  <span className="text-sm text-pine-900">
                    {formatAcres(p.acres)} ac
                    {p.deeded_acres !== null
                      ? ` (deeded ${formatAcres(p.deeded_acres)})`
                      : ""}
                  </span>
                </div>
                {p.county || p.source ? (
                  <p className="text-sm text-gray-500">
                    {[p.county, p.source].filter(Boolean).join(" · ")}
                  </p>
                ) : null}
                {p.notes ? (
                  <p className="mt-1 text-sm text-gray-600">{p.notes}</p>
                ) : null}
                <RowEditor entityType="parcel" row={p} />
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2">
          <MoveChildren
            table="parcels"
            itemLabel="parcel"
            items={(parcels ?? []).map((p) => ({
              id: p.id,
              label: `Parcel ${p.parcel_number} (${formatAcres(p.acres)} ac)`,
            }))}
            properties={moveTargets}
            currentPropertyId={property.id}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">
          Ag fields{" "}
          <span className="text-sm font-normal text-gray-500">
            {formatNumber((fields ?? []).length)} · {formatAcres(fieldAcres)} ac
            {irrigatedAcres > 0.05
              ? ` (${formatAcres(irrigatedAcres)} irrigated / ${formatAcres(Math.max(fieldAcres - irrigatedAcres, 0))} dryland)`
              : ""}
          </span>
        </h2>
        {(fields ?? []).length === 0 ? (
          <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">
            No ag fields yet. Add them from the map or import page.
          </p>
        ) : (
          <ul className="space-y-2">
            {(fields ?? []).map((f) => (
              <li key={f.id} className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <Link
                    href={`/fields/${f.id}`}
                    className="font-medium text-gray-900 hover:underline"
                  >
                    {f.name}
                  </Link>
                  <span className="text-sm text-pine-900">
                    {formatAcres(f.acres)} ac
                    {f.irrigated_acres != null && f.irrigated_acres > 0.05
                      ? ` (${formatAcres(f.irrigated_acres)} irr.)`
                      : ""}
                  </span>
                </div>
                {f.notes ? <p className="mt-1 text-sm text-gray-600">{f.notes}</p> : null}
                <RowEditor entityType="field" row={f} />
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2">
          <MoveChildren
            table="fields"
            itemLabel="ag field"
            items={(fields ?? []).map((f) => ({
              id: f.id,
              label: `${f.name} (${formatAcres(f.acres)} ac)`,
            }))}
            properties={moveTargets}
            currentPropertyId={property.id}
          />
        </div>
      </section>

      {(wetlandRows ?? []).length > 0 ? (
        <section>
          <h2 className="mb-2 text-lg font-semibold text-gray-900">
            Wetlands{" "}
            <span className="text-sm font-normal text-gray-500">
              {formatNumber((wetlandRows ?? []).length)} · {formatAcres(wetlandAcres)} ac
            </span>
          </h2>
          <ul className="space-y-2">
            {(wetlandRows ?? []).map((w) => (
              <li key={w.id} className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <Link
                    href={`/wetlands/${w.id}`}
                    className="font-medium text-gray-900 hover:underline"
                  >
                    {w.name}
                  </Link>
                  <span className="text-sm text-pine-900">{formatAcres(w.acres)} ac</span>
                </div>
                {w.notes ? <p className="mt-1 text-sm text-gray-600">{w.notes}</p> : null}
                <RowEditor entityType="wetland" row={w} />
              </li>
            ))}
          </ul>
          <div className="mt-2">
            <MoveChildren
              table="wetlands"
              itemLabel="wetland"
              items={(wetlandRows ?? []).map((w) => ({
                id: w.id,
                label: `${w.name} (${formatAcres(w.acres)} ac)`,
              }))}
              properties={moveTargets}
              currentPropertyId={property.id}
            />
          </div>
        </section>
      ) : null}

      {(pastures ?? []).length > 0 ? (
        <section>
          <h2 className="mb-2 text-lg font-semibold text-gray-900">
            Pastures{" "}
            <span className="text-sm font-normal text-gray-500">
              {formatNumber((pastures ?? []).length)} · {formatAcres(pastureAcres)} ac
            </span>
          </h2>
          <ul className="space-y-2">
            {(pastures ?? []).map((p) => (
              <li key={p.id} className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <Link
                    href={`/pastures/${p.id}`}
                    className="font-medium text-gray-900 hover:underline"
                  >
                    {p.name}
                  </Link>
                  <span className="text-sm text-pine-900">{formatAcres(p.acres)} ac</span>
                </div>
                {p.notes ? <p className="mt-1 text-sm text-gray-600">{p.notes}</p> : null}
                <RowEditor entityType="pasture" row={p} />
              </li>
            ))}
          </ul>
          <div className="mt-2">
            <MoveChildren
              table="pastures"
              itemLabel="pasture"
              items={(pastures ?? []).map((p) => ({
                id: p.id,
                label: `${p.name} (${formatAcres(p.acres)} ac)`,
              }))}
              properties={moveTargets}
              currentPropertyId={property.id}
            />
          </div>
        </section>
      ) : null}

      <section>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">
          Timber stands{" "}
          <span className="text-sm font-normal text-gray-500">
            {formatNumber((stands ?? []).length)} · {formatAcres(timberAcres)} ac
          </span>
        </h2>
        {(stands ?? []).length === 0 ? (
          <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">
            No timber stands yet. Add them from the map or import page.
          </p>
        ) : (
          <ul className="space-y-2">
            {(stands ?? []).map((s) => (
              <li key={s.id} className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <Link
                    href={`/timber/${s.id}`}
                    className="font-medium text-gray-900 hover:underline"
                  >
                    {s.name}
                  </Link>
                  <span className="text-sm text-pine-900">{formatAcres(s.acres)} ac</span>
                </div>
                <p className="text-sm text-gray-500">
                  {[
                    s.stand_type ? STAND_TYPE_LABELS[s.stand_type] : null,
                    s.species,
                    s.year_established ? `est. ${s.year_established}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "No stand info yet"}
                </p>
                <RowEditor entityType="timber_stand" row={s} />
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2">
          <MoveChildren
            table="timber_stands"
            itemLabel="timber stand"
            items={(stands ?? []).map((s) => ({
              id: s.id,
              label: `${s.name} (${formatAcres(s.acres)} ac)`,
            }))}
            properties={moveTargets}
            currentPropertyId={property.id}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">
          Roads{" "}
          <span className="text-sm font-normal text-gray-500">
            {formatNumber((roads ?? []).length)} · {roadMiles.toFixed(1)} mi
          </span>
        </h2>
        {(roads ?? []).length === 0 ? (
          <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">
            No roads yet. Draw them on the map (Add, then Road).
          </p>
        ) : (
          <ul className="space-y-2">
            {(roads ?? []).map((r) => (
              <li key={r.id} className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <Link
                    href={`/roads/${r.id}`}
                    className="font-medium text-gray-900 hover:underline"
                  >
                    {r.name}
                  </Link>
                  <span className="text-sm text-pine-900">
                    {(r.miles ?? 0).toFixed(2)} mi
                  </span>
                </div>
                {r.road_type ? (
                  <p className="text-sm text-gray-500">{ROAD_TYPE_LABELS[r.road_type]}</p>
                ) : null}
                {r.notes ? <p className="mt-1 text-sm text-gray-600">{r.notes}</p> : null}
                <RowEditor entityType="road" row={r} />
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2">
          <MoveChildren
            table="roads"
            itemLabel="road"
            items={(roads ?? []).map((r) => ({
              id: r.id,
              label: `${r.name} (${(r.miles ?? 0).toFixed(2)} mi)`,
            }))}
            properties={moveTargets}
            currentPropertyId={property.id}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">
          Assets{" "}
          <span className="text-sm font-normal text-gray-500">
            {formatNumber((assets ?? []).filter((a) => a.is_active).length)}
          </span>
        </h2>
        {(assets ?? []).length === 0 ? (
          <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">
            No assets yet. Add them from the map (Add, then Asset pin).
          </p>
        ) : (
          <ul className="space-y-2">
            {(assets ?? []).map((a) => (
              <li
                key={a.id}
                className={
                  "rounded-lg border bg-white p-3 " +
                  (a.is_active ? "border-gray-200" : "border-gray-100 opacity-60")
                }
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-pine-900 text-[10px] font-bold text-white">
                    {ASSET_TYPES[a.asset_type as AssetType]?.letter ?? "A"}
                  </span>
                  <Link
                    href={`/assets/${a.id}`}
                    className="font-medium text-gray-900 hover:underline"
                  >
                    {a.name}
                  </Link>
                  <span className="text-sm text-gray-500">
                    {ASSET_TYPES[a.asset_type as AssetType]?.label}
                    {!a.is_active ? " · inactive" : ""}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2">
          <MoveChildren
            table="assets"
            itemLabel="asset"
            items={(assets ?? []).map((a) => ({
              id: a.id,
              label: `${a.name}${a.is_active ? "" : " (inactive)"}`,
            }))}
            properties={moveTargets}
            currentPropertyId={property.id}
          />
        </div>
      </section>

      {incomeYears.length > 0 ? (
        <section>
          <h2 className="mb-2 text-lg font-semibold text-gray-900">
            Income allocated to this property
          </h2>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-2">Year</th>
                  <th className="px-4 py-2 text-right">Expected</th>
                  <th className="px-4 py-2 text-right">Received</th>
                  <th className="px-4 py-2 text-right">Taxes paid</th>
                  <th className="px-4 py-2 text-right">Net received</th>
                </tr>
              </thead>
              <tbody>
                {incomeYears.map((r) => (
                  <tr key={r.year} className="border-b border-gray-100 last:border-0">
                    <td className="px-4 py-2">
                      <Link
                        href={`/income?year=${r.year}`}
                        className="font-medium text-kelly-700 hover:underline"
                      >
                        {r.year}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatDollars(r.totals.expected)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatDollars(r.totals.received)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {r.totals.taxesPaid ? `(${formatDollars(r.totals.taxesPaid)})` : ""}
                    </td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums text-pine-900">
                      {formatDollars(r.totals.received - r.totals.taxesPaid)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="border-t border-gray-200 pt-4">
        <DeletePropertyButton
          propertyId={property.id}
          propertyName={property.name}
          cascadeSummary={[
            [(parcels ?? []).length, "parcel"],
            [(fields ?? []).length, "ag field"],
            [(pastures ?? []).length, "pasture"],
            [(wetlandRows ?? []).length, "wetland"],
            [(stands ?? []).length, "timber stand"],
            [(roads ?? []).length, "road"],
            [(assets ?? []).length, "asset"],
          ]
            .filter(([count]) => (count as number) > 0)
            .map(
              ([count, label]) => `${count} ${label}${count === 1 ? "" : "s"}`
            )
            .join(", ")}
          leaseLinkCount={leaseLinkCount ?? 0}
          redirectTo="/properties"
        />
        <p className="mt-1 text-xs text-gray-500">
          Deletes this property and everything on it (parcels, ag fields,
          pastures, wetlands, timber stands, roads, assets) and removes any
          lease land links. Leases,
          payments, and tax records are kept; tax statements on deleted
          parcels become unmatched. Move anything you want to keep to another
          property first.
        </p>
      </section>
    </div>
  );
}
