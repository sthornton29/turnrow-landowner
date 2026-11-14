"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { friendlyDbError } from "@/lib/dbErrors";
import { formatDate, formatDollars, todayISO } from "@/lib/format";
import {
  PAYMENT_STATUS_LABELS,
  STATUS_BADGE_CLASSES,
  paymentStatus,
  planScheduleRefresh,
  type GeneratedPayment,
} from "@/lib/leaseLogic";
import RentUpload from "@/components/payments/RentUpload";

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

// The database refuses to delete an expected row while a payment still
// points at it. Say that; the generic text for that error code ("something
// required is missing") would send the reader looking for an empty field.
function expectedDeleteError(
  err: { code?: string | null; message?: string | null },
  fallback: string
): string {
  return err.code === "23502" || err.code === "23503"
    ? "A payment is recorded against an expected payment that was about to be removed, so nothing was removed."
    : friendlyDbError(err, fallback);
}

// Expected vs actual payments for one lease or timber sale.
// "Sync" regenerates expected rows from the parent's computeExpected()
// but NEVER touches rows that already have payments recorded.
// canManageSchedule: false hides the controls that regenerate or delete
// the shared schedule rows (a member who sees only part of a lease's land
// would rewrite the schedule for everyone from partial acreage).
export default function PaymentsSection({
  orgId,
  leaseId,
  timberSaleId,
  computeExpected,
  emptyHint,
  canManageSchedule = true,
}: {
  orgId: string;
  leaseId?: string;
  timberSaleId?: string;
  computeExpected?: () => GeneratedPayment[];
  emptyHint?: string;
  canManageSchedule?: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [expected, setExpected] = useState<ExpectedRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recordingFor, setRecordingFor] = useState<string | "extra" | null>(null);

  // Both tables as they stand in the database right now, or null when
  // either read failed.
  const fetchRows = useCallback(async (): Promise<{
    expected: ExpectedRow[];
    payments: PaymentRow[];
  } | null> => {
    const col = leaseId ? "lease_id" : "timber_sale_id";
    const idVal = (leaseId ?? timberSaleId)!;
    const [e, p] = await Promise.all([
      supabase.from("expected_payments").select("*").eq(col, idVal).order("due_date"),
      supabase.from("payments").select("*").eq(col, idVal).order("received_date"),
    ]);
    if (e.error || p.error) return null;
    return {
      expected: (e.data as ExpectedRow[]) ?? [],
      payments: (p.data as PaymentRow[]) ?? [],
    };
  }, [supabase, leaseId, timberSaleId]);

  const load = useCallback(async () => {
    const rows = await fetchRows();
    if (!rows) {
      setError("Could not load the payments. Check your connection and reload the page.");
      return;
    }
    setExpected(rows.expected);
    setPayments(rows.payments);
  }, [fetchRows]);

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
    if (!computeExpected || busy) return;
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
    // Read the rows again right now: a payment recorded since this
    // section loaded (an uploaded check, another tab, another person)
    // must protect its expected row.
    const fresh = await fetchRows();
    if (!fresh) {
      setError("Could not check the payments on file, so nothing was changed. Check your connection and try again.");
      setBusy(false);
      return;
    }
    const paidIds = new Set(
      fresh.payments.map((p) => p.expected_payment_id).filter((id): id is string => !!id)
    );
    // Only rows with no payments recorded against them are replaced; a
    // paid row stands for its installment of the new schedule.
    const plan = planScheduleRefresh(fresh.expected, paidIds, target);

    // New rows go in FIRST: if they are refused, the old schedule is
    // still there, untouched.
    let insertedIds: string[] = [];
    if (plan.inserts.length > 0) {
      const { data, error: err } = await supabase
        .from("expected_payments")
        .insert(
          plan.inserts.map((t) => ({
            organization_id: orgId,
            lease_id: leaseId ?? null,
            timber_sale_id: timberSaleId ?? null,
            year: t.year,
            label: t.label,
            due_date: t.due_date,
            expected_amount: t.expected_amount,
          }))
        )
        .select("id");
      if (err) {
        setError(
          friendlyDbError(err, "Could not save the new expected payments.") +
            " The schedule was left as it was."
        );
        setBusy(false);
        await load();
        return;
      }
      insertedIds = ((data as Array<{ id: string }> | null) ?? []).map((r) => r.id);
    }
    if (plan.deleteIds.length > 0) {
      const { error: err } = await supabase
        .from("expected_payments")
        .delete()
        .in("id", plan.deleteIds);
      if (err) {
        // The old unpaid rows are still there, so take the new ones back
        // out rather than leave both standing.
        const undo =
          insertedIds.length > 0
            ? await supabase.from("expected_payments").delete().in("id", insertedIds)
            : { error: null };
        setError(
          undo.error
            ? "The old expected payments could not be removed, and the new ones were added beside them. Delete the extra unpaid rows below, then refresh again."
            : expectedDeleteError(err, "Could not replace the old expected payments.") +
                " The schedule was left as it was. Try again."
        );
      }
    }
    setBusy(false);
    await load();
  }

  async function recordPayment(formData: FormData, expectedId: string | null) {
    if (busy) return;
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
      setError(friendlyDbError(err, "Could not record the payment. Nothing was saved; try again."));
      return;
    }
    setRecordingFor(null);
    load();
  }

  async function deletePayment(id: string) {
    if (busy) return;
    if (!window.confirm("Delete this recorded payment?")) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from("payments").delete().eq("id", id);
    setBusy(false);
    if (err) setError(friendlyDbError(err, "Could not delete the payment. It is still recorded."));
    load();
  }

  // Deleting an expected row never deletes money received: the payments
  // FK is meant to set null, so recorded payments stay as unscheduled.
  // (As the FK stands in migration 0003 the database refuses the delete
  // while a payment points at the row; the refusal is shown, never
  // swallowed.)
  async function deleteExpected(e: ExpectedRow) {
    if (busy) return;
    const received = receivedByExpected.get(e.id) ?? 0;
    const message =
      received > 0
        ? `Delete the expected "${e.label}" (${e.year})? Payments recorded against it stay as unscheduled payments.`
        : `Delete the expected "${e.label}" (${e.year})?`;
    if (!window.confirm(message)) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from("expected_payments").delete().eq("id", e.id);
    setBusy(false);
    if (err) {
      setError(
        expectedDeleteError(err, "Could not delete the expected payment. It is still on the schedule.")
      );
    }
    load();
  }

  const today = new Date();

  function paymentForm(expectedId: string | null, defaultAmount?: number) {
    return (
      <form
        // onSubmit, not action: a form action clears the boxes when it
        // finishes, and a payment that failed to save must keep what was typed.
        onSubmit={(ev) => {
          ev.preventDefault();
          recordPayment(new FormData(ev.currentTarget), expectedId);
        }}
        className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 p-2"
      >
        <input
          name="received_date"
          type="date"
          required
          defaultValue={todayISO()}
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
        <span className="ml-auto flex flex-wrap justify-end gap-2">
          {computeExpected && canManageSchedule ? (
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
          {leaseId ? <RentUpload orgId={orgId} defaultLeaseId={leaseId} onSaved={load} /> : null}
        </span>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {recordingFor === "extra" ? paymentForm(null) : null}

      {expected.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">
          {!canManageSchedule
            ? "No payment schedule yet. An admin on your account can generate the expected payments; you can still record payments received."
            : (emptyHint ??
              (leaseId
                ? "No payment schedule yet, and none is needed for projections: the Income page already projects this lease from its terms and assumptions. Generate expected payments when you want dated installments to track and record payments against."
                : "No expected payments yet. Complete the terms and press Generate expected payments."))}
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
                    <td className="whitespace-nowrap px-3 py-2">{formatDate(e.due_date)}</td>
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
                        <span className="flex items-center gap-2">
                          <button
                            onClick={() => setRecordingFor(e.id)}
                            className="text-sm font-medium text-kelly-700 hover:underline"
                          >
                            Record payment
                          </button>
                          {canManageSchedule ? (
                            <button
                              onClick={() => deleteExpected(e)}
                              disabled={busy}
                              className="text-xs font-medium text-red-600 hover:underline disabled:opacity-60"
                              title="Remove this expected payment; recorded payments stay"
                            >
                              Delete
                            </button>
                          ) : null}
                        </span>
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
                <span>{formatDate(p.received_date)}</span>
                <span className="font-medium">{formatDollars(p.amount)}</span>
                <span className="text-gray-500">
                  {[p.method, p.memo, p.expected_payment_id ? "" : "unscheduled"]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <button
                  onClick={() => deletePayment(p.id)}
                  disabled={busy}
                  className="ml-auto text-xs font-medium text-red-600 hover:underline disabled:opacity-60"
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
