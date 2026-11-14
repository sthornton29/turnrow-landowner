"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyDbError } from "@/lib/dbErrors";
import { formatDate, formatDollars, todayISO } from "@/lib/format";
import { TIMBER_PRODUCTS } from "@/lib/leaseLogic";
import {
  ALL_TIMBER,
  BASIS_NOTE,
  ENTRY_TYPE_LABELS,
  accountBalance,
  depletionOverBasis,
  depletionPlanForSale,
  productLabel,
  proposeDepletionByShare,
  taxableGain,
  type AccountBalance,
  type DepletionPeriod,
  type DepletionProposal,
  type EntryType,
  type SaleCut,
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
  cuts: SaleCut[]; // each settlement's date and this tract's share of the quantities cut
  lastDate: string | null;
}

const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm";
const unitText = (u: string) => (u === "mbf" ? "MBF" : "ton");

// "1,000 tons", "1 ton", "12.4 MBF": one decimal unless the number is
// whole, and the unit's own name (MBF does not take an s).
function volumeText(quantity: number, unit: string | null): string {
  const q = Math.round(quantity * 10) / 10;
  const whole = Number.isInteger(q);
  const n = q.toLocaleString("en-US", {
    minimumFractionDigits: whole ? 0 : 1,
    maximumFractionDigits: whole ? 0 : 1,
  });
  if (unit === "mbf") return `${n} MBF`;
  if (unit === "ton") return `${n} ${Math.abs(q) === 1 ? "ton" : "tons"}`;
  return `${n} (volume)`;
}

// A period whose every sold product could be priced per unit.
const priced = (p: DepletionPeriod) => p.proposal.lines.length > 0 && p.proposal.unmatched.length === 0;

