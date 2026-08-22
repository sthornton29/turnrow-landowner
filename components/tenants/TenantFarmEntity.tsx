"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// The tenant's farming entity on one farm connection (migration 0031).
// Linked, the lease Tenant Data panel uses that entity's own prices;
// unlinked, the whole operation's. A suggestion appears when every
// mapped field on this tenant's leased land belongs to one entity.

export interface ConnectionEntities {
  id: string;
  label: string;
  entities: Array<{ id: string; name: string; field_count?: number | null }>;
}

export interface EntitySuggestion {
  connectionId: string;
  connectionLabel: string;
  entityId: string;
  entityName: string;
}

export default function TenantFarmEntity({
  tenantId,
  linked,
  connections,
  suggestion,
}: {
  tenantId: string;
  linked: { connectionId: string; entityId: string | null; entityName: string | null } | null;
  connections: ConnectionEntities[];
  suggestion: EntitySuggestion | null;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = connections.flatMap((c) =>
    c.entities.length > 0
      ? c.entities.map((e) => ({
          value: `${c.id}|${e.id}`,
          label: `${c.label} > ${e.name}${e.field_count ? ` (${e.field_count} fields)` : ""}`,
        }))
      : [{ value: `${c.id}|`, label: `${c.label} > whole operation` }]
  );

  async function save(connectionId: string, entityId: string | null, entityName: string | null) {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase
      .from("tenants")
      .update({ farm_connection_id: connectionId, farm_entity_id: entityId, farm_entity_name: entityName })
      .eq("id", tenantId);
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    router.refresh();
  }

  async function unlink() {
    await save(null as unknown as string, null, null);
  }

  function saveChoice() {
    const [connectionId, entityId] = choice.split("|");
    if (!connectionId) return;
    const conn = connections.find((c) => c.id === connectionId);
    const ent = conn?.entities.find((e) => e.id === entityId) ?? null;
    void save(connectionId, ent ? ent.id : null, ent ? ent.name : null);
  }

  const linkedLabel = linked
    ? (() => {
        const conn = connections.find((c) => c.id === linked.connectionId);
        const name = linked.entityName ?? conn?.entities.find((e) => e.id === linked.entityId)?.name ?? null;
        return `${conn?.label ?? "Farm connection"}${name ? ` > ${name}` : " > whole operation"}`;
      })()
    : null;

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-lg font-semibold text-gray-900">Farming entity</h2>
      <p className="mt-0.5 text-xs text-gray-500">
        Which of your tenant&apos;s farming entities this record is. Linked, leases with this tenant use that
        entity&apos;s own prices from the farm connection; otherwise the whole operation&apos;s.
      </p>
      {connections.length === 0 ? (
        <p className="mt-2 text-sm text-gray-500">No farm connections yet.</p>
      ) : linked ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-full bg-kelly-50 px-2.5 py-0.5 font-medium text-pine-900">{linkedLabel}</span>
          <button
            type="button"
            onClick={unlink}
            disabled={busy}
            className="text-xs font-medium text-gray-600 hover:underline disabled:opacity-60"
          >
            Unlink
          </button>
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          {suggestion ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-kelly-100 bg-kelly-50 px-3 py-2 text-sm">
              <span className="text-pine-900">
                Suggested: <span className="font-medium">{suggestion.entityName}</span> ({suggestion.connectionLabel}) from
                the fields mapped on this tenant&apos;s leases
              </span>
              <button
                type="button"
                onClick={() => save(suggestion.connectionId, suggestion.entityId, suggestion.entityName)}
                disabled={busy}
                className="rounded-lg bg-kelly-500 px-3 py-1 text-xs font-semibold text-white hover:bg-kelly-600 disabled:opacity-60"
              >
                Use this
              </button>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
            >
              <option value="">Pick a farming entity...</option>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={saveChoice}
              disabled={busy || !choice}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              Save
            </button>
          </div>
        </div>
      )}
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </section>
  );
}
