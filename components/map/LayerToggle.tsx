"use client";

import type { LayerVisibility } from "./types";

// Land-use layers first; maintenance issues are their own set below a
// rule so problems can be hidden without touching the land view.
// SIZING ASSUMPTION: every layer name must fit ON ONE LINE at 13px in
// the 11.5rem left column (MapView.tsx), which leaves ~136px for the
// label; "Pastures/Grassland" (108px) and a future "Government
// payments" (131px) are the yardstick. Check new names against it.
const LAYERS: Array<{ key: keyof LayerVisibility; label: string }> = [
  { key: "property", label: "Properties" },
  { key: "parcel", label: "Parcels" },
  { key: "field", label: "Ag Fields" },
  { key: "pasture", label: "Pastures/Grassland" },
  { key: "wetland", label: "Wetlands" },
  { key: "pollinator_habitat", label: "Pollinator habitat" },
  { key: "timber_stand", label: "Timber" },
  { key: "cemetery", label: "Cemeteries" },
  { key: "road", label: "Roads" },
  { key: "easement", label: "Easements" },
  { key: "asset", label: "Assets" },
];

// Name labels only, split from the layer toggles: "Property names" is
// the property boundary labels; "Field names" covers EVERY sub-property
// item's name label (ag fields, pastures, timber, wetlands, pollinator
// habitats, cemeteries, roads, easements, parcels, asset names, issue
// names). Polygons,
// markers, and asset letters are untouched.
export interface LabelVisibility {
  property: boolean;
  items: boolean;
}

export default function LayerToggle({
  visibility,
  onChange,
  labels,
  onLabelsChange,
  neighborsOn,
  onNeighborsChange,
  neighborsHint,
}: {
  visibility: LayerVisibility;
  onChange: (v: LayerVisibility) => void;
  labels: LabelVisibility;
  onLabelsChange: (v: LabelVisibility) => void;
  neighborsOn: boolean;
  onNeighborsChange: (on: boolean) => void;
  // One-line status under the Neighbors row ("Zoom in to see
  // neighbors", "Neighbors not available in this county yet", ...).
  neighborsHint: string | null;
}) {
  const row = (key: keyof LayerVisibility, label: string, accent = "accent-kelly-500") => (
    <label
      key={key}
      className="flex cursor-pointer items-center gap-2 whitespace-nowrap rounded px-1 py-0.5 text-[13px] text-gray-800 hover:bg-gray-50"
    >
      <input
        type="checkbox"
        checked={visibility[key]}
        onChange={(e) => onChange({ ...visibility, [key]: e.target.checked })}
        className={"h-4 w-4 " + accent}
      />
      {label}
    </label>
  );
  const labelRow = (key: keyof LabelVisibility, label: string, title: string) => (
    <label
      key={key}
      title={title}
      className="flex cursor-pointer items-center gap-2 whitespace-nowrap rounded px-1 py-0.5 text-[13px] text-gray-800 hover:bg-gray-50"
    >
      <input
        type="checkbox"
        checked={labels[key]}
        onChange={(e) => onLabelsChange({ ...labels, [key]: e.target.checked })}
        className="h-4 w-4 accent-kelly-500"
      />
      {label}
    </label>
  );
  return (
    <div className="rounded-lg bg-white/95 p-2 shadow-md">
      <p className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
        Layers
      </p>
      {LAYERS.map((layer) => row(layer.key, layer.label))}
      <div className="mt-1 border-t border-gray-200 pt-1">
        {row("maintenance_issue", "Maintenance issues", "accent-amber-500")}
      </div>
      <p className="mt-1 border-t border-gray-200 px-1 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
        Labels
      </p>
      {labelRow("property", "Property names", "Show or hide property name labels")}
      {labelRow(
        "items",
        "Field names",
        "Show or hide every other name label: ag fields, pastures, timber, wetlands, pollinator habitats, cemeteries, roads, easements, parcels, assets"
      )}
      <div className="mt-1 border-t border-gray-200 pt-1">
        <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap rounded px-1 py-0.5 text-[13px] text-gray-800 hover:bg-gray-50">
          <input
            type="checkbox"
            checked={neighborsOn}
            onChange={(e) => onNeighborsChange(e.target.checked)}
            className="h-4 w-4 accent-kelly-500"
          />
          Neighbors
        </label>
        {neighborsHint ? (
          <p className="whitespace-normal px-1 pb-0.5 text-[11px] leading-snug text-gray-500">
            {neighborsHint}
          </p>
        ) : null}
      </div>
    </div>
  );
}
