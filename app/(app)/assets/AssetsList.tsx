"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ASSET_TYPES, ASSET_TYPE_ORDER, CONDITION_LABELS } from "@/lib/assetTypes";
import { formatDollars, formatNumber } from "@/lib/format";
import type { AssetGeo, AssetType } from "@/types/db";

export default function AssetsList({
  assets,
  properties,
}: {
  assets: AssetGeo[];
  properties: Array<{ id: string; name: string }>;
}) {
  const [propertyFilter, setPropertyFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const propName = useMemo(
    () => new Map(properties.map((p) => [p.id, p.name])),
    [properties]
  );

  const filtered = assets.filter((a) => {
    if (!showInactive && !a.is_active) return false;
    if (propertyFilter && a.property_id !== propertyFilter) return false;
    if (typeFilter && a.asset_type !== typeFilter) return false;
    return true;
  });

  const totalValue = filtered.reduce((s, a) => s + (a.estimated_value ?? 0), 0);
  const typeCounts = new Map<AssetType, number>();
  for (const a of filtered) {
    typeCounts.set(a.asset_type, (typeCounts.get(a.asset_type) ?? 0) + 1);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Assets</h1>
        <p className="mt-0.5 text-sm text-gray-600">
          {formatNumber(filtered.length)} assets
          {totalValue > 0 ? ` · ${formatDollars(totalValue)} estimated value` : ""}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={propertyFilter}
          onChange={(e) => setPropertyFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">All properties</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">All types</option>
          {ASSET_TYPE_ORDER.map((t) => (
            <option key={t} value={t}>
              {ASSET_TYPES[t].label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="h-4 w-4 accent-kelly-500"
          />
          Show inactive
        </label>
      </div>

      {typeCounts.size > 1 ? (
        <div className="flex flex-wrap gap-1.5">
          {Array.from(typeCounts.entries()).map(([t, n]) => (
            <span
              key={t}
              className="rounded-full bg-kelly-50 px-2.5 py-0.5 text-xs font-medium text-pine-900"
            >
              {formatNumber(n)} {ASSET_TYPES[t].label.toLowerCase()}
              {n === 1 ? "" : "s"}
            </span>
          ))}
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          No assets yet. Add one from the map with the Add button (asset pin, or
          a line for pipe and fences).
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((a) => (
            <li
              key={a.id}
              className={
                "rounded-xl border bg-white p-3 " +
                (a.is_active ? "border-gray-200" : "border-gray-100 opacity-60")
              }
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-pine-900 text-xs font-bold text-white">
                  {ASSET_TYPES[a.asset_type]?.letter ?? "A"}
                </span>
                <Link
                  href={`/assets/${a.id}`}
                  className="font-medium text-gray-900 hover:underline"
                >
                  {a.name}
                </Link>
                <span className="text-sm text-gray-500">
                  {ASSET_TYPES[a.asset_type]?.label}
                  {a.property_id ? ` · ${propName.get(a.property_id) ?? ""}` : ""}
                  {a.condition ? ` · ${CONDITION_LABELS[a.condition]}` : ""}
                  {!a.is_active ? " · inactive" : ""}
                </span>
                <span className="ml-auto flex items-center gap-3">
                  {a.estimated_value !== null ? (
                    <span className="text-sm font-medium text-pine-900">
                      {formatDollars(a.estimated_value)}
                    </span>
                  ) : null}
                  {a.geom_geojson ? (
                    <Link
                      href={`/map?focus=asset:${a.id}`}
                      className="text-sm font-medium text-kelly-700 hover:underline"
                    >
                      Map
                    </Link>
                  ) : null}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
