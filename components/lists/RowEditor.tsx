"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  EDIT_FIELDS,
  ENTITY_TABLE,
  fieldDisplayValue,
  fieldPatchValue,
} from "@/components/map/FeaturePanel";
import type { EntityType } from "@/types/db";

// Small expandable editor used on the list and detail pages as the non-map
// way to edit records. Shares its field configuration with the map panel.
export default function RowEditor({
  entityType,
  row,
}: {
  entityType: EntityType;
  row: Record<string, unknown> & { id: string };
}) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fields = EDIT_FIELDS[entityType];

  async function save(formData: FormData) {
    setBusy(true);
    setError(null);
    const patch: Record<string, string | number | string[] | null> = {};
    for (const f of fields) {
      const raw = String(formData.get(f.key) ?? "").trim();
      patch[f.key] = fieldPatchValue(f, raw);
    }
    const { error: err } = await supabase
      .from(ENTITY_TABLE[entityType])
      .update(patch)
      .eq("id", row.id);
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
        {fields.map((f) => (
          <div key={f.key} className={f.input === "textarea" ? "sm:col-span-2" : ""}>
            {f.input === "textarea" ? (
              <textarea
                name={f.key}
                rows={2}
                defaultValue={String(row[f.key] ?? "")}
                placeholder={f.label}
                className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
              />
            ) : f.input === "select" ? (
              <select
                name={f.key}
                defaultValue={String(row[f.key] ?? "")}
                className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
              >
                <option value="">{f.label}: not set</option>
                {Object.entries(f.options ?? {}).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                name={f.key}
                type={f.input === "number" ? "number" : "text"}
                required={f.required}
                defaultValue={fieldDisplayValue(f, row[f.key])}
                placeholder={f.label}
                className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
              />
            )}
          </div>
        ))}
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
