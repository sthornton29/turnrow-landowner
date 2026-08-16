"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ENTITY_TYPE_LABELS } from "@/lib/entities";
import type { LandEntity } from "@/types/db";

// Inline editor for an entity's name, type, and notes (same expandable
// pattern as RowEditor; entities are not a map entity type, so they get
// their own small editor).
export default function EntityEditor({ entity }: { entity: LandEntity }) {
  const supabase = createClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(formData: FormData) {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase
      .from("entities")
      .update({
        name: String(formData.get("name") ?? "").trim(),
        entity_type: String(formData.get("entity_type") ?? "other"),
        notes: String(formData.get("notes") ?? "").trim() || null,
      })
      .eq("id", entity.id);
    setBusy(false);
    if (err) {
      setError("Could not save changes.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-sm font-medium text-kelly-700 hover:underline"
      >
        Edit
      </button>
    );
  }

  return (
    <form action={save} className="mt-2 w-full space-y-2 rounded-lg bg-gray-50 p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input
          name="name"
          required
          defaultValue={entity.name}
          placeholder="Entity name"
          className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
        />
        <select
          name="entity_type"
          defaultValue={entity.entity_type}
          className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
        >
          {Object.entries(ENTITY_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <textarea
          name="notes"
          rows={2}
          defaultValue={entity.notes ?? ""}
          placeholder="Notes"
          className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm sm:col-span-2"
        />
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-kelly-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-kelly-600 disabled:opacity-60"
        >
          {busy ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
