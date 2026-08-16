import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { formatAcres, formatNumber } from "@/lib/format";
import { STAND_TYPE_LABELS } from "@/lib/assetTypes";
import RowEditor from "@/components/lists/RowEditor";

export const metadata = { title: "Timber" };

export default async function TimberPage() {
  const { supabase } = await requireOrg();

  const [{ data: stands }, { data: properties }] = await Promise.all([
    supabase
      .from("timber_stands")
      .select("id, property_id, name, stand_type, species, year_established, site_index, last_thinning_year, last_burn_year, notes, acres")
      .order("name"),
    supabase.from("properties").select("id, name").order("name"),
  ]);

  const totalAcres = (stands ?? []).reduce((s, t) => s + (t.acres ?? 0), 0);

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Timber</h1>
        <p className="mt-0.5 text-sm text-gray-600">
          {formatNumber((stands ?? []).length)} stands, {formatAcres(totalAcres)} total acres
        </p>
      </div>

      {(stands ?? []).length === 0 ? (
        <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          <p>
            No timber stands yet. The fastest start: run{" "}
            <span className="font-semibold text-pine-900">Timber Scan</span> on
            a property; it proposes stand boundaries from USDA land cover,
            already broken into pine, hardwood, and mixed, for you to correct
            and confirm.
          </p>
          {(properties ?? []).length > 0 ? (
            <p className="flex flex-wrap justify-center gap-2">
              {(properties ?? []).slice(0, 4).map((p) => (
                <Link
                  key={p.id}
                  href={`/timber-scan/${p.id}`}
                  className="rounded-lg border border-pine-800 px-3 py-1.5 font-medium text-pine-900 hover:bg-kelly-50"
                >
                  Scan {p.name}
                </Link>
              ))}
            </p>
          ) : null}
          <p>
            You can also draw stands on the{" "}
            <Link href="/map" className="font-medium text-kelly-700 hover:underline">
              map
            </Link>{" "}
            (Add, then Boundary, then Timber) or assign imported boundaries as
            timber stands on the{" "}
            <Link href="/import" className="font-medium text-kelly-700 hover:underline">
              import page
            </Link>
            .
          </p>
        </div>
      ) : (
        (properties ?? [])
          .filter((p) => (stands ?? []).some((s) => s.property_id === p.id))
          .map((p) => {
            const propertyStands = (stands ?? []).filter((s) => s.property_id === p.id);
            const acres = propertyStands.reduce((s, t) => s + (t.acres ?? 0), 0);
            return (
              <section key={p.id}>
                <h2 className="mb-2 text-base font-semibold text-gray-900">
                  <Link href={`/properties/${p.id}`} className="hover:underline">
                    {p.name}
                  </Link>{" "}
                  <span className="text-sm font-normal text-gray-500">
                    {formatNumber(propertyStands.length)} stands · {formatAcres(acres)} ac
                  </span>
                </h2>
                <ul className="space-y-2">
                  {propertyStands.map((s) => (
                    <li key={s.id} className="rounded-xl border border-gray-200 bg-white p-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-medium text-gray-900">{s.name}</span>
                        <span className="text-sm text-pine-900">{formatAcres(s.acres)} ac</span>
                      </div>
                      <p className="text-sm text-gray-500">
                        {[
                          s.stand_type ? STAND_TYPE_LABELS[s.stand_type] : null,
                          s.species,
                          s.year_established ? `est. ${s.year_established}` : null,
                          s.last_thinning_year ? `thinned ${s.last_thinning_year}` : null,
                          s.last_burn_year ? `burned ${s.last_burn_year}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "No stand info yet"}
                      </p>
                      {s.notes ? <p className="mt-1 text-sm text-gray-600">{s.notes}</p> : null}
                      <RowEditor entityType="timber_stand" row={s} />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
      )}
    </div>
  );
}
