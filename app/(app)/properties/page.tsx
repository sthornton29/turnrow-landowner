import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { formatAcres, formatNumber } from "@/lib/format";
import { createProperty } from "./actions";

export const metadata = { title: "Properties" };

export default async function PropertiesPage() {
  const { supabase } = await requireOrg();

  const [{ data: properties }, { data: parcels }, { data: fields }] =
    await Promise.all([
      supabase
        .from("properties")
        .select("id, name, county, state, notes, acres")
        .order("name"),
      supabase.from("parcels").select("id, property_id"),
      supabase.from("fields").select("id, property_id, acres"),
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

  const totalAcres = (properties ?? []).reduce((s, p) => s + (p.acres ?? 0), 0);

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Properties</h1>
          <p className="mt-0.5 text-sm text-gray-600">
            {formatNumber((properties ?? []).length)} properties,{" "}
            {formatAcres(totalAcres)} total acres
          </p>
        </div>
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
          No properties yet. Create one above, draw one on the{" "}
          <Link href="/map" className="font-medium text-kelly-700 hover:underline">
            map
          </Link>
          , or{" "}
          <Link href="/import" className="font-medium text-kelly-700 hover:underline">
            import boundaries
          </Link>
          .
        </div>
      ) : (
        <ul className="space-y-2">
          {(properties ?? []).map((p) => (
            <li key={p.id}>
              <Link
                href={`/properties/${p.id}`}
                className="block rounded-xl border border-gray-200 bg-white p-4 transition hover:border-kelly-500"
              >
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
                  {formatNumber(fieldCount.get(p.id) ?? 0)} fields (
                  {formatAcres(fieldAcres.get(p.id) ?? 0)} ac)
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
