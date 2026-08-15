import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { formatAcres, formatNumber } from "@/lib/format";
import RowEditor from "@/components/lists/RowEditor";

export const metadata = { title: "Parcels" };

export default async function ParcelsPage() {
  const { supabase } = await requireOrg();

  const [{ data: parcels }, { data: properties }] = await Promise.all([
    supabase
      .from("parcels")
      .select("id, property_id, parcel_number, county, notes, acres, deeded_acres, source")
      .order("parcel_number"),
    supabase.from("properties").select("id, name"),
  ]);

  const propName = new Map((properties ?? []).map((p) => [p.id, p.name]));
  const totalAcres = (parcels ?? []).reduce((s, p) => s + (p.acres ?? 0), 0);

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Parcels</h1>
        <p className="mt-0.5 text-sm text-gray-600">
          {formatNumber((parcels ?? []).length)} parcels, {formatAcres(totalAcres)} total acres
        </p>
      </div>

      {(parcels ?? []).length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          No parcels yet. Add them from the{" "}
          <Link href="/map" className="font-medium text-kelly-700 hover:underline">
            map
          </Link>{" "}
          or the{" "}
          <Link href="/import" className="font-medium text-kelly-700 hover:underline">
            import page
          </Link>
          .
        </div>
      ) : (
        <ul className="space-y-2">
          {(parcels ?? []).map((p) => (
            <li key={p.id} className="rounded-xl border border-gray-200 bg-white p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium text-gray-900">
                  Parcel {p.parcel_number}
                </span>
                <span className="text-sm text-pine-900">
                  {formatAcres(p.acres)} ac
                  {p.deeded_acres !== null
                    ? ` (deeded ${formatAcres(p.deeded_acres)})`
                    : ""}
                </span>
              </div>
              <p className="text-sm text-gray-500">
                {propName.get(p.property_id) ?? "Unknown property"}
                {p.county ? ` · ${p.county}` : ""}
              </p>
              {p.source ? <p className="text-xs text-gray-400">{p.source}</p> : null}
              {p.notes ? <p className="mt-1 text-sm text-gray-600">{p.notes}</p> : null}
              <RowEditor entityType="parcel" row={p} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
