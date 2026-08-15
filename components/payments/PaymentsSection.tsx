"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatDollars } from "@/lib/format";
import {
  PAYMENT_STATUS_LABELS,
  STATUS_BADGE_CLASSES,
  paymentStatus,
  type GeneratedPayment,
} from "@/lib/leaseLogic";

interface ExpectedRow {
  id: string;
  year: number;
  label: string;
  due_date: string;
  expected_amount: number;
}

interface PaymentRow {
  id: string;
  expected_payment_id: string | null;
  received_date: string;
  amount: number;
  method: string | null;
  memo: string | null;
}

const inputClass = "rounded-lg border border-gray-300 px-2 py-1.5 text-sm";

// Expected vs actual payments for one lease or timber sale.
// "Sync" regenerates expected rows from the parent's computeExpected()
// but NEVER touches rows that already have payments recorded.
export default function PaymentsSection({
  orgId,
  leaseId,
  timberSaleId,
  computeExpected,
  emptyHint,
}: {
  orgId: string;
  leaseId?: string;
  timberSaleId?: string;
  computeExpected?: () => GeneratedPayment[];
  emptyHint?: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [expected, setExpected] = useState<ExpectedRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recordingFor, setRecordingFor] = useState<string | "extra" | null>(null);

  const load = useCallback(async () => {
    const col = leaseId ? "lease_id" : "timber_sale_id";
    const idVal = (leaseId ?? timberSaleId)!;
    const [e, p] = await Promise.all([
      supabase.from("expected_payments").select("*").eq(col, idVal).order("due_date"),
      supabase.from("payments").select("*").eq(col, idVal).order("received_date"),
    ]);
    setExpected((e.data as ExpectedRow[]) ?? []);
    setPayments((p.data as PaymentRow[]) ?? []);
  }, [supabase, leaseId, timberSaleId]);

  useEffect(() => {
    load();
  }, [load]);

  const receivedByExpected = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of payments) {
      if (p.expected_payment_id) {
        map.set(p.expected_payment_id, (map.get(p.expected_payment_id) ?? 0) + p.amount);
      }
    }
    return map;
  }, [payments]);

  const extraPayments = payments.filter((p) => !p.expected_payment_id);
  const totalExpected = expected.reduce((s, e) => s + e.expected_amount, 0);
  const totalReceived = payments.reduce((s, p) => s + p.amount, 0);

  async function sync() {
    if (!computeExpected) return;
    setBusy(true);
    setError(null);
    const target = computeExpected();
    if (target.length === 0) {
      setError(
        "Nothing to generate yet. Terms, dates, linked land, or per-year assumptions are incomplete."
      );
      setBusy(false);
      return;
    }
    // Delete only rows with no payments recorded against them.
    const deletable = expected.filter((e) => !receivedByExpected.has(e.id));
    const keep = expected.filter((e) => receivedByExpected.has(e.id));
    if (deletable.length > 0) {
      await supabase
        .from("expected_payments")
        .delete()
        .in("id", deletable.map((d) => d.id));
    }
    // Insert target rows that aren't already represented by a kept row
    // (same year + label + due date).
    const keptKeys = new Set(keep.map((k) => `${k.year}|${k.label}|${k.due_date}`));
    const inserts = target
      .filter((t) => !keptKeys.has(`${t.year}|${t.label}|${t.due_date}`))
      .map((t) => ({
        organization_id: orgId,
        lease_id: leaseId ?? null,
        timber_sale_id: timberSaleId ?? null,
        year: t.year,
        label: t.label,
        due_date: t.due_date,
        expected_amount: t.expected_amount,
      }));
    if (inserts.length > 0) {
      const { error: err } = await supabase.from("expected_payments").insert(inserts);
      if (err) setError("Could not generate: " + err.message);
    }
    setBusy(false);
    load();
  }

  async function recordPayment(formData: FormData, expectedId: string | null) {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from("payments").insert({
      organization_id: orgId,
      lease_id: leaseId ?? null,
      timber_sale_id: timberSaleId ?? null,
      expected_payment_id: expectedId,
      received_date: String(formData.get("received_date") ?? ""),
      amount: Number(formData.get("amount") ?? 0),
      method: String(formData.get("method") ?? "").trim() || null,
      memo: String(formData.get("memo") ?? "").trim() || null,
    });
    setBusy(false);
    if (err) {
      setError("Could not record the payment: " + err.message);
      return;
    }
    setRecordingFor(null);
    load();
  }

  async function deletePayment(id: string) {
    if (!window.confirm("Delete this recorded payment?")) return;
    await supabase.from("payments").delete().eq("id", id);
    load();
  }

  const today = new Date();

  function paymentForm(expectedId: string | null, defaultAmount?: number) {
    return (
      <form
        action={(fd) => recordPayment(fd, expectedId)}
        className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 p-2"
      >
        <input
          name="received_date"
          type="date"
          required
          defaultValue={new Date().toISOString().slice(0, 10)}
          className={inputClass}
        />
        <input
          name="amount"
          type="number"
          step="0.01"
          required
          defaultValue={defaultAmount ?? ""}
          placeholder="Amount"
          className={`${inputClass} w-28`}
        />
        <input name="method" placeholder="Check # / method" className={`${inputClass} w-36`} />
        <input name="memo" placeholder="Memo" className={`${inputClass} min-w-24 flex-1`} />
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-kelly-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-kelly-600 disabled:opacity-60"
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => setRecordingFor(null)}
          className="text-sm text-gray-500 hover:underline"
        >
          Cancel
        </button>
      </form>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold text-gray-900">Payments</h2>
        <span className="text-sm text-gray-500">
          {formatDollars(totalReceived)} received of {formatDollars(totalExpected)} expected
        </span>
        <span className="ml-auto flex gap-2">
          {computeExpected ? (
            <button
              onClick={sync}
              disabled={busy}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              {expected.length === 0 ? "Generate expected payments" : "Refresh expected payments"}
            </button>
          ) : null}
          <button
            onClick={() => setRecordingFor("extra")}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Record unscheduled payment
          </button>
        </span>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {recordingFor === "extra" ? paymentForm(null) : null}

      {expected.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">
          {emptyHint ??
            "No expected payments yet. Complete the terms and press Generate expected payments."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2">Due</th>
                <th className="px-3 py-2">Label</th>
                <th className="px-3 py-2 text-right">Expected</th>
                <th className="px-3 py-2 text-right">Received</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {expected.map((e) => {
                const received = receivedByExpected.get(e.id) ?? 0;
                const status = paymentStatus(e.expected_amount, received, e.due_date, today);
                return (
                  <tr key={e.id} className="border-b border-gray-100 last:border-0 align-top">
                    <td className="whitespace-nowrap px-3 py-2">{e.due_date}</td>
                    <td className="px-3 py-2">
                      {e.label}
                      <span className="text-gray-400"> · {e.year}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {formatDollars(e.expected_amount)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {received > 0 ? formatDollars(received) : ""}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASSES[status]}`}
                      >
                        {PAYMENT_STATUS_LABELS[status]}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {recordingFor === e.id ? (
                        paymentForm(e.id, Math.max(e.expected_amount - received, 0))
                      ) : (
                        <button
                          onClick={() => setRecordingFor(e.id)}
                          className="text-sm font-medium text-kelly-700 hover:underline"
                        >
                          Record payment
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {payments.length > 0 ? (
        <details className="rounded-lg border border-gray-200 bg-white">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-gray-700">
            All recorded payments ({payments.length})
          </summary>
          <ul className="divide-y divide-gray-100 px-3 pb-2">
            {payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span>{p.received_date}</span>
                <span className="font-medium">{formatDollars(p.amount)}</span>
                <span className="text-gray-500">
                  {[p.method, p.memo, p.expected_payment_id ? "" : "unscheduled"]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <button
                  onClick={() => deletePayment(p.id)}
                  className="ml-auto text-xs font-medium text-red-600 hover:underline"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {extraPayments.length > 0 && expected.length === 0 ? null : null}
    </div>
  );
}
