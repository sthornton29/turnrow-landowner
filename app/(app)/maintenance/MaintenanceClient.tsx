"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatAcres } from "@/lib/format";
import {
  GEOMETRY_KIND_LABELS,
  SEVERITY_LABELS,
  groupOpenIssues,
  issueGeometryKind,
  issueTitle,
  severityClass,
  toggleStatus,
  type IssueSeverity,
} from "@/lib/maintenance";
import type { MaintenanceIssueGeo } from "@/types/db";

const selectClass = "rounded-lg border border-gray-300 px-2 py-1.5 text-sm";

export default function MaintenanceClient({
  initialIssues,
  properties,
  fields,
}: {
  initialIssues: MaintenanceIssueGeo[];
  properties: Array<{ id: string; name: string }>;
  fields: Array<{ id: string; name: string; property_id: string }>;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [issues, setIssues] = useState(initialIssues);
  const [propertyFilter, setPropertyFilter] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visible = useMemo(
    () => (propertyFilter ? issues.filter((i) => (i.property_id ?? "") === propertyFilter) : issues),
    [issues, propertyFilter]
  );
  const groups = useMemo(() => groupOpenIssues(visible, properties, fields), [visible, properties, fields]);
  const resolved = visible
    .filter((i) => i.status === "resolved")
    .sort((a, b) => (b.resolved_at ?? "").localeCompare(a.resolved_at ?? ""));
  const openCount = visible.filter((i) => i.status === "open").length;
  const propName = new Map(properties.map((p) => [p.id, p.name]));

  async function flip(issue: MaintenanceIssueGeo) {
    setBusy(issue.id);
    setError(null);
    const patch = toggleStatus(issue);
    const { error: err } = await supabase.from("maintenance_issues").update(patch).eq("id", issue.id);
    setBusy(null);
    if (err) {
      setError("Could not update the issue. " + err.message);
      return;
    }
    setIssues((list) => list.map((i) => (i.id === issue.id ? { ...i, ...patch } : i)));
  }

  function row(issue: MaintenanceIssueGeo, resolvedRow = false) {
    const kind = issueGeometryKind(issue.geom_geojson);
    return (
      <li key={issue.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white " +
                (resolvedRow ? "bg-gray-400" : issue.severity === "high" ? "bg-red-600" : "bg-amber-500")
              }
            >
              !
            </span>
            <span className={"text-sm font-medium " + (resolvedRow ? "text-gray-500 line-through" : "text-gray-900")}>
              {issueTitle(issue)}
            </span>
            {issue.severity ? (
              <span className={"rounded-full px-2 py-0.5 text-[11px] font-medium " + severityClass(issue.severity as IssueSeverity)}>
                {SEVERITY_LABELS[issue.severity as IssueSeverity]}
              </span>
            ) : null}
            {kind ? <span className="text-xs text-gray-500">{GEOMETRY_KIND_LABELS[kind]}</span> : null}
            {issue.acres !== null && issue.acres !== undefined ? (
              <span className="text-xs text-gray-500">{formatAcres(issue.acres)} ac</span>
            ) : null}
          </div>
          <p className="text-xs text-gray-500">
            {resolvedRow && issue.resolved_at
              ? `Resolved ${new Date(issue.resolved_at).toLocaleDateString()}`
              : `Noted ${new Date(issue.created_at).toLocaleDateString()}`}
            {propertyFilter === "" && issue.property_id ? ` · ${propName.get(issue.property_id) ?? ""}` : ""}
            {issue.notes ? ` · ${issue.notes}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Link href={`/map?focus=maintenance_issue:${issue.id}`} className="font-medium text-kelly-700 hover:underline">
            Map
          </Link>
          <button
            onClick={() => flip(issue)}
            disabled={busy === issue.id}
            className={
              "rounded-lg px-2.5 py-1 font-medium disabled:opacity-60 " +
              (resolvedRow
                ? "border border-gray-300 text-gray-700 hover:bg-gray-50"
                : "bg-amber-600 text-white hover:bg-amber-700")
            }
          >
            {busy === issue.id ? "Saving..." : resolvedRow ? "Reopen" : "Mark resolved"}
          </button>
        </div>
      </li>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Maintenance</h1>
          <p className="text-sm text-gray-500">
            Problems that need attention on the land: washes, sinkholes, broken terraces, road washouts.
            Add them from the map with + Add, then Maintenance issue.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={propertyFilter} onChange={(e) => setPropertyFilter(e.target.value)} className={selectClass}>
            <option value="">All properties</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <Link href="/map" className="rounded-lg bg-kelly-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-kelly-600">
            Open the map
          </Link>
        </div>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {openCount === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center">
          <p className="text-sm font-medium text-gray-800">Nothing open</p>
          <p className="mt-1 text-xs text-gray-500">
            When you spot a wash or a sinkhole, drop it on the map and it shows up here until you mark it resolved.
          </p>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.propertyId ?? "none"} className="rounded-xl border border-amber-200 bg-white">
            <div className="flex items-center justify-between border-b border-amber-100 bg-amber-50 px-3 py-2">
              <span className="text-sm font-semibold text-amber-900">
                {g.propertyId ? (
                  <Link href={`/properties/${g.propertyId}`} className="hover:underline">
                    {g.propertyName}
                  </Link>
                ) : (
                  g.propertyName
                )}
              </span>
              <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-amber-900">
                {g.count} open
              </span>
            </div>
            {g.fields.map((f) => (
              <div key={f.fieldId ?? "none"}>
                {f.fieldName ? (
                  <p className="px-3 pt-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {f.fieldId ? (
                      <Link href={`/fields/${f.fieldId}`} className="hover:underline">
                        {f.fieldName}
                      </Link>
                    ) : (
                      f.fieldName
                    )}
                  </p>
                ) : null}
                <ul className="divide-y divide-gray-100">{f.issues.map((i) => row(i))}</ul>
              </div>
            ))}
          </section>
        ))
      )}

      {resolved.length > 0 ? (
        <section className="rounded-xl border border-gray-200 bg-white">
          <button
            onClick={() => setShowResolved((v) => !v)}
            className="flex w-full items-center justify-between px-3 py-2 text-left"
          >
            <span className="text-sm font-semibold text-gray-700">Resolved ({resolved.length})</span>
            <span className="text-xs text-gray-400">{showResolved ? "Hide" : "Show"}</span>
          </button>
          {showResolved ? (
            <ul className="divide-y divide-gray-100 border-t border-gray-100">{resolved.map((i) => row(i, true))}</ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
