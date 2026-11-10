"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatDollars, formatNumber } from "@/lib/format";
import { TIMBER_PRODUCTS } from "@/lib/leaseLogic";
import {
  ALL_TIMBER,
  BASIS_NOTE,
  ENTRY_TYPE_LABELS,
  accountBalance,
  productLabel,
  proposeDepletion,
  proposeDepletionByShare,
  taxableGain,
  type DepletionProposal,
  type EntryType,
  type SoldQuantity,
} from "@/lib/timberBasis";
import type { TimberAccountEntryRow, TimberAccountProductRow } from "@/types/db";

// The timber account's money: basis left per product, each sale on this
// tract with its proposed depletion (confirm with "Use this"), and the
// ledger of every change. Suggest, then confirm: nothing posts without
// a click.

export interface SaleForBasis {
  id: string;
  name: string;
  saleType: string;
  status: string;
  share: number; // this tract's share of the sale
  proceeds: number; // this tract's share of dollars received
  sellingExpenses: number;
  sold: SoldQuantity[]; // this tract's share of quantities cut
  lastDate: string | null;
}

const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm";
const unitText = (u: string) => (u === "mbf" ? "MBF" : "ton");

// Today in the viewer's time zone (toISOString is UTC, a day ahead in
// a US evening).
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function BasisLedger({
  orgId,
  accountId,
  products,
  entries,
  sales,
}: {
  orgId: string;
  accountId: string;
  products: TimberAccountProductRow[];
  entries: TimberAccountEntryRow[];
  sales: SaleForBasis[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sharePct, setSharePct] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);

  const balance = useMemo(
    () =>
      accountBalance(
        products.map((p) => ({ ...p, opening_basis: Number(p.opening_basis) })),
        entries.map((e) => ({ ...e, volume_change: Number(e.volume_change), basis_change: Number(e.basis_change) }))
      ),
    [products, entries]
  );

  // Balance BEFORE a sale's own depletion, so its proposal stays stable
  // after other sales are recorded in any order.
  function balanceWithout(saleId: string) {
    return accountBalance(
      products.map((p) => ({ ...p, opening_basis: Number(p.opening_basis) })),
      entries
        .filter((e) => e.timber_sale_id !== saleId)
        .map((e) => ({ ...e, volume_change: Number(e.volume_change), basis_change: Number(e.basis_change) }))
    );
  }

  async function postProposal(sale: SaleForBasis, prop: DepletionProposal, how: string) {
    setError(null);
    setBusy(true);
    const date = sale.lastDate ?? localToday();
    const rows = prop.lines.map((l) => ({
      organization_id: orgId,
      account_id: accountId,
      entry_date: date,
      entry_type: "depletion",
      product: l.product,
      volume_change: l.volumeChange,
      basis_change: l.basisChange,
      timber_sale_id: sale.id,
      memo:
        l.product === l.soldProduct
          ? `${sale.name}: ${how}`
          : `${sale.name}: ${productLabel(l.soldProduct)} against ${productLabel(l.product)} (${how})`,
    }));
    const { error: err } = await supabase.from("timber_account_entries").insert(rows);
    setBusy(false);
    if (err) setError(`Could not save: ${err.message}`);
    else router.refresh();
  }

  async function removeSaleDepletion(saleId: string) {
    setError(null);
    const { error: err } = await supabase
      .from("timber_account_entries")
      .delete()
      .eq("account_id", accountId)
      .eq("timber_sale_id", saleId)
      .eq("entry_type", "depletion");
    if (err) setError(`Could not remove: ${err.message}`);
    else router.refresh();
  }

  async function removeEntry(id: string) {
    setError(null);
    const { error: err } = await supabase.from("timber_account_entries").delete().eq("id", id);
    if (err) setError(`Could not remove: ${err.message}`);
    else router.refresh();
  }

  return (
    <div className="space-y-5">
      {/* Balance */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-gray-900">
            Basis left: <span className="text-pine-900">{formatDollars(balance.basis)}</span>
          </h2>
          <p className="text-sm text-gray-500">
            Opening {formatDollars(balance.openingBasis)}
            {balance.depleted > 0 ? ` · recovered through sales ${formatDollars(balance.depleted)}` : ""}
          </p>
        </div>
        {balance.products.length > 0 ? (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="py-1">Product</th>
                <th className="py-1 text-right">Volume on hand</th>
                <th className="py-1 text-right">Basis</th>
                <th className="py-1 text-right">Per unit</th>
              </tr>
            </thead>
            <tbody>
              {balance.products.map((p) => (
                <tr key={p.product} className="border-t border-gray-100">
                  <td className="py-1.5 text-gray-900">{productLabel(p.product)}</td>
                  <td className="py-1.5 text-right text-gray-700">
                    {p.volume != null ? `${formatNumber(Math.round(p.volume))} ${unitText(p.unit)}s` : "not measured"}
                  </td>
                  <td className="py-1.5 text-right text-gray-700">{formatDollars(p.basis)}</td>
                  <td className="py-1.5 text-right text-gray-700">
                    {p.unitBasis != null ? `${formatDollars(p.unitBasis)} per ${unitText(p.unit)}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-2 text-sm text-gray-500">No timber value entered yet. Use Edit setup above.</p>
        )}
        <p className="mt-2 text-xs text-gray-500">{BASIS_NOTE}</p>
      </section>

      {/* Sales */}
      <section>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">Timber sales on this tract</h2>
        {sales.length === 0 ? (
          <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">
            No sales on this property&apos;s stands yet. When one is recorded under{" "}
            <Link href="/timber-sales" className="font-medium text-kelly-700 hover:underline">
              Timber sales
            </Link>
            , its depletion is worked out here.
          </p>
        ) : (
          <ul className="space-y-3">
            {sales.map((sale) => {
              const recorded = entries.filter((e) => e.timber_sale_id === sale.id && e.entry_type === "depletion");
              const recordedTotal = recorded.reduce((s, e) => s - Number(e.basis_change), 0);
              const before = balanceWithout(sale.id);
              const byQty = proposeDepletion(before, sale.sold);
              const pct = Number(sharePct[sale.id] ?? "");
              const byShare =
                Number.isFinite(pct) && pct > 0 ? proposeDepletionByShare(before, pct / 100) : null;
              const useQty = byQty.lines.length > 0 && byQty.unmatched.length === 0;
              const depletionForGain = recorded.length > 0 ? recordedTotal : useQty ? byQty.total : byShare?.total ?? 0;
              return (
                <li key={sale.id} className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <Link href={`/timber-sales/${sale.id}`} className="font-semibold text-gray-900 hover:underline">
                      {sale.name}
                    </Link>
                    <span className="text-gray-500">
                      {sale.saleType === "lump_sum" ? "Lump sum" : "Pay as cut"}
                      {sale.share < 1 ? ` · this tract's share ${Math.round(sale.share * 1000) / 10}%` : ""}
                    </span>
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
                    <div>
                      <dt className="text-xs text-gray-500">Received</dt>
                      <dd className="font-medium">{formatDollars(sale.proceeds)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-gray-500">Selling costs</dt>
                      <dd className="font-medium">{formatDollars(sale.sellingExpenses)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-gray-500">Depletion</dt>
                      <dd className="font-medium">
                        {formatDollars(depletionForGain)}
                        {recorded.length === 0 ? <span className="text-xs font-normal text-gray-500"> proposed</span> : null}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-gray-500">Taxable gain (about)</dt>
                      <dd className="font-semibold text-pine-900">
                        {formatDollars(taxableGain(sale.proceeds, sale.sellingExpenses, depletionForGain))}
                      </dd>
                    </div>
                  </dl>

                  {recorded.length > 0 ? (
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <span className="rounded-full bg-kelly-100 px-2 py-0.5 text-xs font-medium text-pine-900">
                        Depletion recorded: {formatDollars(recordedTotal)}
                      </span>
                      <button
                        onClick={() => removeSaleDepletion(sale.id)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Remove and redo
                      </button>
                    </div>
                  ) : (
                    <div className="mt-3 space-y-2 rounded-lg bg-gray-50 p-3">
                      {sale.sold.length > 0 ? (
                        <>
                          <p className="text-xs text-gray-600">
                            From the settlements: cut{" "}
                            {sale.sold
                              .map((q) => `${formatNumber(Math.round(q.quantity))} ${unitText(q.unit)}s ${productLabel(q.product).toLowerCase()}`)
                              .join(", ")}
                            .
                          </p>
                          {byQty.lines.length > 0 ? (
                            <ul className="text-xs text-gray-700">
                              {byQty.lines.map((l, i) => (
                                <li key={i}>
                                  {formatNumber(Math.round(-l.volumeChange))} {unitText(l.unit)}s x{" "}
                                  {formatDollars(l.unitBasis)} ({productLabel(l.product)}) ={" "}
                                  {formatDollars(-l.basisChange)}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                          {byQty.unmatched.length > 0 ? (
                            <p className="text-xs text-amber-800">
                              No volume on record to price{" "}
                              {byQty.unmatched.map((u) => productLabel(u.product).toLowerCase()).join(", ")} per{" "}
                              {unitText(byQty.unmatched[0].unit)}. Use the share below, or add volumes in Edit
                              setup.
                            </p>
                          ) : null}
                          {byQty.note ? <p className="text-xs text-amber-800">{byQty.note}</p> : null}
                          {useQty ? (
                            <button
                              disabled={busy}
                              onClick={() => postProposal(sale, byQty, "by quantity cut")}
                              className="rounded-lg bg-kelly-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-kelly-600 disabled:opacity-50"
                            >
                              Use this: record {formatDollars(byQty.total)} depletion
                            </button>
                          ) : null}
                        </>
                      ) : null}
                      {!useQty ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="text-xs text-gray-700">
                            About how much of this tract&apos;s timber was sold?
                          </label>
                          <input
                            value={sharePct[sale.id] ?? ""}
                            onChange={(e) => setSharePct({ ...sharePct, [sale.id]: e.target.value })}
                            placeholder="%"
                            inputMode="decimal"
                            className="w-20 rounded-lg border border-gray-300 px-2 py-1 text-xs"
                          />
                          <span className="text-xs text-gray-500">percent</span>
                          {byShare ? (
                            <button
                              disabled={busy}
                              onClick={() => postProposal(sale, byShare, `about ${pct}% of the timber`)}
                              className="rounded-lg bg-kelly-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-kelly-600 disabled:opacity-50"
                            >
                              Use this: record {formatDollars(byShare.total)} depletion
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                      {!useQty ? (
                        <p className="text-xs text-gray-500">
                          A clearcut of the whole tract is 100%. For a thinning, your forester&apos;s cruise
                          usually says what share of the volume came out.
                        </p>
                      ) : null}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Ledger */}
      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-gray-900">Ledger</h2>
          {!adding ? (
            <button onClick={() => setAdding(true)} className="text-sm font-medium text-kelly-700 hover:underline">
              + Add an adjustment
            </button>
          ) : null}
        </div>
        {adding ? (
          <ManualEntry
            orgId={orgId}
            accountId={accountId}
            productOptions={balance.products.map((p) => p.product)}
            onDone={() => {
              setAdding(false);
              router.refresh();
            }}
            onCancel={() => setAdding(false)}
          />
        ) : null}
        {entries.length === 0 ? (
          <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">
            Nothing yet beyond the opening basis.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {[...entries]
              .sort((a, b) => b.entry_date.localeCompare(a.entry_date))
              .map((e) => (
                <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
                  <span className="w-24 font-mono text-xs text-gray-500">{e.entry_date}</span>
                  <span className="text-gray-900">{ENTRY_TYPE_LABELS[e.entry_type as EntryType] ?? e.entry_type}</span>
                  <span className="text-gray-500">{e.product ? productLabel(e.product) : "All products"}</span>
                  {Number(e.volume_change) !== 0 ? (
                    <span className="text-gray-600">
                      {Number(e.volume_change) > 0 ? "+" : ""}
                      {formatNumber(Math.round(Number(e.volume_change)))} units
                    </span>
                  ) : null}
                  <span className={`ml-auto font-medium ${Number(e.basis_change) < 0 ? "text-gray-900" : "text-pine-900"}`}>
                    {Number(e.basis_change) >= 0 ? "+" : "-"}
                    {formatDollars(Math.abs(Number(e.basis_change)))}
                  </span>
                  <button onClick={() => removeEntry(e.id)} className="text-xs text-red-600 hover:underline">
                    Remove
                  </button>
                  {e.memo ? <span className="w-full text-xs text-gray-500">{e.memo}</span> : null}
                </li>
              ))}
          </ul>
        )}
      </section>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}

function ManualEntry({
  orgId,
  accountId,
  productOptions,
  onDone,
  onCancel,
}: {
  orgId: string;
  accountId: string;
  productOptions: string[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const supabase = createClient();
  const [type, setType] = useState<EntryType>("capitalized_cost");
  const [date, setDate] = useState(localToday());
  const [product, setProduct] = useState("");
  const [volume, setVolume] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Signs follow the entry type so nobody types a minus: costs add,
  // losses and depletion subtract; adjustments take the sign given.
  async function save() {
    const amt = Number(amount.replace(/[$,]/g, "") || "0");
    const vol = Number(volume.replace(/,/g, "") || "0");
    if (!Number.isFinite(amt) || !Number.isFinite(vol)) {
      setError("Enter numbers.");
      return;
    }
    const subtract = type === "casualty_loss" || type === "depletion";
    const { error: err } = await supabase.from("timber_account_entries").insert({
      organization_id: orgId,
      account_id: accountId,
      entry_date: date,
      entry_type: type,
      product: product || null,
      volume_change: subtract ? -Math.abs(vol) : vol,
      basis_change: subtract ? -Math.abs(amt) : type === "capitalized_cost" ? Math.abs(amt) : amt,
      memo: memo.trim() || null,
    });
    if (err) setError(`Could not save: ${err.message}`);
    else onDone();
  }

  const products = Array.from(new Set([...productOptions, ...TIMBER_PRODUCTS.map((p) => p.product)]));

  return (
    <div className="mb-3 space-y-2 rounded-xl border border-kelly-200 bg-kelly-50/40 p-3 text-sm">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <select value={type} onChange={(e) => setType(e.target.value as EntryType)} className={inputCls}>
          {(Object.keys(ENTRY_TYPE_LABELS) as EntryType[]).map((k) => (
            <option key={k} value={k}>
              {ENTRY_TYPE_LABELS[k]}
            </option>
          ))}
        </select>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
        <select value={product} onChange={(e) => setProduct(e.target.value)} className={inputCls}>
          <option value="">All products</option>
          {products.map((p) => (
            <option key={p} value={p}>
              {productLabel(p === ALL_TIMBER ? ALL_TIMBER : p)}
            </option>
          ))}
        </select>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Dollars" inputMode="decimal" className={inputCls} />
        <input value={volume} onChange={(e) => setVolume(e.target.value)} placeholder="Volume change (optional)" inputMode="decimal" className={inputCls} />
        <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="What and why" className={inputCls} />
      </div>
      <p className="text-xs text-gray-500">
        Costs added to basis add dollars; casualty losses subtract. A volume adjustment (a new cruise,
        growth since purchase) usually changes volume only; use a minus sign to lower it.
      </p>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700">
          Cancel
        </button>
        <button onClick={save} className="rounded-lg bg-kelly-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-kelly-600">
          Save
        </button>
      </div>
    </div>
  );
}
