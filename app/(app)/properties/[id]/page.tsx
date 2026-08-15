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
import { deleteProperty } from "../actions";

export const metadata = { title: "Property" };

export default async function PropertyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase } = await requireOrg();

  const { data: property } = await supabase
    .from("properties")
    .select("id, name, county, state, notes, acres")
    .eq("id", id)
    .single();
  if (!property) notFound();

  const [
    { data: parcels },
    { data: fields },
    { data: stands },
    { data: roads },
    { data: assets },
  ] = await Promise.all([
    supabase
      .from("parcels")
      .select("id, parcel_number, county, notes, acres")
      .eq("property_id", id)
      .order("parcel_number"),
    supabase
      .from("fields")
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
            {property.notes ? (
              <p className="mt-2 max-w-prose whitespace-pre-wrap text-sm text-gray-700">
                {property.notes}
              </p>
            ) : null}
          </div>
          <Link
            href="/map"
            className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600"
          >
            View on map
          </Link>
        </div>
        <div className="mt-2">
          <RowEditor entityType="property" row={property} />
        </div>
      </div>

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
                  <span className="font-medium text-gray-900">
                    Parcel {p.parcel_number}
                  </span>
                  <span className="text-sm text-pine-900">{formatAcres(p.acres)} ac</span>
                </div>
                {p.county ? (
                  <p className="text-sm text-gray-500">{p.county}</p>
                ) : null}
                {p.notes ? (
                  <p className="mt-1 text-sm text-gray-600">{p.notes}</p>
                ) : null}
                <RowEditor entityType="parcel" row={p} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">
          Fields{" "}
          <span className="text-sm font-normal text-gray-500">
            {formatNumber((fields ?? []).length)} · {formatAcres(fieldAcres)} ac
          </span>
        </h2>
        {(fields ?? []).length === 0 ? (
          <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">
            No fields yet. Add them from the map or import page.
          </p>
        ) : (
          <ul className="space-y-2">
            {(fields ?? []).map((f) => (
              <li key={f.id} className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium text-gray-900">{f.name}</span>
                  <span className="text-sm text-pine-900">{formatAcres(f.acres)} ac</span>
                </div>
                {f.notes ? <p className="mt-1 text-sm text-gray-600">{f.notes}</p> : null}
                <RowEditor entityType="field" row={f} />
              </li>
            ))}
          </ul>
        )}
      </section>

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
                  <span className="font-medium text-gray-900">{s.name}</span>
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
                  <span className="font-medium text-gray-900">{r.name}</span>
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
        <form action={deleteProperty}>
          <input type="hidden" name="id" value={property.id} />
          <button
            type="submit"
            className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
          >
            Delete property
          </button>
          <p className="mt-1 text-xs text-gray-500">
            Deletes this property and all of its parcels and fields.
          </p>
        </form>
      </section>
    </div>
  );
}
