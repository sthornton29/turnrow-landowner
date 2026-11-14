"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyDbError } from "@/lib/dbErrors";
import { formatDate, formatDollars } from "@/lib/format";
import {
  BASIS_LABELS,
  INCOME_RECORD_TYPES,
  INCOME_RECORD_TYPE_LABELS,
  type IncomeRecordRow,
} from "@/lib/incomeRecords";

// The income records list: inline fixes (entity, property, type, the
// Check mark, and whether an owed or calculated record has since been
// received), delete, and a form to add a record by hand.

export default function IncomeRecordsClient({
  orgId,
  rows,
  entities,
  properties,
  defaultYear,
}: {
  orgId: string;
  rows: IncomeRecordRow[];
  entities: Array<{ id: string; name: string }>;
  properties: Array<{ id: string; name: string; entity_id: string | null }>;
  defaultYear: number;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({
    received_date: "",
    payer: "",
    entity_id: "",
    property_id: "",
    income_type: "solar",
    amount: "",
    notes: "",
  });
  const propertyById = new Map(properties.map((p) => [p.id, p]));

  async function update(id: string, patch: Record<string, unknown>) {
    setBusy(id);
    setError(null);
    const { error: err } = await supabase.from("income_records").update(patch).eq("id", id);
    setBusy(null);
    if (err) setError(friendlyDbError(err, "Could not save that change. The record was left as it was."));
    else router.refresh();
  }
  // Deleting removes a line of income history for good, so it asks first.
  async function remove(r: IncomeRecordRow) {
    if (busy) return;
    const what = [
      formatDollars(r.amount),
      r.payer ? `from ${r.payer}` : null,
      r.received_date ? `on ${formatDate(r.received_date)}` : `in ${r.year}`,
    ]
      .filter(Boolean)
      .join(" ");
    if (
      !window.confirm(
        `Delete this income record (${what})? It will no longer count in ${r.year} income. This cannot be undone.`
      )
    ) {
      return;
    }
    setBusy(r.id);
    setError(null);
    const { error: err } = await supabase.from("income_records").delete().eq("id", r.id);
    setBusy(null);
    if (err) setError(friendlyDbError(err, "Could not delete the record. It is still here."));
    else router.refresh();
  }
  async function add() {
    const amount = Number(draft.amount.replace(/[$,\s]/g, ""));
    if (!draft.received_date || !Number.isFinite(amount) || amount === 0) {
      setError("Enter the date received and the amount.");
      return;
    }
    setBusy("new");
    setError(null);
    const prop = draft.property_id ? propertyById.get(draft.property_id) : null;
    const { error: err } = await supabase.from("income_records").insert({
      organization_id: orgId,
      year: Number(draft.received_date.slice(0, 4)),
      received_date: draft.received_date,
      payer: draft.payer.trim() || null,
      entity_id: draft.entity_id || prop?.entity_id || null,
      property_id: draft.property_id || null,
      income_type: draft.income_type,
      amount,
      basis: "received",
      notes: draft.notes.trim() || null,
    });
    setBusy(null);
    if (err) {
      setError(friendlyDbError(err, "Could not save the record. What you typed is still here; try again."));
      return;
    }
    setDraft({ received_date: "", payer: "", entity_id: "", property_id: "", income_type: draft.income_type, amount: "", notes: "" });
    setAdding(false);
    router.refresh();
  }

  const sel = "rounded border border-gray-300 px-1.5 py-0.5 text-xs";
  const input = "rounded-lg border border-gray-300 px-2 py-1 text-sm";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setAdding((a) => !a)}
          className="rounded-lg bg-kelly-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-kelly-600"
        >
          {adding ? "Cancel" : "Add a record"}
        </button>
        <span className="text-xs text-gray-500">
          For rent paid under a lease in Turnrow, record the payment on the lease instead.
        </span>
      </div>
      {adding ? (
        <div className="grid gap-2 rounded-xl border border-gray-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs text-gray-600">
            Date received
            <input type="date" value={draft.received_date} onChange={(e) => setDraft({ ...draft, received_date: e.target.value })} className={`${input} block w-full`} />
          </label>
          <label className="text-xs text-gray-600">
            Amount
            <input inputMode="decimal" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} className={`${input} block w-full`} placeholder="0.00" />
          </label>
          <label className="text-xs text-gray-600">
            Type
            <select value={draft.income_type} onChange={(e) => setDraft({ ...draft, income_type: e.target.value })} className={`${input} block w-full`}>
              {INCOME_RECORD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {INCOME_RECORD_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-gray-600">
            Paid by
            <input value={draft.payer} onChange={(e) => setDraft({ ...draft, payer: e.target.value })} className={`${input} block w-full`} />
          </label>
          <label className="text-xs text-gray-600">
            Property
            <select value={draft.property_id} onChange={(e) => setDraft({ ...draft, property_id: e.target.value })} className={`${input} block w-full`}>
              <option value="">Not tied to a property</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-gray-600">
            Entity {draft.property_id ? "(from the property)" : ""}
            <select
              value={draft.property_id ? (propertyById.get(draft.property_id)?.entity_id ?? "") : draft.entity_id}
              disabled={!!draft.property_id}
              onChange={(e) => setDraft({ ...draft, entity_id: e.target.value })}
              className={`${input} block w-full`}
            >
              <option value="">No entity</option>
              {entities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-gray-600 sm:col-span-2">
            Note
            <input value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} className={`${input} block w-full`} />
          </label>
          <div className="sm:col-span-2 lg:col-span-4">
            <button
              onClick={add}
              disabled={busy === "new"}
              className="rounded-lg bg-kelly-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-50"
            >
              Save record
            </button>
          </div>
        </div>
      ) : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {rows.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">No income records here.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Paid by</th>
                <th className="px-3 py-2">Entity and property</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2">Note</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={`border-t border-gray-100 align-top ${busy === r.id ? "opacity-50" : ""}`}>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-900">
                    {r.received_date ? formatDate(r.received_date) : r.year}
                    {r.period && r.period !== r.received_date && r.period !== String(r.year) ? (
                      <span className="block text-xs text-gray-500">{r.period}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-gray-800">
                    {r.payer ?? ""}
                    {r.payee_name ? <span className="block text-xs text-gray-500">to {r.payee_name}</span> : null}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={r.entity_id ?? ""}
                      onChange={(e) => update(r.id, { entity_id: e.target.value || null })}
                      className={`${sel} block`}
                      aria-label="Entity"
                    >
                      <option value="">No entity</option>
                      {entities.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={r.property_id ?? ""}
                      onChange={(e) => {
                        const pid = e.target.value || null;
                        const ent = pid ? propertyById.get(pid)?.entity_id : null;
                        update(r.id, { property_id: pid, ...(ent ? { entity_id: ent } : {}) });
                      }}
                      className={`${sel} mt-1 block`}
                      aria-label="Property"
                    >
                      <option value="">Not tied to a property</option>
                      {properties
                        .filter((p) => !r.entity_id || p.entity_id === r.entity_id || p.id === r.property_id)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select value={r.income_type} onChange={(e) => update(r.id, { income_type: e.target.value })} className={sel} aria-label="Type">
                      {INCOME_RECORD_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {INCOME_RECORD_TYPE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                    {/* Owed and calculated records are not counted as
                        received; once the money is in, mark it here. */}
                    {r.basis !== "received" ? (
                      <label className="mt-1 block text-xs text-amber-800">
                        Not counted as received
                        <select
                          value={r.basis}
                          onChange={(e) => update(r.id, { basis: e.target.value })}
                          className={`${sel} mt-0.5 block border-amber-300 bg-amber-50 text-amber-900`}
                          aria-label="How firm this figure is"
                        >
                          {Object.entries(BASIS_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                          {BASIS_LABELS[r.basis] ? null : <option value={r.basis}>{r.basis}</option>}
                        </select>
                      </label>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums text-gray-900">{formatDollars(r.amount)}</td>
                  <td className="min-w-[18rem] max-w-md px-3 py-2 text-xs text-gray-600">
                    {r.notes ?? ""}
                    {r.source ? (
                      <details className="mt-0.5">
                        <summary className="cursor-pointer text-gray-400">Source</summary>
                        <span className="break-all">{r.source}</span>
                      </details>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button
                      onClick={() => update(r.id, { needs_review: !r.needs_review })}
                      className={
                        "rounded-full px-2 py-0.5 text-xs font-semibold " +
                        (r.needs_review ? "bg-amber-100 text-amber-900" : "text-gray-400 hover:text-gray-600")
                      }
                      title={r.needs_review ? "Clear once checked" : "Mark to check later"}
                    >
                      {r.needs_review ? "Check" : "Checked"}
                    </button>
                    <button onClick={() => remove(r)} disabled={busy !== null} className="ml-2 text-xs text-gray-400 hover:text-red-700 disabled:opacity-60" title="Delete this record">
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.some((r) => !r.entity_id) ? (
        <p className="text-xs text-gray-500">Records with no entity show only under All entities on the Income page.</p>
      ) : null}
    </div>
  );
}
