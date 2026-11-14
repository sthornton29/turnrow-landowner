"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { friendlyDbError } from "@/lib/dbErrors";
import { formatDate } from "@/lib/format";
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
  const [error, setError] = useState<string | null>(null);
  async function save(patch: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from("parcels").update(patch).eq("id", parcelId);
    setBusy(false);
    if (err) {
      // The controls show the saved value again (nothing was changed).
      setError(friendlyDbError(err, "That did not save. Please try again."));
      return;
    }
    router.refresh();
  }
  return (
    <span className="flex flex-wrap items-center gap-2 print:hidden">
      {error ? <span className="basis-full text-xs text-red-600">{error}</span> : null}
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

// VALUATION NOTICE LOG (migration 0050): the date a county's valuation
// notice arrived starts the 30-day Board of Equalization protest clock,
// which the report counts down.
export function NoticeLog({
  orgId,
  counties,
  notices,
}: {
  orgId: string;
  counties: string[];
  notices: Array<{ id: string; county: string; notice_date: string; deadline: string; open: boolean }>;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [county, setCounty] = useState(counties[0] ?? "");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function add() {
    if (!county || !date) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from("tax_valuation_notices").insert({
      organization_id: orgId,
      county,
      tax_year: Number(date.slice(0, 4)),
      notice_date: date,
    });
    setBusy(false);
    if (err) {
      setError(friendlyDbError(err, "Could not save the notice. Please try again."));
      return;
    }
    setDate("");
    router.refresh();
  }
  async function remove(id: string) {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from("tax_valuation_notices").delete().eq("id", id);
    setBusy(false);
    if (err) {
      setError(friendlyDbError(err, "Could not remove the notice. Please try again."));
      return;
    }
    router.refresh();
  }
  const cls = "rounded-lg border border-gray-300 px-2 py-1 text-sm";
  return (
    <div className="space-y-2 text-sm">
      {notices.length > 0 ? (
        <ul className="space-y-1">
          {notices.map((n) => (
            <li key={n.id} className="flex flex-wrap items-center gap-2">
              <span className="text-gray-900">
                {n.county} County notice of {formatDate(n.notice_date)}:{" "}
                {n.open ? (
                  <span className="font-semibold text-red-700">
                    protest by about {formatDate(n.deadline)} (use the deadline printed on the notice)
                  </span>
                ) : (
                  <span className="text-gray-500">window closed {formatDate(n.deadline)}</span>
                )}
              </span>
              <button onClick={() => remove(n.id)} disabled={busy} className="text-xs text-gray-500 hover:underline print:hidden">
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-gray-500">No valuation notices logged.</p>
      )}
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <select value={county} onChange={(e) => setCounty(e.target.value)} className={cls}>
          {counties.map((c) => (
            <option key={c} value={c}>
              {c} County
            </option>
          ))}
        </select>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={cls} aria-label="Date on the notice" />
        <button
          onClick={add}
          disabled={busy || !county || !date}
          className="rounded-lg bg-kelly-500 px-3 py-1 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-50"
        >
          Log notice
        </button>
      </div>
      {error ? <p className="text-red-600">{error}</p> : null}
    </div>
  );
}

// One parcel's protest packet PDF (lib/protestPacket.ts, drawn by
// protestPacketPdf.ts, loaded only when clicked).
export function ProtestPacketButton({ packet }: { packet: import("@/lib/protestPacket").ProtestPacket }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <>
      <button
        onClick={async () => {
          setBusy(true);
          setFailed(false);
          try {
            const { generateProtestPacketPdf } = await import("./protestPacketPdf");
            await generateProtestPacketPdf(packet);
          } catch {
            // Without this the button just stopped spinning and nothing
            // said the PDF was not made.
            setFailed(true);
          } finally {
            setBusy(false);
          }
        }}
        disabled={busy}
        className="block text-xs font-medium text-kelly-700 hover:underline disabled:opacity-50 print:hidden"
        title="A PDF with the county record, bill history, comparables, a checklist, and a draft protest letter"
      >
        {busy ? "Making packet..." : "Protest packet"}
      </button>
      {failed ? <span className="block text-xs text-red-600 print:hidden">Could not make the packet PDF. Please try again.</span> : null}
    </>
  );
}
