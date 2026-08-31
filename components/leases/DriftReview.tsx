"use client";

// The org-level tenant-data updates list: one card per lease, one line
// per drifted value, Accept per value / per lease / all. Every accept is
// an explicit press and saves immediately through the same primitive the
// lease page uses (lib/acceptDrift.ts).

import { useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { formatDollars, formatNumber } from "@/lib/format";
import { DRIFT_FIELD_LABELS } from "@/lib/assumptionDrift";
import { acceptDriftRow, acceptDriftRows, type DriftRow } from "@/lib/acceptDrift";
import { CROP_PRACTICE_LABELS, VALUE_SOURCE_LABELS } from "@/lib/leaseLogic";

function valueText(field: DriftRow["field"], v: number): string {
  return field === "expected_price" ? formatDollars(v) : formatNumber(v);
}

export default function DriftReview({
  initialRows,
  leaseInfo,
}: {
  initialRows: DriftRow[];
  leaseInfo: Record<string, { name: string; tenant: string | null }>;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState(initialRows);
  const [busy, setBusy] = useState<string | null>(null); // drift id, lease id, or "all"
  const [error, setError] = useState<string | null>(null);

  const byLease = useMemo(() => {
    const map = new Map<string, DriftRow[]>();
    for (const r of rows) {
      const list = map.get(r.lease_id) ?? [];
      list.push(r);
      map.set(r.lease_id, list);
    }
    return map;
  }, [rows]);

  async function acceptOne(drift: DriftRow) {
    setBusy(drift.id);
    setError(null);
    const { accepted, error: err } = await acceptDriftRow(supabase, drift);
    if (err) setError("Could not accept: " + err);
    // A stale flag is removed server-side either way; drop it here too.
    if (accepted || !err) setRows((rs) => rs.filter((r) => r.id !== drift.id));
    setBusy(null);
  }

  async function acceptMany(drifts: DriftRow[], busyKey: string) {
    setBusy(busyKey);
    setError(null);
    const { error: err } = await acceptDriftRows(supabase, drifts);
    if (err) setError("Could not accept: " + err);
    else setRows((rs) => rs.filter((r) => !drifts.some((d) => d.id === r.id)));
    setBusy(null);
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
        You{"'"}re caught up. When a sync brings tenant numbers that differ
        from an assumption you saved, they appear here for one-tap
        acceptance.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {rows.length > 1 ? (
        <div className="flex justify-end">
          <button
            onClick={() => acceptMany(rows, "all")}
            disabled={busy !== null}
            className="rounded-lg bg-kelly-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-60"
          >
            {busy === "all" ? "Accepting..." : `Accept all (${rows.length})`}
          </button>
        </div>
      ) : null}
      {Array.from(byLease.entries()).map(([leaseId, leaseRows]) => {
        const info = leaseInfo[leaseId] ?? { name: "Lease", tenant: null };
        return (
          <div key={leaseId} className="rounded-xl border border-gray-200 bg-white p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/leases/${leaseId}#assumptions`}
                className="font-medium text-gray-900 hover:underline"
              >
                {info.name}
              </Link>
              {info.tenant ? (
                <span className="text-xs text-gray-500">{info.tenant}</span>
              ) : null}
              {leaseRows.length > 1 ? (
                <button
                  onClick={() => acceptMany(leaseRows, leaseId)}
                  disabled={busy !== null}
                  className="ml-auto rounded-lg border border-kelly-500 px-2.5 py-1 text-xs font-semibold text-kelly-700 hover:bg-kelly-100 disabled:opacity-60"
                >
                  {busy === leaseId ? "Accepting..." : "Accept all for this lease"}
                </button>
              ) : null}
            </div>
            <ul className="mt-2 space-y-1.5">
              {leaseRows.map((d) => (
                <li
                  key={d.id}
                  className="flex flex-wrap items-center gap-1.5 border-t border-gray-100 pt-1.5 text-sm"
                >
                  <span className="font-medium text-gray-900">
                    {d.crop}
                    {d.practice !== "blended"
                      ? ` (${CROP_PRACTICE_LABELS[d.practice].toLowerCase()})`
                      : ""}
                    , {d.year}
                  </span>
                  <span className="text-gray-600">
                    {DRIFT_FIELD_LABELS[d.field]}: saved{" "}
                    {valueText(d.field, d.committed_value)} {"->"} tenant{" "}
                    {valueText(d.field, d.tenant_value)}
                  </span>
                  <span
                    className={
                      "rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase " +
                      (d.is_final_price
                        ? "bg-pine-800 text-white"
                        : "bg-amber-100 text-amber-800")
                    }
                  >
                    {d.is_final_price ? "final" : VALUE_SOURCE_LABELS[d.tenant_kind]}
                  </span>
                  {d.tenant_as_of ? (
                    <span className="text-[10px] text-gray-500">
                      as of {new Date(d.tenant_as_of).toLocaleDateString()}
                    </span>
                  ) : null}
                  <button
                    onClick={() => acceptOne(d)}
                    disabled={busy !== null}
                    className="ml-auto rounded border border-kelly-500 px-1.5 py-0.5 text-[11px] font-medium text-kelly-700 hover:bg-kelly-100 disabled:opacity-60"
                  >
                    {busy === d.id ? "..." : "Accept"}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      <p className="text-[11px] text-gray-500">
        Accepting updates the saved assumption and its source tag immediately.
        A value you hand-edited never appears here; hand edits always win.
      </p>
    </div>
  );
}
