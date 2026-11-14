import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { formatAcres, formatNumber } from "@/lib/format";
import { ENTITY_TYPE_LABELS } from "@/lib/entities";
import PropertySectionTabs from "@/components/entities/PropertySectionTabs";
import type { LandEntity } from "@/types/db";
import NewEntityForm from "./NewEntityForm";

export const metadata = { title: "Entities" };

export default async function EntitiesPage() {
  const { supabase, isAdmin } = await requireOrg();

  const [{ data: entities }, { data: properties }] = await Promise.all([
    supabase.from("entities").select("*").order("name"),
    supabase.from("properties").select("id, name, acres, entity_id").order("name"),
  ]);

  const entityList = (entities ?? []) as LandEntity[];
  const propertyList = properties ?? [];
  const unassigned = propertyList.filter((p) => !p.entity_id);

  const statsOf = (entityId: string) => {
    const rows = propertyList.filter((p) => p.entity_id === entityId);
    return {
      count: rows.length,
      acres: rows.reduce((s, p) => s + (p.acres ?? 0), 0),
    };
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <PropertySectionTabs active="/entities" />
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Entities</h1>
        <p className="mt-0.5 text-sm text-gray-600">
          The LLCs, trusts, and individuals that hold title to your land.
          Assign each property to the entity that owns it.
        </p>
      </div>

      {/* Creating an entity is admin work (row level security refuses
          anyone else), so only admins see the form. */}
      {isAdmin ? (
        <details className="rounded-xl border border-gray-200 bg-white">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-kelly-700">
            + New entity
          </summary>
          <NewEntityForm />
        </details>
      ) : null}

      {entityList.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500">
          {isAdmin ? (
            <>
              No entities yet. Create one above, or choose Create new entity
              beside Held by entity when you import parcels from county
              records. An import never creates an entity on its own.
            </>
          ) : (
            "You have not been given access to any entities yet. Ask an admin on your account to add you in Settings."
          )}
        </p>
      ) : (
        <ul className="space-y-2">
          {entityList.map((entity) => {
            const stats = statsOf(entity.id);
            return (
              <li key={entity.id}>
                <Link
                  href={`/entities/${entity.id}`}
                  className="block rounded-xl border border-gray-200 bg-white p-4 transition hover:border-kelly-500"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold text-gray-900">{entity.name}</span>
                    <span className="whitespace-nowrap text-sm font-medium text-pine-900">
                      {formatAcres(stats.acres)} ac
                    </span>
                  </div>
                  <p className="mt-0.5 text-sm text-gray-500">
                    {ENTITY_TYPE_LABELS[entity.entity_type]}
                    {" · "}
                    {formatNumber(stats.count)} propert
                    {stats.count === 1 ? "y" : "ies"}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {unassigned.length > 0 ? (
        <section>
          <h2 className="mb-2 text-base font-semibold text-gray-500">
            No entity{" "}
            <span className="text-sm font-normal">
              {formatNumber(unassigned.length)} propert
              {unassigned.length === 1 ? "y" : "ies"} ·{" "}
              {formatAcres(unassigned.reduce((s, p) => s + (p.acres ?? 0), 0))} ac
            </span>
          </h2>
          <ul className="space-y-1.5">
            {unassigned.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/properties/${p.id}`}
                  className="flex items-baseline justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm hover:border-kelly-500"
                >
                  <span className="font-medium text-gray-900">{p.name}</span>
                  <span className="text-pine-900">{formatAcres(p.acres)} ac</span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs text-gray-500">
            Open a property and set Held by on its page to assign it.
          </p>
        </section>
      ) : null}
    </div>
  );
}
