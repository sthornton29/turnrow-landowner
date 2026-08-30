"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ASSET_TYPES, ASSET_TYPE_ORDER, CONDITION_LABELS } from "@/lib/assetTypes";
import { formatDollars, formatNumber } from "@/lib/format";
import type { AssetGeo, AssetType } from "@/types/db";

// The Assets page groups by type automatically: a section per group in
// a fixed working order (irrigation first, then storage, buildings,
// everything else), each with its count and subtotals. Filtering to a
// single type collapses to the plain flat list. Bin sites nest their
// bins beneath them inside Storage.
const GROUPS: Array<{ title: string; types: AssetType[] }> = [
  { title: "Irrigation", types: ["irrigation_pivot", "well", "underground_pipe", "riser"] },
  { title: "Storage", types: ["grain_bin_site", "grain_bin"] },
  { title: "Buildings", types: ["shop", "shed", "barn", "house"] },
  { title: "Other", types: ["pond_dam", "fence", "other"] },
];
// A type added to the registry but not placed in a group lands in
// Other instead of vanishing from the page.
{
  const placed = new Set(GROUPS.flatMap((g) => g.types));
  for (const t of ASSET_TYPE_ORDER) {
    if (!placed.has(t)) GROUPS[GROUPS.length - 1].types.push(t);
  }
}

function capacityOf(a: AssetGeo): number {
  return Number(a.details?.capacity_bu) || 0;
}

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

  // A site's bins render nested beneath it; bins whose site is filtered
  // out (or that have none) list on their own.
  const visibleIds = new Set(filtered.map((a) => a.id));
  const binsBySite = new Map<string, AssetGeo[]>();
  for (const a of filtered) {
    if (a.asset_type === "grain_bin" && a.parent_asset_id && visibleIds.has(a.parent_asset_id)) {
      if (!binsBySite.has(a.parent_asset_id)) binsBySite.set(a.parent_asset_id, []);
      binsBySite.get(a.parent_asset_id)!.push(a);
    }
  }
  const nestedBinIds = new Set(
    [...binsBySite.values()].flat().map((a) => a.id)
  );

  const row = (a: AssetGeo, nested = false) => {
    const isSite = a.asset_type === "grain_bin_site";
    const siteBins = isSite ? (binsBySite.get(a.id) ?? []) : [];
    const capacity = isSite
      ? siteBins.reduce((s, b) => s + capacityOf(b), 0)
      : a.asset_type === "grain_bin"
        ? capacityOf(a)
        : 0;
    return (
      <li
        key={a.id}
        className={
          "rounded-xl border bg-white p-3 " +
          (nested ? "ml-6 " : "") +
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
            {isSite ? ` · ${siteBins.length} bin${siteBins.length === 1 ? "" : "s"}` : ""}
            {a.property_id ? ` · ${propName.get(a.property_id) ?? ""}` : ""}
            {a.condition ? ` · ${CONDITION_LABELS[a.condition]}` : ""}
            {!a.is_active ? " · inactive" : ""}
          </span>
          <span className="ml-auto flex items-center gap-3">
            {capacity > 0 ? (
              <span className="text-sm font-medium text-pine-900">
                {formatNumber(capacity)} bu
              </span>
            ) : null}
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
    );
  };

  // A section's rows: sites first with their bins nested; every other
  // asset flat in type order.
  const sectionRows = (types: AssetType[]) => {
    const items: React.ReactElement[] = [];
    for (const t of types) {
      for (const a of filtered.filter((x) => x.asset_type === t)) {
        if (nestedBinIds.has(a.id)) continue;
        items.push(row(a));
        if (a.asset_type === "grain_bin_site") {
          for (const b of binsBySite.get(a.id) ?? []) items.push(row(b, true));
        }
      }
    }
    return items;
  };

  const flatList = typeFilter !== "";

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

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          No assets yet. Add one from the map with the Add button (asset pin, or
          a line for pipe and fences).
        </div>
      ) : flatList ? (
        <ul className="space-y-2">{sectionRows([typeFilter as AssetType])}</ul>
      ) : (
        GROUPS.map((group) => {
          const inGroup = filtered.filter((a) => group.types.includes(a.asset_type));
          if (inGroup.length === 0) return null;
          const groupValue = inGroup.reduce((s, a) => s + (a.estimated_value ?? 0), 0);
          const groupCapacity = inGroup.reduce(
            (s, a) => s + (a.asset_type === "grain_bin" ? capacityOf(a) : 0),
            0
          );
          return (
            <section key={group.title} className="space-y-2">
              <h2 className="text-base font-semibold text-gray-900">
                {group.title}{" "}
                <span className="text-sm font-normal text-gray-500">
                  {formatNumber(inGroup.length)}
                  {groupCapacity > 0 ? ` · ${formatNumber(groupCapacity)} bu` : ""}
                  {groupValue > 0 ? ` · ${formatDollars(groupValue)}` : ""}
                </span>
              </h2>
              <ul className="space-y-2">{sectionRows(group.types)}</ul>
            </section>
          );
        })
      )}
    </div>
  );
}
