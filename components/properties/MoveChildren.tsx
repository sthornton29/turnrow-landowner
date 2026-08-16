"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatNumber } from "@/lib/format";

// Bulk-move a property's children (parcels, fields, timber stands,
// roads, assets) to another property in the same organization. Just a
// property_id update: composite FKs make cross-tenant moves impossible,
// boundaries stay exactly where they are, and generated acres never
// change. Built for restructuring: turning entity-shaped properties
// into real entities plus real properties.
export default function MoveChildren({
  table,
  itemLabel,
  items,
  properties,
  currentPropertyId,
}: {
  table: string;
  itemLabel: string; // e.g. "parcel"
  items: Array<{ id: string; label: string }>;
  properties: Array<{ id: string; name: string }>;
  currentPropertyId: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targetId, setTargetId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targets = properties.filter((p) => p.id !== currentPropertyId);
  if (items.length === 0 || targets.length === 0) return null;

  function toggle(id: string) {
    setSelected((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function move() {
    if (!targetId || selected.size === 0) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase
      .from(table)
      .update({ property_id: targetId })
      .in("id", Array.from(selected));
    setBusy(false);
    if (err) {
      setError("Could not move: " + err.message);
      return;
    }
    setSelected(new Set());
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-sm font-medium text-kelly-700 hover:underline"
      >
        Move {itemLabel}s to another property
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-kelly-100 bg-kelly-50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-pine-900">
          Move {formatNumber(selected.size)} {itemLabel}
          {selected.size === 1 ? "" : "s"} to
        </span>
        <select
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm"
        >
          <option value="">Pick a property...</option>
          {targets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          onClick={move}
          disabled={busy || !targetId || selected.size === 0}
          className="rounded-lg bg-kelly-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-60"
        >
          {busy ? "Moving..." : "Move"}
        </button>
        <button
          onClick={() => {
            setOpen(false);
            setSelected(new Set());
          }}
          className="text-sm text-gray-600 hover:underline"
        >
          Cancel
        </button>
        <button
          onClick={() =>
            setSelected((set) =>
              set.size === items.length
                ? new Set()
                : new Set(items.map((i) => i.id))
            )
          }
          className="ml-auto text-sm font-medium text-kelly-700 hover:underline"
        >
          {selected.size === items.length ? "None" : "Select all"}
        </button>
      </div>
      <ul className="max-h-48 space-y-1 overflow-y-auto">
        {items.map((item) => (
          <li key={item.id}>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-white px-2.5 py-1.5 text-sm">
              <input
                type="checkbox"
                checked={selected.has(item.id)}
                onChange={() => toggle(item.id)}
                className="h-4 w-4 accent-kelly-500"
              />
              <span className="text-gray-900">{item.label}</span>
            </label>
          </li>
        ))}
      </ul>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <p className="text-xs text-gray-600">
        Boundaries and acres stay as they are; only which property these
        belong to changes. Property outlines are not redrawn.
      </p>
    </div>
  );
}
