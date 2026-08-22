"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatDollars, formatNumber } from "@/lib/format";
import {
  TAX_STATUS_CLASSES,
  TAX_STATUS_LABELS,
  taxStatus,
  type TaxPaymentRow,
  type TaxStatementLineRow,
  type TaxStatementRow,
} from "@/lib/tax";
import { IDENTIFIER_KIND_LABELS, type IdentifierKind, type PrintedIdentifier } from "@/lib/taxIdentifiers";
import { confirmLineParcel, loadStoredIdentifiers } from "@/components/taxes/taxLearn";
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

const ACCOUNT_KIND_LABEL: Record<string, string> = {
  account_number: "Account",
  receipt_number: "Receipt",
  key_number: "Key",
  parcel_number: "Parcel",
  bill_number: "Bill",
  other: "Number",
};

// Statements are HEADERS (how the county billed) with LINES (the
// parcels on the bill). Coverage, rollups, and the entity filter key
// off lines; payments apply to the statement; matching a line here
// teaches the parcel every number printed on that line.
export default function TaxStatusClient({
  orgId,
  parcels,
  properties,
  initialStatements,
  initialLines,
  initialPayments,
  entities,
}: {
  orgId: string;
  parcels: Parcel[];
  properties: Array<{ id: string; name: string; entity_id: string | null }>;
  initialStatements: TaxStatementRow[];
  initialLines: TaxStatementLineRow[];
  initialPayments: TaxPaymentRow[];
  entities: Array<{ id: string; name: string }>;
}) {
  const supabase = useMemo(() => createClient(), []);
  const searchParams = useSearchParams();
  const [statements, setStatements] = useState(initialStatements);
  const [lines, setLines] = useState(initialLines);
  const [payments, setPayments] = useState(initialPayments);
  const currentYear = new Date().getFullYear();
  const years = useMemo(() => {
    const set = new Set(statements.map((s) => s.tax_year));
    set.add(currentYear);
    return Array.from(set).sort((a, b) => b - a);
  }, [statements, currentYear]);
  const urlYear = Number(searchParams.get("year"));
  const [year, setYear] = useState(urlYear > 1900 ? urlYear : currentYear);
  useEffect(() => {
    if (urlYear > 1900) setYear(urlYear);
  }, [urlYear]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [recordingFor, setRecordingFor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchDate, setBatchDate] = useState(new Date().toISOString().slice(0, 10));
  const [batchMethod, setBatchMethod] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resolveParcelId, setResolveParcelId] = useState<Record<string, string>>({});
  const [editingEntity, setEditingEntity] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [s, l, p] = await Promise.all([
      supabase.from("tax_statements").select("*").order("tax_year", { ascending: false }),
      supabase.from("tax_statement_lines").select("*").order("line_no"),
      supabase.from("tax_payments").select("*").order("paid_date"),
    ]);
    setStatements((s.data as TaxStatementRow[]) ?? []);
    setLines((l.data as TaxStatementLineRow[]) ?? []);
    setPayments((p.data as TaxPaymentRow[]) ?? []);
  }, [supabase]);

  const propertyName = new Map(properties.map((p) => [p.id, p.name]));
  const parcelById = new Map(parcels.map((p) => [p.id, p]));
  const entityName = (id: string | null | undefined) =>
    id ? (entities.find((e) => e.id === id)?.name ?? "Entity") : null;

  // Entity of a line: the statement's matched entity, else the parcel's
  // property's entity for real-property lines, else No entity.
  const [entityFilter, setEntityFilter] = useState("");
  const entityOfProperty = new Map(properties.map((p) => [p.id, p.entity_id ?? NO_ENTITY]));
  const entityOfParcel = (parcel: Parcel) => entityOfProperty.get(parcel.property_id) ?? NO_ENTITY;
  const statementById = new Map(statements.map((s) => [s.id, s]));
  const entityOfLine = (l: TaxStatementLineRow): string => {
    const header = statementById.get(l.tax_statement_id);
    if (header?.entity_id) return header.entity_id;
    const parcel = l.parcel_id ? parcelById.get(l.parcel_id) : null;
    return parcel ? entityOfParcel(parcel) : NO_ENTITY;
  };
  const visibleParcels = entityFilter ? parcels.filter((p) => entityOfParcel(p) === entityFilter) : parcels;

  const paidByStatement = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of payments) map.set(p.tax_statement_id, (map.get(p.tax_statement_id) ?? 0) + p.amount);
    return map;
  }, [payments]);

  const yearLines = lines.filter((l) => l.tax_year === year);
  const linesByStatement = useMemo(() => {
    const m = new Map<string, TaxStatementLineRow[]>();
    for (const l of lines) m.set(l.tax_statement_id, [...(m.get(l.tax_statement_id) ?? []), l]);
    return m;
  }, [lines]);
  const allYearStatements = statements.filter((s) => s.tax_year === year);
  // A statement belongs to an entity view when any of its lines does.
  const yearStatements = entityFilter
    ? allYearStatements.filter((s) => (linesByStatement.get(s.id) ?? []).some((l) => entityOfLine(l) === entityFilter))
    : allYearStatements;
  const visibleLines = entityFilter ? yearLines.filter((l) => entityOfLine(l) === entityFilter) : yearLines;
  const coveredParcelIds = new Set(
    visibleLines.filter((l) => l.line_type === "real_property" && l.parcel_id).map((l) => l.parcel_id!)
  );
  const missingParcels = visibleParcels.filter((p) => !coveredParcelIds.has(p.id));
  // Unmatched = real-property lines with no parcel (personal property
  // never needs one).
  const unmatchedLines = visibleLines.filter((l) => l.line_type === "real_property" && !l.parcel_id);

  const totalDue = yearStatements.reduce((s, x) => s + x.amount_due, 0);
  const totalPaid = yearStatements.reduce((s, x) => s + (paidByStatement.get(x.id) ?? 0), 0);

  // Per-entity rollup: lines give coverage and due; payments spread by
  // each line's share of its statement's lines.
  const entityRollup = useMemo(() => {
    if (entities.length === 0 || entityFilter) return [];
    const keys = [...entities.map((e) => e.id), NO_ENTITY];
    return keys
      .map((key) => {
        const entityParcels = parcels.filter((p) => entityOfParcel(p) === key);
        const entityLines = yearLines.filter((l) => entityOfLine(l) === key);
        if (entityParcels.length === 0 && entityLines.length === 0) return null;
        let due = 0;
        let paid = 0;
        for (const l of entityLines) {
          due += l.tax_due;
          const siblings = linesByStatement.get(l.tax_statement_id) ?? [];
          const lineTotal = siblings.reduce((a, x) => a + x.tax_due, 0);
          const stmtPaid = paidByStatement.get(l.tax_statement_id) ?? 0;
          paid += lineTotal > 0 ? (stmtPaid * l.tax_due) / lineTotal : stmtPaid / Math.max(siblings.length, 1);
        }
        return {
          key,
          name: key === NO_ENTITY ? "No entity" : (entities.find((e) => e.id === key)?.name ?? "Entity"),
          parcels: entityParcels.length,
          covered: new Set(entityLines.filter((l) => l.line_type === "real_property" && l.parcel_id).map((l) => l.parcel_id)).size,
          due,
          paid,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entities, entityFilter, parcels, yearLines, paidByStatement, linesByStatement, statements]);

  const today = new Date();
  const statusOf = (s: TaxStatementRow) => taxStatus(s, paidByStatement.get(s.id) ?? 0, today);

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

  // Match a line by hand: links it and teaches the parcel every number
  // printed on the line (the self-learning loop).
  async function resolveLine(line: TaxStatementLineRow) {
    const parcelId = resolveParcelId[line.id];
    if (!parcelId) return;
    setError(null);
    const parcel = parcelById.get(parcelId);
    const stored = await loadStoredIdentifiers(supabase);
    const err = await confirmLineParcel(supabase, {
      orgId,
      lineId: line.id,
      parcelId,
      identifiers: (line.identifiers ?? []) as PrintedIdentifier[],
      source: "manual",
      evidence: parcel ? `Matched by hand to parcel ${parcel.parcel_number}` : "Matched by hand",
      stored,
    });
    if (err) {
      setError(
        err.includes("duplicate") || err.includes("23505")
          ? `That parcel already has a ${line.tax_year} statement line.`
          : "Could not match: " + err
      );
      return;
    }
    reload();
  }

  async function setStatementEntity(statement: TaxStatementRow, entityId: string) {
    setError(null);
    const { error: err } = await supabase
      .from("tax_statements")
      .update({ entity_id: entityId || null, entity_evidence: entityId ? "Set by hand" : null })
      .eq("id", statement.id);
    if (err) setError("Could not change the entity: " + err.message);
    setEditingEntity(null);
    reload();
  }

  // Deletes the statement, its lines and payments (cascade), and the
  // documents attached to it (rows and files). A shared multi-statement
  // source PDF stays in Documents.
  async function deleteStatement(statement: TaxStatementRow) {
    if (
      !window.confirm(
        "Delete this tax statement with its lines, recorded payments, and the files attached to it? This cannot be undone."
      )
    ) {
      return;
    }
    const { data: docs } = await supabase
      .from("documents")
      .select("id, storage_path")
      .eq("entity_type", "tax_statement")
      .eq("entity_id", statement.id);
    if (docs && docs.length > 0) {
      await supabase.storage.from("documents").remove(docs.map((d) => d.storage_path as string));
      await supabase.from("documents").delete().in("id", docs.map((d) => d.id as string));
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
    const remaining = Math.max(statement.amount_due - (paidByStatement.get(statement.id) ?? 0), 0);
    return (
      <form action={(fd) => recordPayment(statement, fd)} className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 p-2">
        <input name="paid_date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} className={inputClass} />
        <input name="amount" type="number" step="0.01" required defaultValue={remaining || ""} placeholder="Amount" className={`${inputClass} w-28`} />
        <input name="method" placeholder="Check # / method" className={`${inputClass} w-36`} />
        <input name="memo" placeholder="Memo" className={`${inputClass} min-w-20 flex-1`} />
        <button type="submit" className="rounded-lg bg-kelly-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-kelly-600">
          Save
        </button>
        <button type="button" onClick={() => setRecordingFor(null)} className="text-sm text-gray-500 hover:underline">
          Cancel
        </button>
      </form>
    );
  }

  function matchControl(line: TaxStatementLineRow) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <select
          value={resolveParcelId[line.id] ?? ""}
          onChange={(e) => setResolveParcelId((m) => ({ ...m, [line.id]: e.target.value }))}
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
          onClick={() => resolveLine(line)}
          disabled={!resolveParcelId[line.id]}
          className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Match
        </button>
      </span>
    );
  }

  function identifierChips(line: TaxStatementLineRow) {
    const ids = (line.identifiers ?? []) as PrintedIdentifier[];
    if (ids.length === 0) return <span className="text-xs text-gray-400">No numbers printed</span>;
    return (
      <span className="flex flex-wrap gap-1">
        {ids.map((i, idx) => (
          <span key={idx} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
            <span className="text-gray-500">{i.label ?? IDENTIFIER_KIND_LABELS[i.kind as IdentifierKind] ?? i.kind}:</span> {i.value}
          </span>
        ))}
      </span>
    );
  }

  function statementLabel(s: TaxStatementRow) {
    const kind = ACCOUNT_KIND_LABEL[s.account_kind ?? "other"] ?? "Number";
    return s.account_number ? `${kind} ${s.account_number}` : (s.taxpayer_name_printed ?? "Statement");
  }

  function linesTable(s: TaxStatementRow) {
    const sLines = (linesByStatement.get(s.id) ?? []).slice().sort((a, b) => a.line_no - b.line_no);
    if (sLines.length === 0) return <p className="text-xs text-gray-500">No lines on this statement.</p>;
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="px-2 py-1.5">Numbers printed</th>
              <th className="px-2 py-1.5 text-right">Appraised</th>
              <th className="px-2 py-1.5 text-right">Assessed</th>
              <th className="px-2 py-1.5 text-right">Tax</th>
              <th className="px-2 py-1.5">Parcel</th>
            </tr>
          </thead>
          <tbody>
            {sLines.map((l) => {
              const parcel = l.parcel_id ? parcelById.get(l.parcel_id) : null;
              return (
                <tr key={l.id} className="border-b border-gray-100 align-top last:border-0">
                  <td className="px-2 py-1.5">
                    {identifierChips(l)}
                    {l.exemptions ? <p className="mt-0.5 text-xs text-gray-500">Exemptions: {l.exemptions}</p> : null}
                    {l.property_address ? <p className="text-xs text-gray-500">{l.property_address}</p> : null}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{l.appraised_value !== null ? formatDollars(l.appraised_value) : ""}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{l.assessed_value !== null ? formatDollars(l.assessed_value) : ""}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatDollars(l.tax_due)}</td>
                  <td className="px-2 py-1.5">
                    {l.line_type === "personal_property" ? (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">Personal property</span>
                    ) : parcel ? (
                      <span>
                        <Link href={`/parcels/${parcel.id}`} className="font-medium text-kelly-700 hover:underline">
                          {parcel.parcel_number}
                        </Link>
                        <span className="text-gray-500"> · {propertyName.get(parcel.property_id) ?? ""}</span>
                        {l.match_evidence ? <p className="text-xs text-gray-500">{l.match_evidence}</p> : null}
                      </span>
                    ) : (
                      <span className="space-y-1">
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">Unmatched</span>
                        {matchControl(l)}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Property Taxes</h1>
          <p className="mt-0.5 text-sm text-gray-600">
            Every parcel should be on a statement each year; a missing one is how a parcel quietly goes delinquent.
          </p>
        </div>
        <span className="ml-auto flex items-center gap-2">
          {entities.length > 0 ? (
            <select value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)} className={inputClass}>
              <option value="">All entities</option>
              {entities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.name}
                </option>
              ))}
              <option value={NO_ENTITY}>No entity</option>
            </select>
          ) : null}
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={inputClass}>
            {years.map((y) => (
              <option key={y} value={y}>
                Tax year {y}
              </option>
            ))}
          </select>
          <Link href="/taxes/upload" className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600">
            + Upload statements
          </Link>
        </span>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { label: "Parcels", value: formatNumber(visibleParcels.length) },
          { label: "Parcels on a statement", value: `${formatNumber(coveredParcelIds.size)} of ${formatNumber(visibleParcels.length)}` },
          { label: "Total due", value: formatDollars(totalDue) },
          { label: "Total paid", value: formatDollars(totalPaid) },
          { label: "Outstanding", value: formatDollars(Math.max(totalDue - totalPaid, 0)) },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-gray-200 bg-white p-3">
            <p className="text-lg font-semibold tabular-nums text-gray-900">{s.value}</p>
            <p className="text-xs text-gray-500">{s.label}</p>
          </div>
        ))}
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {entityRollup.length > 0 ? (
        <section className="rounded-xl border border-gray-200 bg-white">
          <h2 className="border-b border-gray-200 px-4 py-3 text-base font-semibold text-gray-900">{year} by entity</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-2">Entity</th>
                  <th className="px-4 py-2 text-right">Parcels covered</th>
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
                        className={"font-medium hover:underline " + (r.key === NO_ENTITY ? "text-gray-500" : "text-gray-900")}
                      >
                        {r.name}
                      </button>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      <span className={r.covered < r.parcels ? "font-medium text-amber-700" : ""}>
                        {formatNumber(r.covered)} of {formatNumber(r.parcels)}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatDollars(r.due)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatDollars(r.paid)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      <span className={r.due - r.paid > 0.005 ? "font-medium text-red-700" : ""}>{formatDollars(Math.max(r.due - r.paid, 0))}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {missingParcels.length > 0 ? (
        <section className="rounded-xl border border-amber-200 bg-white">
          <h2 className="border-b border-amber-100 bg-amber-50 px-4 py-3 text-base font-semibold text-amber-900">
            Not on any {year} statement: {formatNumber(missingParcels.length)} parcel{missingParcels.length === 1 ? "" : "s"}
          </h2>
          <ul className="divide-y divide-gray-100">
            {missingParcels.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                <span className="font-medium text-gray-900">Parcel {p.parcel_number}</span>
                <span className="text-gray-500">
                  {propertyName.get(p.property_id) ?? ""}
                  {p.county ? ` · ${p.county}` : ""}
                </span>
                <Link href="/taxes/upload" className="ml-auto text-sm font-medium text-kelly-700 hover:underline">
                  Upload statement
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : visibleParcels.length > 0 ? (
        <p className="rounded-xl border border-kelly-100 bg-kelly-50 p-3 text-sm font-medium text-pine-900">Every parcel is on a {year} statement.</p>
      ) : null}

      {unmatchedLines.length > 0 ? (
        <section className="rounded-xl border border-gray-200 bg-white">
          <h2 className="border-b border-gray-200 px-4 py-3 text-base font-semibold text-gray-900">
            Unmatched lines ({unmatchedLines.length})
          </h2>
          <p className="px-4 pt-2 text-xs text-gray-500">
            Matching a line teaches the parcel every number printed on it, so next year's statement matches on its own.
          </p>
          <ul className="divide-y divide-gray-100">
            {unmatchedLines.map((l) => {
              const s = statementById.get(l.tax_statement_id);
              return (
                <li key={l.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
                  <span className="min-w-0 space-y-0.5">
                    {identifierChips(l)}
                    <span className="block text-xs text-gray-500">
                      {s ? [s.county, statementLabel(s), s.taxpayer_name_printed].filter(Boolean).join(" · ") : ""}
                      {" · "}
                      {formatDollars(l.tax_due)}
                    </span>
                  </span>
                  <span className="ml-auto">{matchControl(l)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {selected.size > 0 ? (
        <div className="sticky top-16 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-kelly-100 bg-kelly-50 p-3 shadow-md">
          <span className="text-sm font-medium text-pine-900">{selected.size} selected</span>
          <input type="date" value={batchDate} onChange={(e) => setBatchDate(e.target.value)} className={inputClass} />
          <input value={batchMethod} onChange={(e) => setBatchMethod(e.target.value)} placeholder="Check # / method" className={`${inputClass} w-40`} />
          <button onClick={recordBatch} className="rounded-lg bg-kelly-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-kelly-600">
            Record payment for selected
          </button>
          <button onClick={() => setSelected(new Set())} className="text-sm text-gray-600 hover:underline">
            Clear
          </button>
        </div>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-gray-900">Statements on file for {year}</h2>
        {yearStatements.length === 0 ? (
          <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">
            No statements yet for {year}.{" "}
            <Link href="/taxes/upload" className="font-medium text-kelly-700 hover:underline">
              Upload the first one
            </Link>
            .
          </p>
        ) : (
          <ul className="space-y-2">
            {yearStatements.map((s) => {
              const paid = paidByStatement.get(s.id) ?? 0;
              const status = statusOf(s);
              const sLines = linesByStatement.get(s.id) ?? [];
              const parcelCount = new Set(sLines.filter((l) => l.parcel_id).map((l) => l.parcel_id)).size;
              const unmatched = sLines.filter((l) => l.line_type === "real_property" && !l.parcel_id).length;
              const statementPayments = payments.filter((p) => p.tax_statement_id === s.id);
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
                    <span className="min-w-0">
                      <span className="font-medium text-gray-900">
                        {s.county ? `${s.county} · ` : ""}
                        {statementLabel(s)}
                      </span>
                      <span className="block text-xs text-gray-500">
                        {s.taxpayer_name_printed ?? ""}
                        {s.entity_id ? (
                          <span className="ml-1 rounded-full bg-kelly-50 px-2 py-0.5 font-medium text-pine-900" title={s.entity_evidence ?? ""}>
                            {entityName(s.entity_id)}
                          </span>
                        ) : null}
                        {` · ${sLines.length} line${sLines.length === 1 ? "" : "s"}`}
                        {parcelCount > 0 ? `, ${parcelCount} parcel${parcelCount === 1 ? "" : "s"}` : ""}
                        {unmatched > 0 ? <span className="ml-1 text-amber-800">{unmatched} unmatched</span> : null}
                        {s.due_date ? ` · due ${s.due_date}` : ""}
                      </span>
                    </span>
                    <span className="ml-auto flex flex-wrap items-center gap-2">
                      {!s.reconciled ? (
                        <span
                          className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900"
                          title="The lines do not add up to the statement total"
                        >
                          Lines {formatDollars(s.line_total ?? 0)} vs total {formatDollars(s.amount_due)}
                        </span>
                      ) : null}
                      <span className="text-sm font-medium tabular-nums text-gray-900">{formatDollars(s.amount_due)}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TAX_STATUS_CLASSES[status]}`}>
                        {TAX_STATUS_LABELS[status]}
                        {status === "partial" ? ` (${formatDollars(paid)})` : ""}
                      </span>
                      {status !== "paid" ? (
                        <button onClick={() => setRecordingFor(recordingFor === s.id ? null : s.id)} className="text-sm font-medium text-kelly-700 hover:underline">
                          Record payment
                        </button>
                      ) : null}
                      <button onClick={() => setExpanded(expanded === s.id ? null : s.id)} className="text-sm text-gray-500 hover:underline">
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
                          ["Taxpayer as printed", s.taxpayer_name_printed],
                          ["C/O", s.care_of_printed],
                          ["Delinquent date", s.delinquent_date],
                          ["Entity evidence", s.entity_evidence],
                          ["Notes", s.notes],
                        ]
                          .filter(([, v]) => v)
                          .map(([label, value]) => (
                            <div key={label as string}>
                              <dt className="text-xs text-gray-500">{label}</dt>
                              <dd className="text-gray-900">{value}</dd>
                            </div>
                          ))}
                        <div>
                          <dt className="text-xs text-gray-500">Entity</dt>
                          <dd className="text-gray-900">
                            {editingEntity === s.id ? (
                              <select
                                defaultValue={s.entity_id ?? ""}
                                onChange={(e) => setStatementEntity(s, e.target.value)}
                                className={inputClass}
                              >
                                <option value="">No entity</option>
                                {entities.map((e) => (
                                  <option key={e.id} value={e.id}>
                                    {e.name}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <>
                                {entityName(s.entity_id) ?? "None"}{" "}
                                <button onClick={() => setEditingEntity(s.id)} className="text-xs font-medium text-kelly-700 hover:underline">
                                  Change
                                </button>
                              </>
                            )}
                          </dd>
                        </div>
                      </dl>

                      <div>
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Lines</p>
                        {linesTable(s)}
                      </div>

                      {statementPayments.length > 0 ? (
                        <div>
                          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Payments</p>
                          <ul className="space-y-1">
                            {statementPayments.map((p) => (
                              <li key={p.id} className="flex items-center gap-2">
                                <span>{p.paid_date}</span>
                                <span className="font-medium">{formatDollars(p.amount)}</span>
                                <span className="text-gray-500">{[p.method, p.memo].filter(Boolean).join(" · ")}</span>
                                <button onClick={() => deleteTaxPayment(p.id)} className="ml-auto text-xs font-medium text-red-600 hover:underline">
                                  Delete
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      <div>
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Statement document</p>
                        {s.source_document_id ? (
                          <Link href={`/documents/${s.source_document_id}`} className="text-sm font-medium text-kelly-700 hover:underline">
                            Open the uploaded statement
                          </Link>
                        ) : null}
                        <EntityDocuments orgId={orgId} entityType="tax_statement" entityId={s.id} />
                      </div>
                      <button onClick={() => deleteStatement(s)} className="text-xs font-medium text-red-600 hover:underline">
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
