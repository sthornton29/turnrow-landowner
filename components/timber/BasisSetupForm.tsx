"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatDollars } from "@/lib/format";
import { TIMBER_PRODUCTS } from "@/lib/leaseLogic";
import {
  ACQUISITION_LABELS,
  ALL_TIMBER,
  BASIS_NOTE,
  BASIS_SOURCE_LABELS,
  allocateByValue,
  type AcquisitionType,
  type BasisSource,
} from "@/lib/timberBasis";
import type { TimberAccountProductRow, TimberAccountRow } from "@/types/db";

// TIMBER BASIS SETUP: the once-per-tract interview (migration 0046).
// How the land came to the owner, when, what it was worth, how much of
// that was timber, and (optionally) the timber by product with volumes
// from a cruise. Plain questions first; the tax terms ride along small.

interface ProductRow {
  product: string;
  unit: "ton" | "mbf";
  volume: string;
  basis: string;
}

const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm";
const labelCls = "mb-0.5 block text-xs font-medium text-gray-600";

const num = (s: string): number | null => {
  const t = s.replace(/[$,\s]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const str = (n: number | null | undefined) => (n == null ? "" : String(n));

const VALUE_LABEL: Record<AcquisitionType, string> = {
  purchase: "Price paid for the whole property, plus closing costs",
  inheritance: "Value of the whole property on the date of death",
  gift: "The giver's basis in the whole property",
  transfer: "The family's basis in the property when it went in",
  unknown: "Value or cost, if you have one",
};

export default function BasisSetupForm({
  orgId,
  property,
  entities,
  account,
  products,
  defaultAcres,
  onClose,
}: {
  orgId: string;
  property: { id: string; name: string; entity_id: string | null };
  entities: Array<{ id: string; name: string }>;
  account: TimberAccountRow | null;
  products: TimberAccountProductRow[];
  defaultAcres: number | null;
  onClose?: () => void;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [entityId, setEntityId] = useState(account?.entity_id ?? property.entity_id ?? "");
  const [acq, setAcq] = useState<AcquisitionType>((account?.acquisition_type as AcquisitionType) ?? "purchase");
  const [date, setDate] = useState(account?.acquired_date ?? "");
  const [total, setTotal] = useState(str(account?.total_value));
  const [land, setLand] = useState(str(account?.land_value));
  const [timber, setTimber] = useState(str(account?.timber_value));
  const [improvements, setImprovements] = useState(str(account?.improvements_value));
  const [source, setSource] = useState<BasisSource>((account?.basis_source as BasisSource) ?? "unknown");
  const [acres, setAcres] = useState(str(account?.acres_covered ?? (defaultAcres != null ? Math.round(defaultAcres * 10) / 10 : null)));
  const [notes, setNotes] = useState(account?.notes ?? "");
  const [rows, setRows] = useState<ProductRow[]>(
    products.length > 0
      ? products.map((p) => ({
          product: p.product,
          unit: p.unit,
          volume: str(p.opening_volume),
          basis: str(p.opening_basis),
        }))
      : [{ product: ALL_TIMBER, unit: "ton", volume: "", basis: "" }]
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [splitMsg, setSplitMsg] = useState<string | null>(null);

  const timberValue = num(timber);
  const productSum = rows.reduce((s, r) => s + (num(r.basis) ?? 0), 0);
  const singlePool = rows.length === 1;

  function splitByValues() {
    const t = num(total);
    const parts = { land: num(land) ?? 0, timber: num(timber) ?? 0, improvements: num(improvements) ?? 0 };
    if (t == null || parts.land + parts.timber + parts.improvements <= 0) {
      setSplitMsg("Enter the total and the appraised value of each part first.");
      return;
    }
    const a = allocateByValue(t, parts);
    setLand(String(a.land));
    setTimber(String(a.timber));
    setImprovements(String(a.improvements));
    setSplitMsg(
      `Split ${formatDollars(t)} in proportion to the appraised values: timber ${formatDollars(a.timber)}.`
    );
    if (singlePool) setRows([{ ...rows[0], basis: String(a.timber) }]);
  }

  async function save() {
    setError(null);
    const tv = timberValue;
    // A single all-timber row follows the timber value; a product split
    // is the truth and sets the timber value.
    const finalRows = singlePool && tv != null && num(rows[0].basis) == null
      ? [{ ...rows[0], basis: String(tv) }]
      : rows;
    const productRows = finalRows
      .map((r) => ({ product: r.product, unit: r.unit, opening_volume: num(r.volume), opening_basis: num(r.basis) ?? 0 }))
      .filter((r) => r.opening_basis > 0 || (r.opening_volume ?? 0) > 0);
    const seen = new Set<string>();
    for (const r of productRows) {
      if (seen.has(r.product)) {
        setError("Each product can appear only once.");
        return;
      }
      seen.add(r.product);
    }
    const sum = productRows.reduce((s, r) => s + r.opening_basis, 0);
    const record = {
      organization_id: orgId,
      property_id: property.id,
      entity_id: entityId || null,
      name: account?.name ?? `${property.name} timber`,
      acquisition_type: acq,
      acquired_date: date || null,
      total_value: num(total),
      land_value: num(land),
      timber_value: productRows.length > 0 ? Math.round(sum * 100) / 100 : tv,
      improvements_value: num(improvements),
      basis_source: source,
      acres_covered: num(acres),
      notes: notes.trim() || null,
    };
    setBusy(true);
    let id = account?.id ?? null;
    if (id) {
      const { error: err } = await supabase.from("timber_accounts").update(record).eq("id", id);
      if (err) return fail(err.message);
      const { error: delErr } = await supabase.from("timber_account_products").delete().eq("account_id", id);
      if (delErr) return fail(delErr.message);
    } else {
      const { data, error: err } = await supabase.from("timber_accounts").insert(record).select("id").single();
      if (err || !data) return fail(err?.message ?? "no row");
      id = data.id as string;
    }
    if (productRows.length > 0) {
      const { error: pErr } = await supabase
        .from("timber_account_products")
        .insert(productRows.map((r) => ({ ...r, organization_id: orgId, account_id: id })));
      if (pErr) return fail(pErr.message);
    }
    setBusy(false);
    if (onClose) onClose();
    router.push(`/timber/basis/${id}`);
    router.refresh();
  }

  function fail(msg: string) {
    setBusy(false);
    setError(`Could not save: ${msg}`);
  }

  const entityName = entities.find((e) => e.id === entityId)?.name ?? "the owner";

  return (
    <div className="space-y-4 rounded-xl border border-kelly-200 bg-kelly-50/40 p-4 text-sm">
      <div>
        <label className={labelCls}>Who owns the timber (the taxpayer)</label>
        <select value={entityId} onChange={(e) => setEntityId(e.target.value)} className={inputCls}>
          <option value="">No entity (held in our own names)</option>
          {entities.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <p className="mb-1 font-medium text-gray-900">How did {entityName} come to own {property.name}?</p>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(ACQUISITION_LABELS) as AcquisitionType[]).map((k) => (
            <button
              key={k}
              onClick={() => setAcq(k)}
              className={`rounded-full px-3 py-1 ${
                acq === k ? "bg-pine-800 text-white" : "border border-gray-300 bg-white text-gray-700"
              }`}
            >
              {ACQUISITION_LABELS[k].question}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-gray-600">{ACQUISITION_LABELS[acq].help}</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className={labelCls}>{acq === "inheritance" ? "Date of death" : "Date acquired"}</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>{VALUE_LABEL[acq]}</label>
          <input value={total} onChange={(e) => setTotal(e.target.value)} inputMode="decimal" placeholder="$" className={inputCls} />
        </div>
      </div>

      <div>
        <p className="mb-1 font-medium text-gray-900">How much of that was the timber?</p>
        <p className="mb-2 text-xs text-gray-600">
          Enter the split from the closing statement or appraisal. If you only have appraised values
          that do not add up to the price, enter them and use &quot;Split the price by these
          values&quot;.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className={labelCls}>Timber</label>
            <input value={timber} onChange={(e) => setTimber(e.target.value)} inputMode="decimal" placeholder="$" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Bare land</label>
            <input value={land} onChange={(e) => setLand(e.target.value)} inputMode="decimal" placeholder="$" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Buildings and improvements</label>
            <input value={improvements} onChange={(e) => setImprovements(e.target.value)} inputMode="decimal" placeholder="$" className={inputCls} />
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button onClick={splitByValues} className="text-xs font-semibold text-kelly-700 hover:underline">
            Split the price by these values
          </button>
          {splitMsg ? <span className="text-xs text-gray-600">{splitMsg}</span> : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label className={labelCls}>Where the timber number comes from</label>
          <select value={source} onChange={(e) => setSource(e.target.value as BasisSource)} className={inputCls}>
            {(Object.keys(BASIS_SOURCE_LABELS) as BasisSource[]).map((k) => (
              <option key={k} value={k}>
                {BASIS_SOURCE_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Acres of timber covered</label>
          <input value={acres} onChange={(e) => setAcres(e.target.value)} inputMode="decimal" className={inputCls} />
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-3">
        <div className="mb-1 flex items-center justify-between">
          <p className="font-medium text-gray-900">Timber by product (optional)</p>
          <button
            onClick={() =>
              setRows([
                ...rows.filter((r) => !(singlePool && r.product === ALL_TIMBER && !r.basis && !r.volume)),
                { product: "pine_pulpwood", unit: "ton", volume: "", basis: "" },
              ])
            }
            className="text-xs font-semibold text-kelly-700 hover:underline"
          >
            + Add a product
          </button>
        </div>
        <p className="mb-2 text-xs text-gray-600">
          If a cruise counted the timber (tons of pine sawtimber, pulpwood...), enter each product with
          its volume and its share of the timber value. That lets each sale recover the right amount per
          ton. Without volumes, one &quot;All timber&quot; line works: at a sale you will say about how
          much was cut.
        </p>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <select
                value={r.product}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, product: e.target.value } : x)))}
                className={`${inputCls} sm:col-span-2`}
              >
                <option value={ALL_TIMBER}>All timber</option>
                {TIMBER_PRODUCTS.map((p) => (
                  <option key={p.product} value={p.product}>
                    {p.label}
                  </option>
                ))}
              </select>
              <input
                value={r.volume}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, volume: e.target.value } : x)))}
                placeholder="Volume (optional)"
                inputMode="decimal"
                className={inputCls}
              />
              <select
                value={r.unit}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, unit: e.target.value as "ton" | "mbf" } : x)))}
                className={inputCls}
              >
                <option value="ton">tons</option>
                <option value="mbf">MBF</option>
              </select>
              <div className="flex gap-2">
                <input
                  value={r.basis}
                  onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, basis: e.target.value } : x)))}
                  placeholder={singlePool && timberValue != null ? String(timberValue) : "Basis $"}
                  inputMode="decimal"
                  className={inputCls}
                />
                {rows.length > 1 ? (
                  <button
                    onClick={() => setRows(rows.filter((_, j) => j !== i))}
                    className="text-xs text-red-600 hover:underline"
                    aria-label="Remove product"
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        {!singlePool && timberValue != null && Math.abs(productSum - timberValue) > 0.5 ? (
          <p className="mt-2 text-xs text-amber-800">
            The products add to {formatDollars(productSum)}, but the timber value above is{" "}
            {formatDollars(timberValue)}. On save, the products&apos; total becomes the timber basis.
          </p>
        ) : null}
      </div>

      <div>
        <label className={labelCls}>Notes</label>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
      </div>

      <p className="text-xs text-gray-500">{BASIS_NOTE}</p>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="flex justify-end gap-2">
        {onClose ? (
          <button onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 font-semibold text-gray-700 hover:bg-gray-50">
            Cancel
          </button>
        ) : null}
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
