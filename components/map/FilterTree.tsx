"use client";

import type { EntityType } from "@/types/db";
import { LAND_TYPE_LABELS } from "@/lib/landLabels";

// The item-selection machinery shared by the PRINT setup and the live
// map FILTER: one flat exclusion Set of "entityType:id" keys, property
// chips that exclude a boundary plus everything on it, and a searchable
// Property > type > item tree with tri-state checkboxes.

export interface SelectableItem {
  key: string; // "entityType:id"
  entityType: EntityType;
  id: string;
  name: string;
  propertyId: string | null;
}

export const ITEM_TYPE_LABELS: Record<EntityType, string> = {
  property: "Property boundary",
  parcel: LAND_TYPE_LABELS.parcel.plural,
  field: LAND_TYPE_LABELS.field.plural,
  pasture: LAND_TYPE_LABELS.pasture.plural,
  wetland: LAND_TYPE_LABELS.wetland.plural,
  timber_stand: LAND_TYPE_LABELS.timber_stand.plural,
  road: LAND_TYPE_LABELS.road.plural,
  easement: LAND_TYPE_LABELS.easement.plural,
  asset: LAND_TYPE_LABELS.asset.plural,
  cemetery: LAND_TYPE_LABELS.cemetery.plural,
  maintenance_issue: LAND_TYPE_LABELS.maintenance_issue.plural,
};

// Tri-state checkbox: checked = fully included, indeterminate = partly
// excluded.
export function TriCheckbox({
  state,
  onToggle,
}: {
  state: "all" | "some" | "none";
  onToggle: () => void;
}) {
  return (
    <input
      type="checkbox"
      checked={state === "all"}
      ref={(el) => {
        if (el) el.indeterminate = state === "some";
      }}
      onChange={onToggle}
      className="h-3.5 w-3.5 shrink-0 accent-kelly-500"
    />
  );
}

export function triStateOf(keys: string[], excluded: Set<string>): "all" | "some" | "none" {
  const excludedCount = keys.filter((k) => excluded.has(k)).length;
  if (excludedCount === 0) return "all";
  return excludedCount === keys.length ? "none" : "some";
}

// Property chips: tap to exclude/restore a boundary plus everything on
// it (the caller's onToggleProperty does the expansion sweep).
export function PropertyChips({
  propertyIds,
  properties,
  excluded,
  onToggleProperty,
  what,
}: {
  propertyIds: string[];
  properties: Array<{ id: string; name: string }>;
  excluded: Set<string>;
  onToggleProperty: (pid: string) => void;
  what: string; // "the print" | "the map"
}) {
  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      {propertyIds.map((pid) => {
        const property = properties.find((p) => p.id === pid);
        const off = excluded.has(`property:${pid}`);
        return (
          <button
            key={pid}
            onClick={() => onToggleProperty(pid)}
            className={
              "rounded-full border px-2.5 py-1 text-xs font-medium " +
              (off
                ? "border-gray-300 bg-gray-100 text-gray-400 line-through"
                : "border-kelly-500 bg-kelly-50 text-pine-900")
            }
            title={
              off
                ? `Excluded from ${what} with everything on it; tap to restore`
                : `Tap to exclude this whole property from ${what}`
            }
          >
            {property?.name ?? "Property"}
          </button>
        );
      })}
    </div>
  );
}

// The searchable Property > type > item tree. Items arrive pre-scoped
// (the print passes in-frame items, the filter passes everything);
// `filter` narrows by name.
export function ItemTree({
  items,
  properties,
  excluded,
  filter,
  emptyText,
  onToggleKeys,
}: {
  items: SelectableItem[];
  properties: Array<{ id: string; name: string }>;
  excluded: Set<string>;
  filter: string;
  emptyText: string;
  onToggleKeys: (keys: string[]) => void;
}) {
  const needle = filter.trim().toLowerCase();
  const visibleItems = items.filter(
    (i) => !needle || i.name.toLowerCase().includes(needle)
  );
  if (visibleItems.length === 0) {
    return <p className="text-xs text-gray-500">{emptyText}</p>;
  }
  const propertyOrder: Array<string | null> = [];
  const byProperty = new Map<string | null, SelectableItem[]>();
  for (const item of visibleItems) {
    const pid = item.propertyId;
    if (!byProperty.has(pid)) {
      byProperty.set(pid, []);
      propertyOrder.push(pid);
    }
    byProperty.get(pid)!.push(item);
  }
  return (
    <>
      {propertyOrder.map((pid) => {
        const groupItems = byProperty.get(pid)!;
        const groupKeys = groupItems.map((i) => i.key);
        const propertyName = pid
          ? (properties.find((p) => p.id === pid)?.name ?? "Property")
          : "No property";
        const typeOrder: EntityType[] = [];
        const byType = new Map<EntityType, SelectableItem[]>();
        for (const item of groupItems) {
          if (item.entityType === "property") continue;
          if (!byType.has(item.entityType)) {
            byType.set(item.entityType, []);
            typeOrder.push(item.entityType);
          }
          byType.get(item.entityType)!.push(item);
        }
        const boundaryItem = groupItems.find((i) => i.entityType === "property");
        return (
          <div key={pid ?? "none"} className="space-y-1">
            <label className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-gray-800">
              <TriCheckbox
                state={triStateOf(groupKeys, excluded)}
                onToggle={() => onToggleKeys(groupKeys)}
              />
              {propertyName}
            </label>
            {boundaryItem ? (
              <label className="ml-4 flex cursor-pointer items-center gap-1.5 text-xs text-gray-700">
                <TriCheckbox
                  state={triStateOf([boundaryItem.key], excluded)}
                  onToggle={() => onToggleKeys([boundaryItem.key])}
                />
                Boundary outline
              </label>
            ) : null}
            {typeOrder.map((type) => {
              const typeItems = byType.get(type)!;
              const typeKeys = typeItems.map((i) => i.key);
              return (
                <div key={type} className="ml-4 space-y-0.5">
                  <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-gray-700">
                    <TriCheckbox
                      state={triStateOf(typeKeys, excluded)}
                      onToggle={() => onToggleKeys(typeKeys)}
                    />
                    {ITEM_TYPE_LABELS[type]}
                  </label>
                  {typeItems.map((item) => (
                    <label
                      key={item.key}
                      className="ml-4 flex cursor-pointer items-center gap-1.5 text-xs text-gray-600"
                    >
                      <TriCheckbox
                        state={triStateOf([item.key], excluded)}
                        onToggle={() => onToggleKeys([item.key])}
                      />
                      <span className="truncate">{item.name}</span>
                    </label>
                  ))}
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}
