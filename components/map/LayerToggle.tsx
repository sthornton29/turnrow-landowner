"use client";

import type { LayerVisibility } from "./types";

const LAYERS: Array<{ key: keyof LayerVisibility; label: string }> = [
  { key: "property", label: "Properties" },
  { key: "parcel", label: "Parcels" },
  { key: "field", label: "Ag Fields" },
  { key: "pasture", label: "Pastures" },
  { key: "wetland", label: "Wetlands" },
  { key: "timber_stand", label: "Timber" },
  { key: "road", label: "Roads" },
  { key: "easement", label: "Easements" },
  { key: "asset", label: "Assets" },
];

export default function LayerToggle({
  visibility,
  onChange,
}: {
  visibility: LayerVisibility;
  onChange: (v: LayerVisibility) => void;
}) {
  return (
    <div className="rounded-lg bg-white/95 p-2 shadow-md">
      <p className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
        Layers
      </p>
      {LAYERS.map((layer) => (
        <label
          key={layer.key}
          className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm text-gray-800 hover:bg-gray-50"
        >
          <input
            type="checkbox"
            checked={visibility[layer.key]}
            onChange={(e) =>
              onChange({ ...visibility, [layer.key]: e.target.checked })
            }
            className="h-4 w-4 accent-kelly-500"
          />
          {layer.label}
        </label>
      ))}
    </div>
  );
}
