"use client";

import { useState } from "react";
import { ASSET_TYPES, ASSET_TYPE_ORDER, ROUND_ASSET_TYPES } from "@/lib/assetTypes";
import type { AssetType } from "@/types/db";

export type AssetPlacement = "pin" | "outline" | "circle";

// Add menu > Asset: pick the type and HOW to place it before touching
// the map. Pin is the crosshair (as always); Draw outline traces the
// footprint (shops, barns, ponds); Circle is center + diameter for
// round structures (grain bins lead with it; every type can use it).
export default function AssetPlacePicker({
  onPick,
  onCancel,
}: {
  onPick: (assetType: AssetType, placement: AssetPlacement) => void;
  onCancel: () => void;
}) {
  const types = ASSET_TYPE_ORDER.filter(
    (t) => ASSET_TYPES[t].defaultGeometry === "point" && t !== "irrigation_pivot"
  );
  const [assetType, setAssetType] = useState<AssetType>("well");
  const round = ROUND_ASSET_TYPES.includes(assetType);
  const [placement, setPlacement] = useState<AssetPlacement>("pin");
  const effective: AssetPlacement = placement;

  function pickType(t: AssetType) {
    setAssetType(t);
    // Round types lead with Circle; everything else starts on Pin.
    setPlacement(ROUND_ASSET_TYPES.includes(t) ? "circle" : "pin");
  }

  const options: Array<{ key: AssetPlacement; label: string; hint: string }> = [
    { key: "pin", label: "Pin", hint: "One point, the crosshair" },
    { key: "outline", label: "Draw outline", hint: "Trace the footprint" },
    { key: "circle", label: "Circle", hint: "Center plus diameter" },
  ];
  const ordered = round
    ? [options[2], options[0], options[1]]
    : options;

  return (
    <div className="pointer-events-auto fixed inset-x-0 bottom-16 z-30 max-h-[75%] overflow-y-auto rounded-t-2xl border-t border-gray-200 bg-white p-4 shadow-2xl md:absolute md:inset-auto md:left-3 md:top-3 md:bottom-auto md:w-80 md:rounded-xl md:border">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Add an asset</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            Pick the type and how to place it. Pipes and fences are drawn from Draw.
          </p>
        </div>
        <button
          onClick={onCancel}
          aria-label="Close"
          className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <label className="mt-3 block text-sm font-medium text-gray-700">
        Type
        <select
          value={assetType}
          onChange={(e) => pickType(e.target.value as AssetType)}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-kelly-500 focus:outline-none"
        >
          {types.map((t) => (
            <option key={t} value={t}>
              {ASSET_TYPES[t].label}
            </option>
          ))}
        </select>
      </label>

      <p className="mt-3 mb-1 text-sm font-medium text-gray-700">Place it as</p>
      <div className={"grid gap-1.5 " + (round ? "grid-cols-1" : "grid-cols-3")}>
        {ordered.map((o, i) => (
          <button
            key={o.key}
            type="button"
            onClick={() => setPlacement(o.key)}
            className={
              "rounded-lg border px-2 py-2 text-left " +
              (effective === o.key
                ? "border-kelly-500 bg-kelly-50 text-pine-900"
                : "border-gray-300 text-gray-700 hover:bg-gray-50") +
              (round && i === 0 ? " ring-1 ring-kelly-200" : "")
            }
          >
            <span className="block text-sm font-medium">
              {o.label}
              {round && o.key === "circle" ? (
                <span className="ml-1.5 rounded-full bg-kelly-100 px-1.5 py-0.5 text-[10px] font-medium text-kelly-700">
                  Suggested
                </span>
              ) : null}
            </span>
            <span className="block text-[11px] leading-tight text-gray-500">{o.hint}</span>
          </button>
        ))}
      </div>

      <button
        onClick={() => onPick(assetType, effective)}
        className="mt-3 w-full rounded-lg bg-kelly-500 px-3 py-2 text-sm font-semibold text-white hover:bg-kelly-600"
      >
        {effective === "pin"
          ? "Place pin"
          : effective === "outline"
            ? "Start drawing"
            : "Place circle"}
      </button>
    </div>
  );
}
