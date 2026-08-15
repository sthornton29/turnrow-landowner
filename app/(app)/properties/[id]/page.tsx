import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import { formatAcres, formatNumber } from "@/lib/format";
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

  const [{ data: parcels }, { data: fields }] = await Promise.all([
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
  ]);

  const parcelAcres = (parcels ?? []).reduce((s, p) => s + (p.acres ?? 0), 0);
  const fieldAcres = (fields ?? []).reduce((s, f) => s + (f.acres ?? 0), 0);

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
