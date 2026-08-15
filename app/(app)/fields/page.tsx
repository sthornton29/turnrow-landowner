import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { formatAcres, formatNumber } from "@/lib/format";
import RowEditor from "@/components/lists/RowEditor";

export const metadata = { title: "Fields" };

export default async function FieldsPage() {
  const { supabase } = await requireOrg();

  const [{ data: fields }, { data: properties }] = await Promise.all([
    supabase
      .from("fields")
      .select("id, property_id, name, notes, acres")
      .order("name"),
    supabase.from("properties").select("id, name").order("name"),
  ]);

  const totalAcres = (fields ?? []).reduce((s, f) => s + (f.acres ?? 0), 0);

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Fields</h1>
        <p className="mt-0.5 text-sm text-gray-600">
          {formatNumber((fields ?? []).length)} fields, {formatAcres(totalAcres)} total acres
        </p>
      </div>

      {(fields ?? []).length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          No fields yet. Draw them on the{" "}
          <Link href="/map" className="font-medium text-kelly-700 hover:underline">
            map
          </Link>{" "}
          or use the{" "}
          <Link href="/import" className="font-medium text-kelly-700 hover:underline">
            import page
          </Link>
          .
        </div>
      ) : (
        (properties ?? [])
          .filter((p) => (fields ?? []).some((f) => f.property_id === p.id))
          .map((p) => {
            const propertyFields = (fields ?? []).filter(
              (f) => f.property_id === p.id
            );
            const acres = propertyFields.reduce((s, f) => s + (f.acres ?? 0), 0);
            return (
              <section key={p.id}>
                <h2 className="mb-2 text-base font-semibold text-gray-900">
                  <Link href={`/properties/${p.id}`} className="hover:underline">
                    {p.name}
                  </Link>{" "}
                  <span className="text-sm font-normal text-gray-500">
                    {formatNumber(propertyFields.length)} fields · {formatAcres(acres)} ac
                  </span>
                </h2>
                <ul className="space-y-2">
                  {propertyFields.map((f) => (
                    <li key={f.id} className="rounded-xl border border-gray-200 bg-white p-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-medium text-gray-900">{f.name}</span>
                        <span className="text-sm text-pine-900">
                          {formatAcres(f.acres)} ac
                        </span>
                      </div>
                      {f.notes ? (
                        <p className="mt-1 text-sm text-gray-600">{f.notes}</p>
                      ) : null}
                      <RowEditor entityType="field" row={f} />
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
