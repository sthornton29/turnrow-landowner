"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { formatDollars, formatNumber } from "@/lib/format";
import {
  TAX_STATUS_CLASSES,
  TAX_STATUS_LABELS,
  taxStatus,
  type TaxPaymentRow,
  type TaxStatementRow,
} from "@/lib/tax";
import EntityDocuments from "@/components/documents/EntityDocuments";
import { NO_ENTITY } from "@/lib/entities";

interface Parcel {
  id: string;
  parcel_number: string;
  county: string | null;
  property_id: string;
  acres: number | null;
}

const inputClass = "rounded-lg border border-gray-300 px-2 py-1.5 text-sm";

export default function TaxStatusClient({
  orgId,
  parcels,
  properties,
  initialStatements,
  initialPayments,
  entities,
}: {
  orgId: string;
  parcels: Parcel[];
  properties: Array<{ id: string; name: string; entity_id: string | null }>;
  initialStatements: TaxStatementRow[];
  initialPayments: TaxPaymentRow[];
  entities: Array<{ id: string; name: string }>;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [statements, setStatements] = useState(initialStatements);
  const [payments, setPayments] = useState(initialPayments);
  const currentYear = new Date().getFullYear();
  const years = useMemo(() => {
    const set = new Set(statements.map((s) => s.tax_year));
    set.add(currentYear);
    return Array.from(set).sort((a, b) => b - a);
  }, [statements, currentYear]);
  const [year, setYear] = useState(currentYear);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [recordingFor, setRecordingFor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchDate, setBatchDate] = useState(new Date().toISOString().slice(0, 10));
  const [batchMethod, setBatchMethod] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resolveParcelId, setResolveParcelId] = useState<Record<string, string>>({});

  const reload = useCallback(async () => {
    const [s, p] = await Promise.all([
      supabase.from("tax_statements").select("*").order("tax_year", { ascending: false }),
      supabase.from("tax_payments").select("*").order("paid_date"),
    ]);
    setStatements((s.data as TaxStatementRow[]) ?? []);
    setPayments((p.data as TaxPaymentRow[]) ?? []);
  }, [supabase]);

  const propertyName = new Map(properties.map((p) => [p.id, p.name]));
  const parcelById = new Map(parcels.map((p) => [p.id, p]));

  // Entity filter: parcel -> property -> entity. Unmatched statements
  // belong to no parcel yet, so they only show under "All entities".
  const [entityFilter, setEntityFilter] = useState("");
  const entityOfProperty = new Map(
    properties.map((p) => [p.id, p.entity_id ?? NO_ENTITY])
  );
  const entityOfParcel = (parcel: Parcel) =>
    entityOfProperty.get(parcel.property_id) ?? NO_ENTITY;
  const visibleParcels = entityFilter
    ? parcels.filter((p) => entityOfParcel(p) === entityFilter)
    : parcels;
  const visibleParcelIds = new Set(visibleParcels.map((p) => p.id));

  const paidByStatement = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of payments) {
      map.set(p.tax_statement_id, (map.get(p.tax_statement_id) ?? 0) + p.amount);
    }
    return map;
  }, [payments]);

  const allYearStatements = statements.filter((s) => s.tax_year === year);
  const yearStatements = entityFilter
    ? allYearStatements.filter(
        (s) => s.parcel_id && visibleParcelIds.has(s.parcel_id)
      )
    : allYearStatements;
  const matched = yearStatements.filter((s) => s.parcel_id);
  const unmatched = yearStatements.filter((s) => !s.parcel_id);
  const coveredParcelIds = new Set(matched.map((s) => s.parcel_id!));
  const missingParcels = visibleParcels.filter((p) => !coveredParcelIds.has(p.id));

  const totalDue = yearStatements.reduce((s, x) => s + x.amount_due, 0);
  const totalPaid = yearStatements.reduce(
    (s, x) => s + (paidByStatement.get(x.id) ?? 0),
    0
  );

  // Per-entity rollup for the "All entities" view: is everything each
  // entity owns covered and paid?
  const entityRollup = useMemo(() => {
    if (entities.length === 0 || entityFilter) return [];
    const keys = [...entities.map((e) => e.id), NO_ENTITY];
    return keys
      .map((key) => {
        const entityParcels = parcels.filter((p) => entityOfParcel(p) === key);
        if (entityParcels.length === 0) return null;
        const ids = new Set(entityParcels.map((p) => p.id));
        const entityStatements = allYearStatements.filter(
          (s) => s.parcel_id && ids.has(s.parcel_id)
        );
        const due = entityStatements.reduce((s, x) => s + x.amount_due, 0);
        const paid = entityStatements.reduce(
          (s, x) => s + (paidByStatement.get(x.id) ?? 0),
          0
        );
        return {
          key,
          name:
            key === NO_ENTITY
              ? "No entity"
              : (entities.find((e) => e.id === key)?.name ?? "Entity"),
          parcels: entityParcels.length,
          covered: new Set(entityStatements.map((s) => s.parcel_id)).size,
          due,
          paid,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entities, entityFilter, parcels, allYearStatements, paidByStatement]);

  const today = new Date();
  const statusOf = (s: TaxStatementRow) =>
    taxStatus(s, paidByStatement.get(s.id) ?? 0, today);

  async function recordPayment(statement: TaxStatementRow, formData: FormData) {
    setError(null);
    const { error: err } = await supabase.from("tax_payments").insert({
      organization_id: orgId,
      tax_statement_id: statement.id,
      paid_date: String(formData.get("paid_date") ?? ""),
      amount: Number(formData.get("amount") ?? 0),
      method: String(formData.get("method") ?? "").trim() || null,
      memo: String(formData.get("memo") ?? "").trim() || null,
    });
    if (err) {
      setError("Could not record the payment: " + err.message);
      return;
    }
    setRecordingFor(null);
    reload();
  }

  async function recordBatch() {
    setError(null);
    const rows = Array.from(selected)
      .map((id) => yearStatements.find((s) => s.id === id))
      .filter((s): s is TaxStatementRow => !!s)
      .map((s) => ({
        organization_id: orgId,
        tax_statement_id: s.id,
        paid_date: batchDate,
        amount: Math.max(s.amount_due - (paidByStatement.get(s.id) ?? 0), 0),
        method: batchMethod.trim() || null,
        memo: null,
      }))
      .filter((r) => r.amount > 0);
    if (rows.length === 0) {
      setError("Nothing selected with a balance remaining.");
      return;
    }
    const { error: err } = await supabase.from("tax_payments").insert(rows);
    if (err) {
      setError("Could not record the payments: " + err.message);
      return;
    }
    setSelected(new Set());
    setBatchMethod("");
    reload();
  }

  async function resolveUnmatched(statement: TaxStatementRow) {
    const parcelId = resolveParcelId[statement.id];
    if (!parcelId) return;
    setError(null);
    const { error: err } = await supabase
      .from("tax_statements")
      .update({ parcel_id: parcelId })
      .eq("id", statement.id);
    if (err) {
      setError(
        err.message.includes("duplicate") || err.code === "23505"
          ? `That parcel already has a ${statement.tax_year} statement.`
          : "Could not match: " + err.message
      );
      return;
    }
    reload();
  }

  async function deleteStatement(statement: TaxStatementRow) {
    if (
      !window.confirm(
        "Delete this tax statement and its recorded payments? The attached document is removed too."
      )
    ) {
      return;
    }
    await supabase.from("tax_statements").delete().eq("id", statement.id);
    reload();
  }

  async function deleteTaxPayment(id: string) {
    if (!window.confirm("Delete this recorded payment?")) return;
    await supabase.from("tax_payments").delete().eq("id", id);
    reload();
  }

  function toggleSelected(id: string) {
    setSelected((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function paymentForm(statement: TaxStatementRow) {
    const remaining = Math.max(
      statement.amount_due - (paidByStatement.get(statement.id) ?? 0),
      0
    );
    return (
      <form
        action={(fd) => recordPayment(statement, fd)}
        className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 p-2"
      >
        <input
          name="paid_date"
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
          defaultValue={remaining || ""}
          placeholder="Amount"
          className={`${inputClass} w-28`}
        />
        <input name="method" placeholder="Check # / method" className={`${inputClass} w-36`} />
        <input name="memo" placeholder="Memo" className={`${inputClass} min-w-20 flex-1`} />
        <button
          type="submit"
          className="rounded-lg bg-kelly-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-kelly-600"
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
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Tax Statement Status</h1>
          <p className="mt-0.5 text-sm text-gray-600">
            Every parcel should have a statement each year; a missing one is
            how a parcel quietly goes delinquent.
          </p>
        </div>
        <span className="ml-auto flex items-center gap-2">
          {entities.length > 0 ? (
            <select
              value={entityFilter}
              onChange={(e) => setEntityFilter(e.target.value)}
              className={inputClass}
            >
              <option value="">All entities</option>
              {entities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.name}
                </option>
              ))}
              <option value={NO_ENTITY}>No entity</option>
            </select>
          ) : null}
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className={inputClass}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                Tax year {y}
              </option>
            ))}
          </select>
          <Link
            href="/taxes/upload"
            className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600"
          >
            + Upload statements
          </Link>
        </span>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { label: "Parcels", value: formatNumber(visibleParcels.length) },
          {
            label: "Statements on file",
            value: `${formatNumber(coveredParcelIds.size)} of ${formatNumber(visibleParcels.length)}`,
          },
          { label: "Total due", value: formatDollars(totalDue) },
          { label: "Total paid", value: formatDollars(totalPaid) },
          {
            label: "Outstanding",
            value: formatDollars(Math.max(totalDue - totalPaid, 0)),
          },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-gray-200 bg-white p-3">
            <p className="text-lg font-semibold tabular-nums text-gray-900">{s.value}</p>
            <p className="text-xs text-gray-500">{s.label}</p>
          </div>
        ))}
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {/* Per-entity rollup: is everything each entity owns covered and paid? */}
      {entityRollup.length > 0 ? (
        <section className="rounded-xl border border-gray-200 bg-white">
          <h2 className="border-b border-gray-200 px-4 py-3 text-base font-semibold text-gray-900">
            {year} by entity
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-2">Entity</th>
                  <th className="px-4 py-2 text-right">Statements</th>
                  <th className="px-4 py-2 text-right">Due</th>
                  <th className="px-4 py-2 text-right">Paid</th>
                  <th className="px-4 py-2 text-right">Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {entityRollup.map((r) => (
                  <tr key={r.key} className="border-b border-gray-100 last:border-0">
                    <td className="px-4 py-2">
                      <button
                        onClick={() => setEntityFilter(r.key)}
                        className={
                          "font-medium hover:underline " +
                          (r.key === NO_ENTITY ? "text-gray-500" : "text-gray-900")
                        }
                      >
                        {r.name}
                      </button>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      <span
                        className={
                          r.covered < r.parcels ? "font-medium text-amber-700" : ""
                        }
                      >
                        {formatNumber(r.covered)} of {formatNumber(r.parcels)}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatDollars(r.due)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatDollars(r.paid)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      <span
                        className={
                          r.due - r.paid > 0.005 ? "font-medium text-red-700" : ""
                        }
                      >
                        {formatDollars(Math.max(r.due - r.paid, 0))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* Missing statements: the headline warning */}
      {missingParcels.length > 0 ? (
        <section className="rounded-xl border border-amber-200 bg-white">
          <h2 className="border-b border-amber-100 bg-amber-50 px-4 py-3 text-base font-semibold text-amber-900">
            No statement on file for {year}: {formatNumber(missingParcels.length)} parcel
            {missingParcels.length === 1 ? "" : "s"}
          </h2>
          <ul className="divide-y divide-gray-100">
            {missingParcels.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                <span className="font-medium text-gray-900">Parcel {p.parcel_number}</span>
                <span className="text-gray-500">
                  {propertyName.get(p.property_id) ?? ""}
                  {p.county ? ` · ${p.county}` : ""}
                </span>
                <Link
                  href="/taxes/upload"
                  className="ml-auto text-sm font-medium text-kelly-700 hover:underline"
                >
                  Upload statement
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : visibleParcels.length > 0 ? (
        <p className="rounded-xl border border-kelly-100 bg-kelly-50 p-3 text-sm font-medium text-pine-900">
          Every parcel has a {year} statement on file.
        </p>
      ) : null}

      {/* Unmatched statements */}
      {unmatched.length > 0 ? (
        <section className="rounded-xl border border-gray-200 bg-white">
          <h2 className="border-b border-gray-200 px-4 py-3 text-base font-semibold text-gray-900">
            Unmatched statements ({unmatched.length})
          </h2>
          <ul className="divide-y divide-gray-100">
            {unmatched.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
                <span className="font-medium text-gray-900">
                  {s.parcel_number_printed ?? "No parcel number"}
                </span>
                <span className="text-gray-500">
                  {[s.county, s.owner_name_printed].filter(Boolean).join(" · ")}
                  {" · "}
                  {formatDollars(s.amount_due)}
                </span>
                <span className="ml-auto flex items-center gap-2">
                  <select
                    value={resolveParcelId[s.id] ?? ""}
                    onChange={(e) =>
                      setResolveParcelId((m) => ({ ...m, [s.id]: e.target.value }))
                    }
                    className={inputClass}
                  >
                    <option value="">Match to parcel...</option>
                    {parcels.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.parcel_number} · {propertyName.get(p.property_id) ?? ""}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => resolveUnmatched(s)}
                    disabled={!resolveParcelId[s.id]}
                    className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Match
                  </button>
                  <button
                    onClick={() => deleteStatement(s)}
                    className="text-xs font-medium text-red-600 hover:underline"
                  >
                    Delete
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Batch payment bar */}
      {selected.size > 0 ? (
        <div className="sticky top-16 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-kelly-100 bg-kelly-50 p-3 shadow-md">
          <span className="text-sm font-medium text-pine-900">
            {selected.size} selected
          </span>
          <input
            type="date"
            value={batchDate}
            onChange={(e) => setBatchDate(e.target.value)}
            className={inputClass}
          />
          <input
            value={batchMethod}
            onChange={(e) => setBatchMethod(e.target.value)}
            placeholder="Check # / method"
            className={`${inputClass} w-40`}
          />
          <button
            onClick={recordBatch}
            className="rounded-lg bg-kelly-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-kelly-600"
          >
            Record payment for selected
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="text-sm text-gray-600 hover:underline"
          >
            Clear
          </button>
        </div>
      ) : null}

      {/* Statements on file */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-gray-900">
          Statements on file for {year}
        </h2>
        {matched.length === 0 ? (
          <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">
            No statements yet for {year}.{" "}
            <Link href="/taxes/upload" className="font-medium text-kelly-700 hover:underline">
              Upload the first one
            </Link>
            .
          </p>
        ) : (
          <ul className="space-y-2">
            {matched.map((s) => {
              const parcel = s.parcel_id ? parcelById.get(s.parcel_id) : null;
              const paid = paidByStatement.get(s.id) ?? 0;
              const status = statusOf(s);
              const statementPayments = payments.filter(
                (p) => p.tax_statement_id === s.id
              );
              return (
                <li key={s.id} className="rounded-xl border border-gray-200 bg-white p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {status !== "paid" ? (
                      <input
                        type="checkbox"
                        checked={selected.has(s.id)}
                        onChange={() => toggleSelected(s.id)}
                        className="h-4 w-4 accent-kelly-500"
                        title="Select for batch payment"
                      />
                    ) : (
                      <span className="w-4" />
                    )}
                    <span className="font-medium text-gray-900">
                      Parcel {parcel?.parcel_number ?? s.parcel_number_printed}
                    </span>
                    <span className="text-sm text-gray-500">
                      {parcel ? propertyName.get(parcel.property_id) ?? "" : ""}
                      {s.county ? ` · ${s.county}` : ""}
                      {s.due_date ? ` · due ${s.due_date}` : ""}
                    </span>
                    <span className="ml-auto flex items-center gap-2">
                      <span className="text-sm font-medium tabular-nums text-gray-900">
                        {formatDollars(s.amount_due)}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${TAX_STATUS_CLASSES[status]}`}
                      >
                        {TAX_STATUS_LABELS[status]}
                        {status === "partial" ? ` (${formatDollars(paid)})` : ""}
                      </span>
                      {status !== "paid" ? (
                        <button
                          onClick={() =>
                            setRecordingFor(recordingFor === s.id ? null : s.id)
                          }
                          className="text-sm font-medium text-kelly-700 hover:underline"
                        >
                          Record payment
                        </button>
                      ) : null}
                      <button
                        onClick={() => setExpanded(expanded === s.id ? null : s.id)}
                        className="text-sm text-gray-500 hover:underline"
                      >
                        {expanded === s.id ? "Close" : "Details"}
                      </button>
                    </span>
                  </div>

                  {recordingFor === s.id ? paymentForm(s) : null}

                  {expanded === s.id ? (
                    <div className="mt-3 space-y-3 border-t border-gray-100 pt-3 text-sm">
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
                        {[
                          ["Authority", s.authority_name],
                          ["Owner as printed", s.owner_name_printed],
                          ["Parcel as printed", s.parcel_number_printed],
                          [
                            "Assessed value",
                            s.assessed_value !== null
                              ? formatDollars(s.assessed_value)
                              : null,
                          ],
                          ["Delinquent date", s.delinquent_date],
                          ["Notes", s.notes],
                        ]
                          .filter(([, v]) => v)
                          .map(([label, value]) => (
                            <div key={label as string}>
                              <dt className="text-xs text-gray-500">{label}</dt>
                              <dd className="text-gray-900">{value}</dd>
                            </div>
                          ))}
                      </dl>
                      {statementPayments.length > 0 ? (
                        <div>
                          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Payments
                          </p>
                          <ul className="space-y-1">
                            {statementPayments.map((p) => (
                              <li key={p.id} className="flex items-center gap-2">
                                <span>{p.paid_date}</span>
                                <span className="font-medium">{formatDollars(p.amount)}</span>
                                <span className="text-gray-500">
                                  {[p.method, p.memo].filter(Boolean).join(" · ")}
                                </span>
                                <button
                                  onClick={() => deleteTaxPayment(p.id)}
                                  className="ml-auto text-xs font-medium text-red-600 hover:underline"
                                >
                                  Delete
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      <div>
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Statement document
                        </p>
                        <EntityDocuments
                          orgId={orgId}
                          entityType="tax_statement"
                          entityId={s.id}
                        />
                      </div>
                      <button
                        onClick={() => deleteStatement(s)}
                        className="text-xs font-medium text-red-600 hover:underline"
                      >
                        Delete statement
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
