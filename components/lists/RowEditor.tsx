"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { EntityType } from "@/types/db";

const TABLE: Record<EntityType, string> = {
  property: "properties",
  parcel: "parcels",
  field: "fields",
};

interface EditableRow {
  id: string;
  name?: string;
  parcel_number?: string;
  county?: string | null;
  state?: string | null;
  notes?: string | null;
}

// Small expandable editor for names, county/state, and notes. Used on the
// list and detail pages as the non-map way to edit records.
export default function RowEditor({
  entityType,
  row,
}: {
  entityType: EntityType;
  row: EditableRow;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(formData: FormData) {
    setBusy(true);
    setError(null);
    const patch: Record<string, string | null> = {
      notes: String(formData.get("notes") ?? "").trim() || null,
    };
    if (entityType === "parcel") {
      patch.parcel_number = String(formData.get("parcel_number") ?? "").trim();
      patch.county = String(formData.get("county") ?? "").trim() || null;
    } else {
      patch.name = String(formData.get("name") ?? "").trim();
      if (entityType === "property") {
        patch.county = String(formData.get("county") ?? "").trim() || null;
        patch.state = String(formData.get("state") ?? "").trim() || null;
      }
    }
    const { error: err } = await supabase
      .from(TABLE[entityType])
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
      {entityType === "parcel" ? (
        <input
          name="parcel_number"
          defaultValue={row.parcel_number ?? ""}
          required
          placeholder="Parcel number"
          className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
        />
      ) : (
        <input
          name="name"
          defaultValue={row.name ?? ""}
          required
          placeholder="Name"
          className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
        />
      )}
      {entityType !== "field" ? (
        <div className="flex gap-2">
          <input
            name="county"
            defaultValue={row.county ?? ""}
            placeholder="County"
            className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
          />
          {entityType === "property" ? (
            <input
              name="state"
              defaultValue={row.state ?? ""}
              placeholder="State"
              className="w-24 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
            />
          ) : null}
        </div>
      ) : null}
      <textarea
        name="notes"
        rows={2}
        defaultValue={row.notes ?? ""}
        placeholder="Notes"
        className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
      />
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
