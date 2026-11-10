"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatDollars } from "@/lib/format";
import { SEC126_LABELS, recaptureUntil } from "@/lib/reforestation";
import type { CostShareAwardRow, CostSharePaymentRow } from "@/types/db";
import CostShareForm from "./CostShareForm";

// Small client pieces for the cost-share pages: an "add / edit" toggle
// and the payments list with each payment's Sec 126 choice.

export function CostShareLauncher({
  label,
  primary = true,
  ...props
}: {
  label: string;
  primary?: boolean;
  orgId: string;
  properties: Array<{ id: string; name: string; entity_id: string | null }>;
  entities: Array<{ id: string; name: string }>;
  award: CostShareAwardRow | null;
}) {
  const [open, setOpen] = useState(false);
  if (open) return <CostShareForm {...props} onClose={() => setOpen(false)} />;
  return (
    <button
      onClick={() => setOpen(true)}
      className={
        primary
          ? "rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600"
          : "text-sm font-medium text-kelly-700 hover:underline"
      }
    >
      {label}
    </button>
  );
}

const inputCls = "rounded-lg border border-gray-300 px-2 py-1.5 text-sm";

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function CostSharePayments({
  orgId,
  awardId,
  payments,
}: {
  orgId: string;
  awardId: string;
  payments: CostSharePaymentRow[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [date, setDate] = useState(localToday());
  const [amount, setAmount] = useState("");
  const [practice, setPractice] = useState("");
  const [choice, setChoice] = useState("undecided");
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setError(null);
    const amt = Number(amount.replace(/[$,]/g, ""));
    if (!(amt > 0)) return setError("Enter the amount received.");
    const { error: err } = await supabase.from("cost_share_payments").insert({
      organization_id: orgId,
      award_id: awardId,
      received_date: date,
      amount: Math.round(amt * 100) / 100,
      practice: practice.trim() || null,
      sec126_choice: choice,
    });
    if (err) return setError(`Could not save: ${err.message}`);
    setAmount("");
    setPractice("");
    router.refresh();
  }

  async function setPaymentChoice(id: string, value: string) {
    const { error: err } = await supabase.from("cost_share_payments").update({ sec126_choice: value }).eq("id", id);
    if (err) setError(`Could not save: ${err.message}`);
    else router.refresh();
  }

  async function remove(id: string) {
    const { error: err } = await supabase.from("cost_share_payments").delete().eq("id", id);
    if (err) setError(`Could not remove: ${err.message}`);
    else router.refresh();
  }

  const total = payments.reduce((s, p) => s + Number(p.amount), 0);

  return (
    <div className="space-y-3">
      {payments.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">No payments received yet.</p>
      ) : (
        <ul className="space-y-2">
          {[...payments]
            .sort((a, b) => b.received_date.localeCompare(a.received_date))
            .map((p) => (
              <li key={p.id} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono text-xs text-gray-500">{p.received_date}</span>
                  <span className="font-medium text-gray-900">{formatDollars(Number(p.amount))}</span>
                  {p.practice ? <span className="text-gray-600">{p.practice}</span> : null}
                  <select
                    value={p.sec126_choice}
                    onChange={(e) => setPaymentChoice(p.id, e.target.value)}
                    className="ml-auto rounded-lg border border-gray-300 px-2 py-1 text-xs"
                  >
                    {Object.entries(SEC126_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                  <button onClick={() => remove(p.id)} className="text-xs text-red-600 hover:underline">
                    Remove
                  </button>
                </div>
                {p.sec126_choice === "exclude" ? (
                  <p className="mt-1 text-xs text-amber-800">
                    Recaptured as income if the land is sold before {recaptureUntil(p.received_date, 20)}.
                  </p>
                ) : null}
              </li>
            ))}
          <li className="text-right text-sm font-medium text-pine-900">Received to date: {formatDollars(total)}</li>
        </ul>
      )}

      <div className="rounded-xl border border-kelly-200 bg-kelly-50/40 p-3">
        <p className="mb-2 text-sm font-medium text-gray-900">Record a payment received</p>
        <div className="flex flex-wrap gap-2">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount $" inputMode="decimal" className={`${inputCls} w-32`} />
          <input value={practice} onChange={(e) => setPractice(e.target.value)} placeholder="Practice (612 tree planting)" className={`${inputCls} min-w-0 flex-1`} />
          <select value={choice} onChange={(e) => setChoice(e.target.value)} className={inputCls}>
            {Object.entries(SEC126_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
          <button onClick={add} className="rounded-lg bg-kelly-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-kelly-600">
            Add
          </button>
        </div>
        <p className="mt-2 text-xs text-gray-600">{SEC126_LABELS[choice].help}</p>
        {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
      </div>
    </div>
  );
}
