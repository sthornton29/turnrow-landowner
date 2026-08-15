"use client";

import { useState } from "react";
import { ROAD_TYPE_LABELS } from "@/lib/assetTypes";
import type { PropertyGeo, RoadType } from "@/types/db";

export type LineKind = "road" | "underground_pipe" | "fence";

export interface NewLinePayload {
  kind: LineKind;
  name: string;
  propertyId: string | null; // required for road
  roadType: RoadType | null;
}

// Shown after a line is drawn: is it a road, buried pipe, or a fence?
export default function NewLineDialog({
  properties,
  saving,
  error,
  onSave,
  onCancel,
}: {
  properties: PropertyGeo[];
  saving: boolean;
  error: string | null;
  onSave: (payload: NewLinePayload) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<LineKind>("road");

  function handleSubmit(formData: FormData) {
    onSave({
      kind,
      name: String(formData.get("name") ?? "").trim(),
      propertyId: String(formData.get("property_id") ?? "") || null,
      roadType:
        kind === "road"
          ? ((String(formData.get("road_type") ?? "") || null) as RoadType | null)
          : null,
    });
  }

  const roadNeedsProperty = kind === "road" && properties.length === 0;

  return (
    <div className="pointer-events-auto fixed inset-x-0 bottom-16 z-30 max-h-[70%] overflow-y-auto rounded-t-2xl border-t border-gray-200 bg-white p-4 shadow-2xl md:absolute md:inset-auto md:right-4 md:top-4 md:bottom-auto md:w-80 md:rounded-xl md:border">
      <h2 className="text-lg font-semibold text-gray-900">Save line</h2>

      <form action={handleSubmit} className="mt-3 space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">This is a</label>
          <div className="grid grid-cols-3 gap-1.5">
            {(
              [
                ["road", "Road"],
                ["underground_pipe", "Pipe"],
                ["fence", "Fence"],
              ] as Array<[LineKind, string]>
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={
                  "rounded-lg border px-2 py-1.5 text-sm font-medium " +
                  (kind === k
                    ? "border-kelly-500 bg-kelly-50 text-pine-900"
                    : "border-gray-300 text-gray-600 hover:bg-gray-50")
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Name</label>
          <input
            name="name"
            required
            autoFocus
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-kelly-500 focus:outline-none"
          />
        </div>

        {kind === "road" ? (
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Road type</label>
            <select
              name="road_type"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-kelly-500 focus:outline-none"
            >
              <option value="">Not set</option>
              {Object.entries(ROAD_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Property{kind !== "road" ? " (optional)" : ""}
          </label>
          {roadNeedsProperty ? (
            <p className="text-sm text-red-600">
              Create a property first; roads must belong to one.
            </p>
          ) : (
            <select
              name="property_id"
              required={kind === "road"}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-kelly-500 focus:outline-none"
            >
              {kind !== "road" ? <option value="">None</option> : null}
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving || roadNeedsProperty}
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
