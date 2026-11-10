"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Scope bar for the property tax report (year, entity, property, county;
// all in the URL so the page is shareable and printable), plus the small
// per-parcel editor for the owner-confirmed facts (migration 0049).

export function TaxReportControls({
  year,
  years,
  entity,
  entities,
  property,
  properties,
  county,
  counties,
}: {
  year: number;
  years: number[];
  entity: string;
  entities: Array<{ id: string; name: string }>;
  property: string;
  properties: Array<{ id: string; name: string; entity_id: string | null }>;
  county: string;
  counties: string[];
}) {
  const router = useRouter();
  const go = (p: { year?: number; entity?: string; property?: string; county?: string }) => {
    const q = new URLSearchParams();
    q.set("year", String(p.year ?? year));
    const e = p.entity ?? entity;
    const pr = p.property ?? property;
    const c = p.county ?? county;
    if (e) q.set("entity", e);
    if (pr) q.set("property", pr);
    if (c) q.set("county", c);
    router.push(`/taxes/report?${q.toString()}`);
  };
  const cls = "rounded-lg border border-gray-300 px-3 py-1.5 text-sm";
  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <select value={year} onChange={(e) => go({ year: Number(e.target.value) })} className={cls}>
        {years.map((y) => (
          <option key={y} value={y}>
            {y} taxes
          </option>
        ))}
      </select>
      <select value={entity} onChange={(e) => go({ entity: e.target.value, property: "" })} className={cls}>
        <option value="">All entities</option>
        {entities.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </select>
      <select value={property} onChange={(e) => go({ property: e.target.value })} className={cls}>
        <option value="">All properties</option>
        {properties
          .filter((p) => !entity || p.entity_id === entity)
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
      </select>
      <select value={county} onChange={(e) => go({ county: e.target.value })} className={cls}>
        <option value="">All counties</option>
        {counties.map((c) => (
          <option key={c} value={c}>
            {c} County
          </option>
        ))}
      </select>
      <button
        onClick={() => window.print()}
        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
      >
        Print or save PDF
      </button>
    </div>
  );
}

export function ParcelFlags({
  parcelId,
  status,
  homestead,
}: {
  parcelId: string;
  status: string;
  homestead: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  async function save(patch: Record<string, unknown>) {
    setBusy(true);
    await supabase.from("parcels").update(patch).eq("id", parcelId);
    setBusy(false);
    router.refresh();
  }
  return (
    <span className="flex flex-wrap items-center gap-2 print:hidden">
      <select
        value={status}
        disabled={busy}
        onChange={(e) => save({ current_use_status: e.target.value })}
        className="rounded border border-gray-300 px-1.5 py-0.5 text-xs"
        title="Is this parcel enrolled in current use? Your answer overrides the estimate."
      >
        <option value="unknown">Enrolled? Not sure</option>
        <option value="enrolled">Enrolled in current use</option>
        <option value="not_enrolled">Not enrolled</option>
      </select>
      <label className="flex items-center gap-1 text-xs text-gray-600">
        <input
          type="checkbox"
          checked={homestead}
          disabled={busy}
          onChange={(e) => save({ is_homestead: e.target.checked })}
          className="h-3.5 w-3.5 accent-kelly-500"
        />
        Homestead
      </label>
    </span>
  );
}
