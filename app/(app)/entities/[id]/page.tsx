import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import { formatAcres, formatNumber } from "@/lib/format";
import { ENTITY_TYPE_LABELS } from "@/lib/entities";
import EntityDocuments from "@/components/documents/EntityDocuments";
import type { LandEntity } from "@/types/db";
import EntityDangerZone from "./EntityDangerZone";
import EntityEditor from "./EntityEditor";
import GovPaymentsCard from "@/components/gov/GovPaymentsCard";

export const metadata = { title: "Entity" };

export default async function EntityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, profile } = await requireOrg();

  const { data: entity } = await supabase
    .from("entities")
    .select("*")
    .eq("id", id)
    .single();
  if (!entity) notFound();
  const landEntity = entity as LandEntity;

  const [
    { data: properties },
    { data: aliases },
    { data: otherEntities },
    { count: documentCount },
  ] = await Promise.all([
    supabase
      .from("properties")
      .select("id, name, county, state, acres")
      .eq("entity_id", id)
      .order("name"),
    supabase
      .from("entity_aliases")
      .select("alias, source_county, source_state")
      .eq("entity_id", id)
      .order("alias"),
    supabase.from("entities").select("id, name").neq("id", id).order("name"),
    supabase
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("entity_type", "entity")
      .eq("entity_id", id),
  ]);

  const totalAcres = (properties ?? []).reduce((s, p) => s + (p.acres ?? 0), 0);
  const isOwner = profile.role === "owner";

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <div>
        <Link href="/entities" className="text-sm text-gray-500 hover:underline">
          &larr; Entities
        </Link>
        <div className="mt-1">
          <h1 className="text-2xl font-semibold text-gray-900">{landEntity.name}</h1>
          <p className="mt-0.5 text-sm text-gray-600">
            {ENTITY_TYPE_LABELS[landEntity.entity_type]}
            {" · "}
            {formatNumber((properties ?? []).length)} propert
            {(properties ?? []).length === 1 ? "y" : "ies"}
            {" · "}
            {formatAcres(totalAcres)} acres
          </p>
          {landEntity.notes ? (
            <p className="mt-2 max-w-prose whitespace-pre-wrap text-sm text-gray-700">
              {landEntity.notes}
            </p>
          ) : null}
          <div className="mt-2">
            <EntityEditor entity={landEntity} />
          </div>
        </div>
      </div>

      <GovPaymentsCard
        supabase={supabase}
        propertyIds={(properties ?? []).map((p) => p.id)}
        title="Base acres and government payments across this entity"
      />

      <section>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">
          Properties{" "}
          <span className="text-sm font-normal text-gray-500">
            {formatNumber((properties ?? []).length)} · {formatAcres(totalAcres)} ac
          </span>
        </h2>
        {(properties ?? []).length === 0 ? (
          <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">
            No properties assigned yet. Assign them from the{" "}
            <Link href="/properties" className="font-medium text-kelly-700 hover:underline">
              Properties list
            </Link>{" "}
            or a property{"'"}s page.
          </p>
        ) : (
          <ul className="space-y-2">
            {(properties ?? []).map((p) => (
              <li key={p.id}>
                <Link
                  href={`/properties/${p.id}`}
                  className="block rounded-lg border border-gray-200 bg-white p-3 hover:border-kelly-500"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-gray-900">{p.name}</span>
                    <span className="text-sm text-pine-900">{formatAcres(p.acres)} ac</span>
                  </div>
                  <p className="text-sm text-gray-500">
                    {[p.county, p.state].filter(Boolean).join(", ") || "No county set"}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(aliases ?? []).length > 0 ? (
        <section>
          <h2 className="mb-2 text-lg font-semibold text-gray-900">
            Known county-record spellings
          </h2>
          <ul className="space-y-1">
            {(aliases ?? []).map((a, i) => (
              <li
                key={i}
                className="flex flex-wrap items-baseline gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
              >
                <span className="font-medium text-gray-900">{a.alias}</span>
                <span className="ml-auto text-xs text-gray-500">
                  {[a.source_county, a.source_state].filter(Boolean).join(", ")}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs text-gray-500">
            Saved from county imports. Future owner searches group these
            spellings under this entity automatically.
          </p>
        </section>
      ) : null}

      <section>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">Documents</h2>
        <p className="mb-2 text-sm text-gray-500">
          Operating agreements, formation documents, EIN letters.
        </p>
        <EntityDocuments
          orgId={profile.organization_id!}
          entityType="entity"
          entityId={landEntity.id}
        />
      </section>

      {isOwner ? (
        <EntityDangerZone
          entityId={landEntity.id}
          entityName={landEntity.name}
          targets={otherEntities ?? []}
          propertyCount={(properties ?? []).length}
          aliasCount={(aliases ?? []).length}
          documentCount={documentCount ?? 0}
        />
      ) : null}
    </div>
  );
}
