"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyDbError } from "@/lib/dbErrors";
import { COST_SHARE_STATUS_LABELS as STATUS_LABELS, PROGRAM_LABELS } from "@/lib/reforestation";
import type { CostShareAwardRow } from "@/types/db";

// Add or edit a cost-share contract (migration 0047).

const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm";
const labelCls = "mb-0.5 block text-xs font-medium text-gray-600";

export default function CostShareForm({
  orgId,
  properties,
  entities,
  award,
  onClose,
}: {
  orgId: string;
  properties: Array<{ id: string; name: string; entity_id: string | null }>;
  entities: Array<{ id: string; name: string }>;
  award: CostShareAwardRow | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [f, setF] = useState({
    property_id: award?.property_id ?? properties[0]?.id ?? "",
    entity_id: award?.entity_id ?? properties[0]?.entity_id ?? "",
    program: award?.program ?? "eqip",
    title: award?.title ?? "",
    agency: award?.agency ?? "",
    contract_number: award?.contract_number ?? "",
    status: award?.status ?? "active",
    signed_date: award?.signed_date ?? "",
    end_date: award?.end_date ?? "",
    approved_amount: award?.approved_amount != null ? String(award.approved_amount) : "",
    acres: award?.acres != null ? String(award.acres) : "",
    practices: award?.practices ?? "",
    obligations_until: award?.obligations_until ?? "",
    notes: award?.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  async function save() {
    setError(null);
    if (!f.property_id) return setError("Pick a property.");
    const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(/[$,]/g, "")));
    const record = {
      organization_id: orgId,
      property_id: f.property_id,
      entity_id: f.entity_id || null,
      program: f.program,
      title: f.title.trim() || `${PROGRAM_LABELS[f.program] ?? "Cost-share"}${f.contract_number ? ` ${f.contract_number}` : ""}`,
      agency: f.agency.trim() || null,
      contract_number: f.contract_number.trim() || null,
      status: f.status,
      signed_date: f.signed_date || null,
      end_date: f.end_date || null,
      approved_amount: num(f.approved_amount),
      acres: num(f.acres),
      practices: f.practices.trim() || null,
      obligations_until: f.obligations_until || null,
      notes: f.notes.trim() || null,
    };
    setBusy(true);
    const res = award
      ? await supabase.from("cost_share_awards").update(record).eq("id", award.id).select("id").single()
      : await supabase.from("cost_share_awards").insert(record).select("id").single();
    setBusy(false);
    if (res.error || !res.data) {
      return setError(friendlyDbError(res.error, "Could not save the cost-share contract. Please try again."));
    }
    onClose();
    router.push(`/timber/cost-share/${res.data.id}`);
    router.refresh();
  }

  return (
    <div className="space-y-3 rounded-xl border border-kelly-200 bg-kelly-50/40 p-4 text-sm">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Property</label>
          <select
            value={f.property_id}
            onChange={(e) => {
              const p = properties.find((x) => x.id === e.target.value);
              setF((x) => ({ ...x, property_id: e.target.value, entity_id: p?.entity_id ?? x.entity_id }));
            }}
            className={inputCls}
          >
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Contract holder (taxpayer)</label>
          <select value={f.entity_id} onChange={(e) => set("entity_id", e.target.value)} className={inputCls}>
            <option value="">No entity</option>
            {entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Program</label>
          <select value={f.program} onChange={(e) => set("program", e.target.value)} className={inputCls}>
            {Object.entries(PROGRAM_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Name</label>
          <input value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="Dupes white oak planting" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Agency or office</label>
          <input value={f.agency} onChange={(e) => set("agency", e.target.value)} placeholder="NRCS Moulton field office" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Contract number</label>
          <input value={f.contract_number} onChange={(e) => set("contract_number", e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Status</label>
          <select value={f.status} onChange={(e) => set("status", e.target.value)} className={inputCls}>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelCls}>Approved $</label>
            <input value={f.approved_amount} onChange={(e) => set("approved_amount", e.target.value)} inputMode="decimal" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Acres</label>
            <input value={f.acres} onChange={(e) => set("acres", e.target.value)} inputMode="decimal" className={inputCls} />
          </div>
        </div>
        <div>
          <label className={labelCls}>Signed</label>
          <input type="date" value={f.signed_date} onChange={(e) => set("signed_date", e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Contract ends</label>
          <input type="date" value={f.end_date} onChange={(e) => set("end_date", e.target.value)} className={inputCls} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>Practices (what the program pays for)</label>
          <input
            value={f.practices}
            onChange={(e) => set("practices", e.target.value)}
            placeholder="612 tree planting, 490 site prep, 666 forest stand improvement"
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Practices must be kept up until</label>
          <input type="date" value={f.obligations_until} onChange={(e) => set("obligations_until", e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Notes</label>
          <input value={f.notes} onChange={(e) => set("notes", e.target.value)} className={inputCls} />
        </div>
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 font-semibold text-gray-700 hover:bg-gray-50">
          Cancel
        </button>
        <button
          onClick={save}
          disabled={busy}
          className="rounded-lg bg-kelly-500 px-4 py-2 font-semibold text-white hover:bg-kelly-600 disabled:opacity-50"
        >
          {busy ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}
