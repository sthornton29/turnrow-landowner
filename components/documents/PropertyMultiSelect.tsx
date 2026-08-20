"use client";

import { useMemo, useState } from "react";
import type { PropertySuggestion } from "@/lib/documentMatch";
import { isConfident } from "@/lib/documentMatch";

export interface SelectableProperty {
  id: string;
  name: string;
  county?: string | null;
  state?: string | null;
}

// Checkbox list of the organization's properties (search box past eight)
// with optional AI suggestions: suggested rows carry an amber "Suggested
// from document" tag and the plain-language reasons. Nothing here writes
// anything; the caller owns the selection.
export default function PropertyMultiSelect({
  properties,
  selected,
  onChange,
  suggestions = [],
  disabledIds = [],
  compact = false,
}: {
  properties: SelectableProperty[];
  selected: string[];
  onChange: (ids: string[]) => void;
  suggestions?: PropertySuggestion[];
  disabledIds?: string[]; // always-on rows (the page's own property)
  compact?: boolean;
}) {
  const [q, setQ] = useState("");
  const byId = useMemo(() => new Map(suggestions.map((s) => [s.propertyId, s])), [suggestions]);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = needle
      ? properties.filter(
          (p) =>
            p.name.toLowerCase().includes(needle) ||
            (p.county ?? "").toLowerCase().includes(needle)
        )
      : properties;
    // Suggested first (strongest on top), then the rest alphabetically.
    return [...rows].sort((a, b) => {
      const sa = byId.get(a.id)?.score ?? -1;
      const sb = byId.get(b.id)?.score ?? -1;
      if (sa !== sb) return sb - sa;
      return a.name.localeCompare(b.name);
    });
  }, [properties, q, byId]);

  function toggle(id: string) {
    if (disabledIds.includes(id)) return;
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  if (properties.length === 0) {
    return <p className="text-xs text-gray-500">No properties yet.</p>;
  }

  return (
    <div className="space-y-1.5">
      {properties.length > 8 ? (
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search properties"
          className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-kelly-500 focus:outline-none"
        />
      ) : null}
      <ul
        className={
          "divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200 " +
          (compact ? "max-h-40" : "max-h-56")
        }
      >
        {list.map((p) => {
          const s = byId.get(p.id);
          const checked = selected.includes(p.id) || disabledIds.includes(p.id);
          return (
            <li key={p.id}>
              <label
                className={
                  "flex cursor-pointer items-start gap-2 px-2.5 py-1.5 text-sm hover:bg-gray-50 " +
                  (s ? "bg-amber-50/60" : "")
                }
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabledIds.includes(p.id)}
                  onChange={() => toggle(p.id)}
                  className="mt-0.5 h-4 w-4 accent-kelly-500"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium text-gray-900">{p.name}</span>
                    {s ? (
                      <span
                        className={
                          "rounded-full px-1.5 py-0.5 text-[10px] font-medium " +
                          (isConfident(s)
                            ? "bg-amber-200 text-amber-900"
                            : "bg-amber-100 text-amber-800")
                        }
                      >
                        {isConfident(s) ? "Suggested from document" : "Possible match"}
                      </span>
                    ) : null}
                  </span>
                  {p.county ? (
                    <span className="block text-xs text-gray-500">
                      {p.county}
                      {p.state ? `, ${p.state}` : ""}
                    </span>
                  ) : null}
                  {s ? (
                    <span className="block text-[11px] leading-snug text-amber-900">
                      {s.reasons.join("; ")}
                    </span>
                  ) : null}
                </span>
              </label>
            </li>
          );
        })}
        {list.length === 0 ? (
          <li className="px-2.5 py-2 text-xs text-gray-500">No properties match.</li>
        ) : null}
      </ul>
    </div>
  );
}
