"use client";

import { useState } from "react";
import { ASSET_TYPES, ASSET_TYPE_ORDER } from "@/lib/assetTypes";
import type { AssetType, PropertyGeo } from "@/types/db";

export interface NewAssetPayload {
  assetType: AssetType;
  name: string;
  propertyId: string | null;
}

// Shown after a pin is placed with the crosshair. Type-specific details are
// filled in afterward on the asset page.
export default function NewAssetDialog({
  properties,
  saving,
  error,
  onSave,
  onCancel,
}: {
  properties: PropertyGeo[];
  saving: boolean;
  error: string | null;
  onSave: (payload: NewAssetPayload) => void;
  onCancel: () => void;
}) {
  // Point-placeable types only (pipe and fence are drawn as lines).
  const pointTypes = ASSET_TYPE_ORDER.filter(
    (t) => ASSET_TYPES[t].defaultGeometry === "point"
  );
  const [assetType, setAssetType] = useState<AssetType>("well");

  function handleSubmit(formData: FormData) {
    onSave({
      assetType,
      name: String(formData.get("name") ?? "").trim(),
      propertyId: String(formData.get("property_id") ?? "") || null,
    });
  }

  return (
    <div className="pointer-events-auto fixed inset-x-0 bottom-16 z-30 max-h-[70%] overflow-y-auto rounded-t-2xl border-t border-gray-200 bg-white p-4 shadow-2xl md:absolute md:inset-auto md:right-4 md:top-4 md:bottom-auto md:w-80 md:rounded-xl md:border">
      <h2 className="text-lg font-semibold text-gray-900">Save asset</h2>
      <p className="mt-0.5 text-sm text-gray-500">
        Only a name is required. Add specs, photos, and documents on the asset
        page afterward.
      </p>

      <form action={handleSubmit} className="mt-3 space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Type</label>
          <select
            value={assetType}
            onChange={(e) => setAssetType(e.target.value as AssetType)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-kelly-500 focus:outline-none"
          >
            {pointTypes.map((t) => (
              <option key={t} value={t}>
                {ASSET_TYPES[t].label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Name</label>
          <input
            name="name"
            required
            autoFocus
            placeholder={`e.g. North ${ASSET_TYPES[assetType].label.toLowerCase()}`}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-kelly-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Property (optional)
          </label>
          <select
            name="property_id"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-kelly-500 focus:outline-none"
          >
            <option value="">None</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
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
