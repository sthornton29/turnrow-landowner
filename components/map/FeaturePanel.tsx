"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { formatAcres } from "@/lib/format";
import type { EntityType, FieldGeo, ParcelGeo, PropertyGeo } from "@/types/db";
import type { AnyGeoRow } from "./types";

const TYPE_LABEL: Record<EntityType, string> = {
  property: "Property",
  parcel: "Parcel",
  field: "Field",
};

const TABLE: Record<EntityType, string> = {
  property: "properties",
  parcel: "parcels",
  field: "fields",
};

// Detail panel for a clicked polygon. Desktop: card on the right side of the
// map. Mobile: bottom sheet. Lets the user edit names/notes, start boundary
// editing, or delete the record.
export default function FeaturePanel({
  entityType,
  row,
  propertyName,
  onClose,
  onEditBoundary,
  onChanged,
}: {
  entityType: EntityType;
  row: AnyGeoRow;
  propertyName: string | null;
  onClose: () => void;
  onEditBoundary: () => void;
  onChanged: () => void; // reload map data after save/delete
}) {
  const supabase = createClient();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title =
    entityType === "parcel"
      ? `Parcel ${(row as ParcelGeo).parcel_number}`
      : (row as PropertyGeo | FieldGeo).name;

  async function saveDetails(formData: FormData) {
    setBusy(true);
    setError(null);
    const patch: Record<string, string | null> = {};
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
    patch.notes = String(formData.get("notes") ?? "").trim() || null;

    const { error: err } = await supabase
      .from(TABLE[entityType])
      .update(patch)
      .eq("id", row.id);
    setBusy(false);
    if (err) {
      setError("Could not save changes.");
      return;
    }
    setEditing(false);
    onChanged();
  }

  async function remove() {
    if (
      !window.confirm(
        `Delete this ${TYPE_LABEL[entityType].toLowerCase()}? This cannot be undone.`
      )
    ) {
      return;
    }
    setBusy(true);
    const { error: err } = await supabase
      .from(TABLE[entityType])
      .delete()
      .eq("id", row.id);
    setBusy(false);
    if (err) {
      setError("Could not delete. Properties with parcels or fields must be emptied first.");
      return;
    }
    onClose();
    onChanged();
  }

  return (
    <div className="pointer-events-auto fixed inset-x-0 bottom-16 z-30 max-h-[55%] overflow-y-auto rounded-t-2xl border-t border-gray-200 bg-white p-4 shadow-2xl md:absolute md:inset-auto md:right-4 md:top-4 md:bottom-auto md:max-h-[calc(100%-2rem)] md:w-80 md:rounded-xl md:border">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-kelly-600">
            {TYPE_LABEL[entityType]}
          </p>
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {!editing ? (
        <div className="mt-3 space-y-3">
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">Acres</dt>
              <dd className="font-medium text-gray-900">{formatAcres(row.acres)}</dd>
            </div>
            {propertyName ? (
              <div className="flex justify-between">
                <dt className="text-gray-500">Property</dt>
                <dd className="font-medium text-gray-900">{propertyName}</dd>
              </div>
            ) : null}
            {"county" in row && row.county ? (
              <div className="flex justify-between">
                <dt className="text-gray-500">County</dt>
                <dd className="font-medium text-gray-900">
                  {row.county}
                  {"state" in row && (row as PropertyGeo).state
                    ? `, ${(row as PropertyGeo).state}`
                    : ""}
                </dd>
              </div>
            ) : null}
            {row.notes ? (
              <div>
                <dt className="text-gray-500">Notes</dt>
                <dd className="mt-0.5 whitespace-pre-wrap text-gray-900">{row.notes}</dd>
              </div>
            ) : null}
          </dl>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setEditing(true)}
              className="rounded-lg bg-kelly-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-kelly-600"
            >
              Edit details
            </button>
            <button
              onClick={onEditBoundary}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Edit boundary
            </button>
            <button
              onClick={remove}
              disabled={busy}
              className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
            >
              Delete
            </button>
          </div>
          <Link
            href={
              entityType === "property"
                ? `/properties/${row.id}`
                : entityType === "field"
                  ? "/fields"
                  : "/parcels"
            }
            className="inline-block text-sm font-medium text-kelly-700 hover:underline"
          >
            Open list page
          </Link>
        </div>
      ) : (
        <form action={saveDetails} className="mt-3 space-y-3">
          {entityType === "parcel" ? (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Parcel number
              </label>
              <input
                name="parcel_number"
                defaultValue={(row as ParcelGeo).parcel_number}
                required
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-kelly-500 focus:outline-none"
              />
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Name</label>
              <input
                name="name"
                defaultValue={(row as PropertyGeo | FieldGeo).name}
                required
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-kelly-500 focus:outline-none"
              />
            </div>
          )}

          {entityType !== "field" ? (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">County</label>
              <input
                name="county"
                defaultValue={("county" in row && row.county) || ""}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-kelly-500 focus:outline-none"
              />
            </div>
          ) : null}

          {entityType === "property" ? (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">State</label>
              <input
                name="state"
                defaultValue={(row as PropertyGeo).state ?? ""}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-kelly-500 focus:outline-none"
              />
            </div>
          ) : null}

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Notes</label>
            <textarea
              name="notes"
              rows={3}
              defaultValue={row.notes ?? ""}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-kelly-500 focus:outline-none"
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
              onClick={() => setEditing(false)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
