"use client";

import { useState } from "react";
import { formatAcres } from "@/lib/format";
import type { EntityType, PropertyGeo } from "@/types/db";

type BoundaryType = "field" | "parcel" | "property" | "timber_stand";

export interface NewBoundaryPayload {
  entityType: EntityType;
  name: string; // parcel number when entityType is "parcel"
  propertyId: string | null; // required for parcel/field/timber_stand
  county: string | null;
  state: string | null;
}

const TYPE_LABEL: Record<BoundaryType, string> = {
  field: "Field",
  parcel: "Parcel",
  property: "Property",
  timber_stand: "Timber",
};

// Shown after a polygon is drawn: pick what it is, name it, and save.
// The property whose boundary contains the drawing is preselected.
export default function NewBoundaryDialog({
  approxAcres,
  properties,
  suggestedPropertyId = null,
  saving,
  error,
  onSave,
  onCancel,
}: {
  approxAcres: number | null;
  properties: PropertyGeo[];
  suggestedPropertyId?: string | null;
  saving: boolean;
  error: string | null;
  onSave: (payload: NewBoundaryPayload) => void;
  onCancel: () => void;
}) {
  const [entityType, setEntityType] = useState<BoundaryType>(
    properties.length > 0 ? "field" : "property"
  );
  const [propertyId, setPropertyId] = useState(
    suggestedPropertyId ?? properties[0]?.id ?? ""
  );
  const needsProperty = entityType !== "property";

  function handleSubmit(formData: FormData) {
    onSave({
      entityType,
      name: String(formData.get("name") ?? "").trim(),
      propertyId: needsProperty
        ? String(formData.get("property_id") ?? "") || null
        : null,
      county: String(formData.get("county") ?? "").trim() || null,
      state: String(formData.get("state") ?? "").trim() || null,
    });
  }

  return (
    <div className="pointer-events-auto fixed inset-x-0 bottom-16 z-30 max-h-[70%] overflow-y-auto rounded-t-2xl border-t border-gray-200 bg-white p-4 shadow-2xl md:absolute md:inset-auto md:right-4 md:top-4 md:bottom-auto md:w-80 md:rounded-xl md:border">
      <h2 className="text-lg font-semibold text-gray-900">Save boundary</h2>
      {approxAcres !== null ? (
        <p className="mt-0.5 text-sm text-gray-500">
          About {formatAcres(approxAcres)} acres (exact acres computed on save)
        </p>
      ) : null}

      <form action={handleSubmit} className="mt-3 space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">This is a</label>
          <div className="grid grid-cols-4 gap-1.5">
            {(Object.keys(TYPE_LABEL) as BoundaryType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setEntityType(t)}
                className={
                  "rounded-lg border px-1 py-1.5 text-xs font-medium " +
                  (entityType === t
                    ? "border-kelly-500 bg-kelly-50 text-pine-900"
                    : "border-gray-300 text-gray-600 hover:bg-gray-50")
                }
              >
                {TYPE_LABEL[t]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            {entityType === "parcel"
              ? "Parcel number"
              : entityType === "timber_stand"
                ? "Stand name or number"
                : "Name"}
          </label>
          <input
            name="name"
            required
            autoFocus
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-kelly-500 focus:outline-none"
          />
        </div>

        {needsProperty ? (
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Property
              {suggestedPropertyId && propertyId === suggestedPropertyId ? (
                <span
                  className="ml-1.5 rounded-full bg-kelly-100 px-2 py-0.5 text-[10px] font-medium text-kelly-700"
                  title="The drawing sits inside this property; confirm or change it"
                >
                  Suggested from location
                </span>
              ) : null}
            </label>
            {properties.length === 0 ? (
              <p className="text-sm text-red-600">
                Create a property first; this must belong to one.
              </p>
            ) : (
              <select
                name="property_id"
                required
                value={propertyId}
                onChange={(e) => setPropertyId(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-kelly-500 focus:outline-none"
              >
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">County</label>
              <input
                name="county"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-kelly-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">State</label>
              <input
                name="state"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-kelly-500 focus:outline-none"
              />
            </div>
          </div>
        )}

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving || (needsProperty && properties.length === 0)}
            className="rounded-lg bg-kelly-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-kelly-600 disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Discard
          </button>
        </div>
      </form>
    </div>
  );
}
