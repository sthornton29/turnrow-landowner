"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  IDENTIFIER_KINDS,
  IDENTIFIER_KIND_LABELS,
  normalizeIdentifier,
  type IdentifierKind,
} from "@/lib/taxIdentifiers";

export interface ParcelIdentifierRow {
  id: string;
  kind: string;
  label: string | null;
  value: string;
  source: string;
  last_seen_at: string;
}

const SOURCE_LABEL: Record<string, string> = {
  county_import: "county records",
  tax_statement: "tax statement",
  manual: "added by hand",
};

// Every number the county knows this parcel by. The parcel number row
// mirrors the parcel itself and cannot be removed here.
export default function ParcelIdentifiers({
  parcelId,
  orgId,
  initial,
}: {
  parcelId: string;
  orgId: string;
  initial: ParcelIdentifierRow[];
}) {
  const supabase = createClient();
  const [rows, setRows] = useState(initial);
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<IdentifierKind>("ppin");
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Re-fetch this parcel's record from the county's registered service
  // by parcel number and store every mapped identifier (migration 0042).
  async function refreshFromCounty() {
    setRefreshing(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/gis/parcel-attributes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parcel_ids: [parcelId] }),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(String(body.error ?? `Failed (${res.status})`));
      const failures = Array.isArray(body.failures) ? (body.failures as string[]) : [];
      if (failures.length > 0) throw new Error(failures[0]);
      if (!Number(body.updated)) {
        setNotice("No county record found: the county has no registered service, or the parcel number is not in its records.");
      } else {
        const { data } = await supabase
          .from("parcel_identifiers")
          .select("id, kind, label, value, source, last_seen_at")
          .eq("parcel_id", parcelId)
          .order("kind");
        setRows((data ?? []) as ParcelIdentifierRow[]);
        setNotice(`County record refreshed: ${body.identifiers ?? 0} identifiers recorded.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach the county.");
    } finally {
      setRefreshing(false);
    }
  }

  async function add() {
    setError(null);
    const v = value.trim();
    const normalized = normalizeIdentifier(v);
    if (!v || !normalized) {
      setError("Enter the number.");
      return;
    }
    if (kind === "other" && !label.trim()) {
      setError("Give the label as the county prints it.");
      return;
    }
    const { data, error: err } = await supabase
      .from("parcel_identifiers")
      .upsert(
        {
          organization_id: orgId,
          parcel_id: parcelId,
          kind,
          label: kind === "other" ? label.trim() : IDENTIFIER_KIND_LABELS[kind],
          value: v,
          normalized,
          source: "manual",
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "parcel_id,kind,normalized" }
      )
      .select("id, kind, label, value, source, last_seen_at")
      .single();
    if (err || !data) {
      setError(err?.message ?? "Could not save.");
      return;
    }
    setRows((r) => [...r.filter((x) => x.id !== data.id), data as ParcelIdentifierRow]);
    setValue("");
    setLabel("");
    setAdding(false);
  }

  async function remove(id: string) {
    const { error: err } = await supabase.from("parcel_identifiers").delete().eq("id", id);
    if (err) {
      setError(err.message);
      return;
    }
    setRows((r) => r.filter((x) => x.id !== id));
  }

  const input = "rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-kelly-500 focus:outline-none";
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Identifiers</h2>
        <span className="flex items-center gap-3">
          <button onClick={refreshFromCounty} disabled={refreshing} className="text-xs font-medium text-kelly-700 hover:underline disabled:opacity-60">
            {refreshing ? "Refreshing..." : "Refresh from county records"}
          </button>
          <button onClick={() => setAdding((a) => !a)} className="text-xs font-medium text-kelly-700 hover:underline">
            {adding ? "Cancel" : "Add"}
          </button>
        </span>
      </div>
      {notice ? <p className="mb-1 text-xs text-gray-600">{notice}</p> : null}
      {rows.length === 0 ? <p className="text-xs text-gray-500">Only the parcel number so far.</p> : null}
      <ul className="divide-y divide-gray-100 text-sm">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5">
            <span className="text-gray-500">{r.kind === "other" ? r.label || "Other" : IDENTIFIER_KIND_LABELS[r.kind as IdentifierKind] ?? r.kind}</span>
            <span className="font-medium tabular-nums text-gray-900">{r.value}</span>
            <span className="text-xs text-gray-400">
              {SOURCE_LABEL[r.source] ?? r.source}, seen {new Date(r.last_seen_at).toLocaleDateString()}
            </span>
            {r.kind !== "parcel_number" ? (
              <button onClick={() => remove(r.id)} aria-label="Remove" className="ml-auto text-xs text-gray-400 hover:text-red-600">
                x
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {adding ? (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <select value={kind} onChange={(e) => setKind(e.target.value as IdentifierKind)} className={input}>
            {IDENTIFIER_KINDS.filter((k) => k !== "parcel_number").map((k) => (
              <option key={k} value={k}>
                {IDENTIFIER_KIND_LABELS[k]}
              </option>
            ))}
          </select>
          {kind === "other" ? (
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label as printed" className={input} />
          ) : null}
          <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Number as printed" className={input + " min-w-[12rem]"} />
          <button onClick={add} className="rounded-lg bg-kelly-500 px-3 py-1 text-sm font-semibold text-white hover:bg-kelly-600">
            Save
          </button>
        </div>
      ) : null}
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </section>
  );
}