const overBasisText = (over: { product: string | null; asked: number; left: number }) =>
  `Nothing was recorded. This would take ${formatDollars(over.asked)} of depletion from ${
    over.product ? productLabel(over.product) : "the account"
  }, which has only ${formatDollars(over.left)} of basis left. Depletion can never be more than the basis left.`;

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
  // Where the message belongs: a sale's card (its id) or the ledger.
  const [error, setError] = useState<{ at: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // Buttons stay off until the refreshed ledger has arrived, so a second
  // tap cannot record the same depletion twice.
  const [refreshing, startRefresh] = useTransition();
  const locked = busy || refreshing;
  const [sharePct, setSharePct] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);

  const acctProducts = useMemo(
    () => products.map((p) => ({ ...p, opening_basis: Number(p.opening_basis) })),
    [products]
  );
  const acctEntries = useMemo(
    () => entries.map((e) => ({ ...e, volume_change: Number(e.volume_change), basis_change: Number(e.basis_change) })),
    [entries]
  );
  const balance = useMemo(() => accountBalance(acctProducts, acctEntries), [acctProducts, acctEntries]);

  // The unit a ledger line's volume is in: its product's, or the one unit
  // every product shares for a whole-account line.
  function unitFor(product: string | null): string | null {
    if (product) return balance.products.find((p) => p.product === product)?.unit ?? null;
    const units = new Set(balance.products.map((p) => p.unit));
    return units.size === 1 ? Array.from(units)[0] : null;
  }

  // One set of entries per part, each dated in its own tax year.
  async function postDepletion(
    sale: SaleForBasis,
    parts: Array<{ date: string; proposal: DepletionProposal; memo: string }>
  ) {
    if (locked) return;
    setError(null);
    const rows = parts.flatMap(({ date, proposal, memo }) =>
      proposal.lines.map((l) => ({
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
            ? `${sale.name}: ${memo}`
            : `${sale.name}: ${productLabel(l.soldProduct)} against ${productLabel(l.product)} (${memo})`,
      }))
    );
    if (rows.length === 0) return;
    const over = depletionOverBasis(balance, rows);
    if (over) {
      setError({ at: sale.id, text: overBasisText(over) });
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.from("timber_account_entries").insert(rows);
    setBusy(false);
    if (err) {
      setError({ at: sale.id, text: friendlyDbError(err, "Could not record the depletion. Please try again.") });
      return;
    }
    startRefresh(() => router.refresh());
  }

  async function removeSaleDepletion(sale: SaleForBasis, recordedTotal: number) {
    if (locked) return;
    if (
      !window.confirm(
        `Remove the depletion recorded for ${sale.name} (${formatDollars(recordedTotal)})? The basis left goes back up by that amount, and the tax summary shows no depletion for this sale until you record it again.`
      )
    )
      return;
    setError(null);
    setBusy(true);
    const { error: err } = await supabase
      .from("timber_account_entries")
      .delete()
      .eq("account_id", accountId)
      .eq("timber_sale_id", sale.id)
      .eq("entry_type", "depletion");
    setBusy(false);
    if (err) {
      setError({ at: sale.id, text: friendlyDbError(err, "Could not remove the depletion. Please try again.") });
      return;
    }
    startRefresh(() => router.refresh());
  }

  async function removeEntry(e: TimberAccountEntryRow) {
    if (locked) return;
    if (
      !window.confirm(
        `Remove this ledger entry: ${ENTRY_TYPE_LABELS[e.entry_type as EntryType] ?? e.entry_type}, ${formatDate(e.entry_date)}, ${formatDollars(Math.abs(Number(e.basis_change)))}? The basis left changes by that amount.`
      )
    )
      return;
    setError(null);
    setBusy(true);
    const { error: err } = await supabase.from("timber_account_entries").delete().eq("id", e.id);
    setBusy(false);
    if (err) {
      setError({ at: "ledger", text: friendlyDbError(err, "Could not remove the entry. Please try again.") });
      return;
    }
    startRefresh(() => router.refresh());
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
                    {p.volume != null ? volumeText(p.volume, p.unit) : "not measured"}
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
              // Depletion goes in the tax year of each settlement, so the
              // sale is worked one year at a time; settlements already
              // covered by recorded depletion are not proposed again.
              const plan = depletionPlanForSale(acctProducts, acctEntries, sale.id, sale.cuts);
              const periods = plan.periods;
              const allByQty = periods.length > 0 && periods.every(priced);
              const next = periods[0] ?? null; // the earliest year still to record
              // By share: a year whose quantities cannot be priced per
              // unit, or a sale with no settlements to go on (lump sum).
              const needsShare = next ? !priced(next) : recorded.length === 0;
              const pct = Number(sharePct[sale.id] ?? "");
              const byShare =
                needsShare && Number.isFinite(pct) && pct > 0 ? proposeDepletionByShare(balance, pct / 100) : null;
              const proposed = needsShare
                ? byShare?.total ?? 0
                : periods.reduce((s, p) => s + p.proposal.total, 0);
              const depletionForGain = recordedTotal + proposed;
              const toPost = allByQty ? periods : next && priced(next) ? [next] : [];
              const postTotal = toPost.reduce((s, p) => s + p.proposal.total, 0);
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
                        {recorded.length === 0 ? (
                          <span className="text-xs font-normal text-gray-500"> proposed</span>
                        ) : proposed > 0 ? (
                          <span className="text-xs font-normal text-gray-500">
                            {" "}
                            with {formatDollars(proposed)} proposed
                          </span>
                        ) : null}
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
                        disabled={locked}
                        onClick={() => removeSaleDepletion(sale, recordedTotal)}
                        className="text-xs text-red-600 hover:underline disabled:opacity-50"
                      >
                        Remove and redo
                      </button>
                    </div>
                  ) : null}
                  {plan.yearsWithoutDepletion.length > 0 ? (
                    <p className="mt-2 text-xs text-amber-800">
                      This sale also has settlements in {plan.yearsWithoutDepletion.join(" and ")}, but no depletion is
                      dated in {plan.yearsWithoutDepletion.length === 1 ? "that year" : "those years"}. Depletion
                      usually belongs in the year of each settlement. Use Remove and redo to split it by year.
                    </p>
                  ) : null}

                  {plan.enteredLater.length > 0 ? (
                    <p className="mt-2 text-xs text-amber-800">
                      {plan.enteredLater.length === 1 ? "A settlement" : "Settlements"} dated{" "}
                      {plan.enteredLater.map((d) => formatDate(d)).join(", ")}{" "}
                      {plan.enteredLater.length === 1 ? "was" : "were"} entered after this depletion was recorded,
                      so the depletion was worked out without {plan.enteredLater.length === 1 ? "it" : "them"}. Use
                      Remove and redo to bring {plan.enteredLater.length === 1 ? "it" : "them"} in.
                    </p>
                  ) : null}

                  {periods.length > 0 || recorded.length === 0 ? (
                    <div className="mt-3 space-y-2 rounded-lg bg-gray-50 p-3">
                      {plan.recordedThrough && periods.length > 0 ? (
                        <p className="text-xs text-gray-600">
                          Depletion is recorded for settlements through {formatDate(plan.recordedThrough)}. Cut since
                          then:
                        </p>
                      ) : null}
                      {(allByQty ? periods : next ? [next] : []).map((p) => (
                        <div key={p.year} className="space-y-1">
                          {p.sold.length > 0 ? (
                            <p className="text-xs text-gray-600">
                              {p.year} settlements (through {formatDate(p.date)}): cut{" "}
                              {p.sold
                                .map((q) => `${volumeText(q.quantity, q.unit)} ${productLabel(q.product).toLowerCase()}`)
                                .join(", ")}
                              .
                            </p>
                          ) : (
                            <p className="text-xs text-gray-600">
                              {p.year} settlements (through {formatDate(p.date)}): no quantities on record.
                            </p>
                          )}
                          {p.proposal.lines.length > 0 ? (
                            <ul className="text-xs text-gray-700">
                              {p.proposal.lines.map((l, i) => (
                                <li key={i}>
                                  {volumeText(-l.volumeChange, l.unit)} x {formatDollars(l.unitBasis)} (
                                  {productLabel(l.product)}) = {formatDollars(-l.basisChange)}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                          {p.proposal.unmatched.length > 0 ? (
                            <p className="text-xs text-amber-800">
                              No volume on record to price{" "}
                              {p.proposal.unmatched.map((u) => productLabel(u.product).toLowerCase()).join(", ")} per{" "}
                              {unitText(p.proposal.unmatched[0].unit)}. Use the share below, or add volumes in Edit
                              setup.
                            </p>
                          ) : null}
                          {p.proposal.note ? <p className="text-xs text-amber-800">{p.proposal.note}</p> : null}
                        </div>
                      ))}
                      {toPost.length > 0 ? (
                        <>
                          <p className="text-xs text-gray-500">
                            This uses the timber volume on record today. If a newer cruise changed the volume, add it as
                            a volume adjustment in the ledger below first.
                          </p>
                          <button
                            disabled={locked}
                            onClick={() =>
                              postDepletion(
                                sale,
                                toPost.map((p) => ({
                                  date: p.date,
                                  proposal: p.proposal,
                                  memo: `${p.year} settlements, by quantity cut`,
                                }))
                              )
                            }
                            className="rounded-lg bg-kelly-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-kelly-600 disabled:opacity-50"
                          >
                            Use this: record {formatDollars(postTotal)} depletion
                            {toPost.length > 1
                              ? ` (${toPost.map((p) => `${formatDollars(p.proposal.total)} in ${p.year}`).join(", ")})`
                              : ` for ${toPost[0].year}`}
                          </button>
                        </>
                      ) : null}
                      {needsShare ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="text-xs text-gray-700">
                            {next
                              ? `About how much of the timber standing on this tract was cut in ${next.year}?`
                              : "About how much of this tract's timber was sold?"}
                          </label>
                          <input
                            value={sharePct[sale.id] ?? ""}
                            onChange={(e) => setSharePct({ ...sharePct, [sale.id]: e.target.value })}
                            placeholder="%"
                            inputMode="decimal"
                            className="w-20 rounded-lg border border-gray-300 px-2 py-1 text-xs"
                          />
                          <span className="text-xs text-gray-500">percent</span>
                          {byShare && byShare.lines.length > 0 ? (
                            <button
                              disabled={locked}
                              onClick={() =>
                                postDepletion(sale, [
                                  {
                                    date: next ? next.date : sale.lastDate ?? todayISO(),
                                    proposal: byShare,
                                    memo: next
                                      ? `${next.year} settlements, about ${pct}% of the timber`
                                      : `about ${pct}% of the timber`,
                                  },
                                ])
                              }
                              className="rounded-lg bg-kelly-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-kelly-600 disabled:opacity-50"
                            >
                              Use this: record {formatDollars(byShare.total)} depletion
                              {next ? ` for ${next.year}` : ""}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                      {needsShare ? (
                        <p className="text-xs text-gray-500">
                          A clearcut of the whole tract is 100%. For a thinning, your forester&apos;s cruise
                          usually says what share of the volume came out.
                        </p>
                      ) : null}
                      {!allByQty && periods.length > 1 ? (
                        <p className="text-xs text-gray-500">
                          This sale also has settlements in {periods.slice(1).map((p) => p.year).join(" and ")}. Each
                          tax year is recorded on its own: record {periods[0].year} first.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {error?.at === sale.id ? <p className="mt-2 text-sm text-red-600">{error.text}</p> : null}
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
            balance={balance}
            productOptions={balance.products.map((p) => p.product)}
            onDone={() => {
              setAdding(false);
              startRefresh(() => router.refresh());
            }}
            onCancel={() => setAdding(false)}
          />
        ) : null}
        {error?.at === "ledger" ? <p className="mb-2 text-sm text-red-600">{error.text}</p> : null}
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
                      {volumeText(Number(e.volume_change), unitFor(e.product))}
                    </span>
                  ) : null}
                  <span className={`ml-auto font-medium ${Number(e.basis_change) < 0 ? "text-gray-900" : "text-pine-900"}`}>
                    {Number(e.basis_change) >= 0 ? "+" : "-"}
                    {formatDollars(Math.abs(Number(e.basis_change)))}
                  </span>
                  <button
                    disabled={locked}
                    onClick={() => removeEntry(e)}
                    className="text-xs text-red-600 hover:underline disabled:opacity-50"
                  >
                    Remove
                  </button>
                  {e.memo ? <span className="w-full text-xs text-gray-500">{e.memo}</span> : null}
                </li>
              ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ManualEntry({
  orgId,
  accountId,
  balance,
  productOptions,
  onDone,
  onCancel,
}: {
  orgId: string;
  accountId: string;
  balance: AccountBalance;
  productOptions: string[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const supabase = createClient();
  const [type, setType] = useState<EntryType>("capitalized_cost");
  const [date, setDate] = useState(todayISO());
  const [product, setProduct] = useState("");
  const [volume, setVolume] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Signs follow the entry type so nobody types a minus: costs add,
  // losses and depletion subtract; adjustments take the sign given.
  async function save() {
    if (busy) return;
    const amt = Number(amount.replace(/[$,]/g, "") || "0");
    const vol = Number(volume.replace(/,/g, "") || "0");
    if (!Number.isFinite(amt) || !Number.isFinite(vol)) {
      setError("Enter numbers.");
      return;
    }
    if (!date) {
      setError("Enter the date. It decides which tax year the entry counts in.");
      return;
    }
    const subtract = type === "casualty_loss" || type === "depletion";
    const basisChange = subtract ? -Math.abs(amt) : type === "capitalized_cost" ? Math.abs(amt) : amt;
    if (type === "depletion") {
      const over = depletionOverBasis(balance, [{ product: product || null, basis_change: basisChange }]);
      if (over) {
        setError(overBasisText(over));
        return;
      }
    }
    setError(null);
    setBusy(true);
    const { error: err } = await supabase.from("timber_account_entries").insert({
      organization_id: orgId,
      account_id: accountId,
      entry_date: date,
      entry_type: type,
      product: product || null,
      volume_change: subtract ? -Math.abs(vol) : vol,
      basis_change: basisChange,
      memo: memo.trim() || null,
    });
    if (err) {
      setBusy(false);
      setError(friendlyDbError(err, "Could not save the entry. Please try again."));
      return;
    }
    // The form closes here; it stays off until then so a second tap
    // cannot add the entry twice.
    onDone();
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
        <button
          onClick={save}
          disabled={busy}
          className="rounded-lg bg-kelly-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-kelly-600 disabled:opacity-50"
        >
          {busy ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}
