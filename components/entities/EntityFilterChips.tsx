"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { NO_ENTITY } from "@/lib/entities";
// (parseEntityParam lives in lib/entities.ts so server pages can parse
// the same URL format this component writes.)

// The ONE entity filter, shared by income, gov payments, the dashboard,
// and the tax report: MULTI-SELECT chips (tap entities in and out;
// empty selection = all). The selection rides the URL as a comma list
// (?entity=id1,id2) so server components scope their numbers, and
// persists per user in localStorage under one shared key so the
// "entity view" follows the user across pages and reloads. A restricted
// user's chips are only their granted entities because the entities
// query is RLS-scoped before it reaches this component.

const STORAGE_KEY = "turnrow.entityFilter.v1";

function loadStored(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as string[]).filter(Boolean);
  } catch {
    return [];
  }
}

export default function EntityFilterChips({
  entities,
  selected,
  basePath,
  extraParams = {},
}: {
  entities: Array<{ id: string; name: string }>;
  selected: string[]; // entity ids and/or NO_ENTITY; empty = all
  basePath: string; // e.g. "/income"
  // Params to preserve on navigation (year, framing...).
  extraParams?: Record<string, string>;
}) {
  const router = useRouter();
  const selectedSet = new Set(selected);
  const restoredRef = useRef(false);

  const hrefFor = (keys: string[]) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(extraParams)) if (v) p.set(k, v);
    if (keys.length > 0) p.set("entity", keys.join(","));
    const qs = p.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  const persist = (keys: string[]) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
    } catch {
      // Private browsing without storage: the filter just does not persist.
    }
  };

  // Once per mount: a URL that carries ?entity= is the source of truth
  // and refreshes storage; a plain visit restores the stored selection.
  // (Persisting is otherwise tied to EXPLICIT taps only, so a bare
  // mount never wipes a saved selection before the restore runs.)
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    if (new URLSearchParams(window.location.search).has("entity")) {
      persist(selected);
      return;
    }
    const stored = loadStored().filter(
      (k) => k === NO_ENTITY || entities.some((e) => e.id === k)
    );
    if (stored.length > 0) router.replace(hrefFor(stored));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (key: string) => {
    const next = new Set(selectedSet);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    persist([...next]);
    router.push(hrefFor([...next]));
  };

  const chip = (key: string, label: string, active: boolean, onClick: () => void) => (
    <button
      key={key || "all"}
      onClick={onClick}
      className={
        "rounded-full border px-3 py-1 text-sm font-medium " +
        (active
          ? "border-kelly-500 bg-kelly-50 text-pine-900"
          : "border-gray-200 bg-white text-gray-600 hover:border-gray-300")
      }
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-wrap gap-1.5">
      {chip("", "All entities", selectedSet.size === 0, () => {
        persist([]);
        router.push(hrefFor([]));
      })}
      {entities.map((e) =>
        chip(e.id, e.name, selectedSet.has(e.id), () => toggle(e.id))
      )}
      {chip(NO_ENTITY, "No entity", selectedSet.has(NO_ENTITY), () => toggle(NO_ENTITY))}
    </div>
  );
}
