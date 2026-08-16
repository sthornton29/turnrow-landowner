"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ENTITY_TYPE_LABELS } from "@/lib/entities";
import type { LandEntityType } from "@/types/db";

const NEW = "__new__";

// Assign or reassign the entity that holds a property, with inline
// creation of a new entity. Used on the properties list and the
// property detail page.
export default function EntityPicker({
  orgId,
  propertyId,
  entities,
  value,
}: {
  orgId: string;
  propertyId: string;
  entities: Array<{ id: string; name: string }>;
  value: string | null;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<LandEntityType>("llc");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function assign(entityId: string | null) {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase
      .from("properties")
      .update({ entity_id: entityId })
      .eq("id", propertyId);
    setBusy(false);
    if (err) {
      setError("Could not save.");
      return;
    }
    router.refresh();
  }

  async function createAndAssign() {
    if (!newName.trim()) return;
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("entities")
      .insert({
        organization_id: orgId,
        name: newName.trim(),
        entity_type: newType,
      })
      .select("id")
      .single();
    if (err || !data) {
      setBusy(false);
      setError("Could not create the entity.");
      return;
    }
    setCreating(false);
    setNewName("");
    await assign(data.id);
  }

  if (creating) {
    return (
      <span
        className="flex flex-wrap items-center gap-1.5"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Entity name"
          autoFocus
          className="w-40 rounded-lg border border-gray-300 px-2 py-1 text-sm"
        />
        <select
          value={newType}
          onChange={(e) => setNewType(e.target.value as LandEntityType)}
          className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
        >
          {Object.entries(ENTITY_TYPE_LABELS).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        <button
          onClick={createAndAssign}
          disabled={busy || !newName.trim()}
          className="rounded-lg bg-kelly-500 px-2.5 py-1 text-sm font-medium text-white hover:bg-kelly-600 disabled:opacity-60"
        >
          {busy ? "Saving..." : "Save"}
        </button>
        <button
          onClick={() => setCreating(false)}
          className="text-sm text-gray-500 hover:underline"
        >
          Cancel
        </button>
        {error ? <span className="text-sm text-red-600">{error}</span> : null}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      <select
        value={value ?? ""}
        disabled={busy}
        onChange={(e) => {
          if (e.target.value === NEW) setCreating(true);
          else assign(e.target.value || null);
        }}
        className="rounded-lg border border-gray-300 px-2 py-1 text-sm text-gray-700"
      >
        <option value="">No entity</option>
        {entities.map((entity) => (
          <option key={entity.id} value={entity.id}>
            {entity.name}
          </option>
        ))}
        <option value={NEW}>+ New entity...</option>
      </select>
      {error ? <span className="text-sm text-red-600">{error}</span> : null}
    </span>
  );
}
