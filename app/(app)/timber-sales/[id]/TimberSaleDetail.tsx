"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatAcres, formatDollars, formatNumber } from "@/lib/format";
import {
  generateTimberPayments,
  type SettlementLine,
  type StumpageRate,
  type TimberSchedulePayment,
} from "@/lib/leaseLogic";
import TimberSaleForm from "@/components/timber/TimberSaleForm";
import PaymentsSection from "@/components/payments/PaymentsSection";
import EntityDocuments from "@/components/documents/EntityDocuments";

interface SaleRow {
  id: string;
  sale_name: string;
  buyer_name: string | null;
  buyer_tenant_id: string | null;
  sale_type: "lump_sum" | "pay_as_cut";
  status: "active" | "completed" | "expired";
  contract_date: string | null;
  harvest_deadline: string | null;
  performance_deposit: number | null;
  sale_acres: number | null;
  lump_sum_price: number | null;
  stumpage_rates: StumpageRate[];
  payment_schedule: TimberSchedulePayment[];
  notes: string | null;
}

interface StandLink {
  id: string;
  timber_stand_id: string;
}

interface Settlement {
  id: string;
  settlement_date: string;
  lines: SettlementLine[];
  total_amount: number;
  check_number: string | null;
  memo: string | null;
}

export default function TimberSaleDetail({
  orgId,
  sale,
  tenants,
  allStands,
}: {
  orgId: string;
  sale: SaleRow;
  tenants: Array<{ id: string; name: string }>;
  allStands: Array<{ id: string; property_id: string; name: string; acres: number | null }>;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [standLinks, setStandLinks] = useState<StandLink[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [addStandId, setAddStandId] = useState("");
  const [entering, setEntering] = useState(false);
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [entryTons, setEntryTons] = useState<Record<string, string>>({});
  const [entryCheck, setEntryCheck] = useState("");
  const [entryMemo, setEntryMemo] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [links, setts] = await Promise.all([
      supabase.from("timber_sale_stands").select("*").eq("timber_sale_id", sale.id),
      supabase
        .from("timber_settlements")
        .select("*")
        .eq("timber_sale_id", sale.id)
        .order("settlement_date"),
    ]);
    setStandLinks((links.data as StandLink[]) ?? []);
    setSettlements((setts.data as Settlement[]) ?? []);
  }, [supabase, sale.id]);

  useEffect(() => {
    load();
  }, [load]);

  const standById = new Map(allStands.map((s) => [s.id, s]));
  const linkedStandAcres = standLinks.reduce(
    (sum, l) => sum + (standById.get(l.timber_stand_id)?.acres ?? 0),
    0
  );
  const linkedIds = new Set(standLinks.map((l) => l.timber_stand_id));
  const unlinkedStands = allStands.filter((s) => !linkedIds.has(s.id));

  // Running totals by product across all settlements
  const totalsByProduct = useMemo(() => {
    const map = new Map<string, { label: string; tons: number; dollars: number }>();
    for (const s of settlements) {
      for (const line of s.lines ?? []) {
        const cur = map.get(line.product) ?? { label: line.label, tons: 0, dollars: 0 };
        cur.tons += line.tons;
        cur.dollars += line.amount;
        map.set(line.product, cur);
      }
    }
    return map;
  }, [settlements]);
  const settledTotal = settlements.reduce((s, x) => s + (x.total_amount ?? 0), 0);

  const computeExpected = useCallback(() => {
    if (sale.sale_type !== "lump_sum") return [];
    if (sale.payment_schedule.length > 0) {
      return generateTimberPayments(sale.payment_schedule);
    }
    if (sale.lump_sum_price && (sale.contract_date || sale.harvest_deadline)) {
      const due = sale.contract_date ?? sale.harvest_deadline!;
      return [
        {
          year: Number(due.slice(0, 4)),
          label: "Sale price",
          due_date: due,
          expected_amount: sale.lump_sum_price,
        },
      ];
    }
    return [];
  }, [sale]);

  async function addStand() {
    if (!addStandId) return;
    await supabase.from("timber_sale_stands").insert({
      organization_id: orgId,
      timber_sale_id: sale.id,
      timber_stand_id: addStandId,
    });
    setAddStandId("");
    load();
  }

  async function removeStand(id: string) {
    await supabase.from("timber_sale_stands").delete().eq("id", id);
    load();
  }

  async function saveSettlement() {
    setError(null);
    const lines: SettlementLine[] = [];
    for (const rate of sale.stumpage_rates) {
      const tons = Number(entryTons[rate.product] ?? 0);
      if (!tons) continue;
      lines.push({
        product: rate.product,
        label: rate.label,
        tons,
        price_per_ton: rate.price_per_ton,
        amount: Math.round(tons * rate.price_per_ton * 100) / 100,
      });
    }
    if (lines.length === 0) {
      setError("Enter tons for at least one product.");
      return;
    }
    const total = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
    const { error: err } = await supabase.from("timber_settlements").insert({
      organization_id: orgId,
      timber_sale_id: sale.id,
      settlement_date: entryDate,
      lines,
      total_amount: total,
      check_number: entryCheck.trim() || null,
      memo: entryMemo.trim() || null,
    });
    if (err) {
      setError("Could not save: " + err.message);
      return;
    }
    setEntering(false);
    setEntryTons({});
    setEntryCheck("");
    setEntryMemo("");
    load();
  }

  async function deleteSettlement(id: string) {
    if (!window.confirm("Delete this settlement?")) return;
    await supabase.from("timber_settlements").delete().eq("id", id);
    load();
  }

  async function deleteSale() {
    if (!window.confirm("Delete this timber sale and all of its settlements and payments?")) return;
    await supabase.from("timber_sales").delete().eq("id", sale.id);
    router.push("/timber-sales");
  }

  const entryTotal = sale.stumpage_rates.reduce(
    (s, r) => s + Number(entryTons[r.product] ?? 0) * r.price_per_ton,
    0
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <div>
        <Link href="/timber-sales" className="text-sm text-gray-500 hover:underline">
          &larr; Timber sales
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-gray-900">{sale.sale_name}</h1>
          <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
            {sale.sale_type === "lump_sum" ? "Lump sum" : "Pay as cut"}
          </span>
          <span className="rounded-full bg-kelly-50 px-2.5 py-0.5 text-xs font-medium capitalize text-pine-900">
            {sale.status}
          </span>
        </div>
        <p className="mt-1 text-sm text-gray-500">
          {sale.buyer_name ? `Buyer: ${sale.buyer_name} · ` : ""}
          {sale.contract_date ? `signed ${sale.contract_date} · ` : ""}
          {sale.harvest_deadline ? `deadline ${sale.harvest_deadline} · ` : ""}
          {sale.sale_acres ? `${formatAcres(sale.sale_acres)} contract acres · ` : ""}
          {sale.performance_deposit
            ? `deposit ${formatDollars(sale.performance_deposit)}`
            : ""}
        </p>
        {sale.sale_type === "lump_sum" && sale.lump_sum_price ? (
          <p className="text-sm font-medium text-pine-900">
            Sale price {formatDollars(sale.lump_sum_price)}
          </p>
        ) : null}
      </div>

      <details className="rounded-xl border border-gray-200 bg-white">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-kelly-700">
          Edit contract terms
        </summary>
        <div className="px-4 pb-4">
          <TimberSaleForm orgId={orgId} tenants={tenants} sale={sale} />
        </div>
      </details>

      {/* Linked stands */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-gray-900">
          Timber stands{" "}
          <span className="text-sm font-normal text-gray-500">
            {formatAcres(linkedStandAcres)} mapped acres
            {sale.sale_acres ? ` (contract: ${formatAcres(sale.sale_acres)})` : ""}
          </span>
        </h2>
        {standLinks.length === 0 ? (
          <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">
            No stands linked yet.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {standLinks.map((l) => {
              const stand = standById.get(l.timber_stand_id);
              return (
                <li
                  key={l.id}
                  className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2"
                >
                  <span className="font-medium text-gray-900">{stand?.name ?? "Stand"}</span>
                  <span className="text-sm text-gray-500">
                    {formatAcres(stand?.acres ?? 0)} ac
                  </span>
                  <button
                    onClick={() => removeStand(l.id)}
                    className="ml-auto text-xs font-medium text-red-600 hover:underline"
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {unlinkedStands.length > 0 ? (
          <div className="flex items-center gap-2">
            <select
              value={addStandId}
              onChange={(e) => setAddStandId(e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
            >
              <option value="">Select a stand...</option>
              {unlinkedStands.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({formatAcres(s.acres)} ac)
                </option>
              ))}
            </select>
            <button
              onClick={addStand}
              disabled={!addStandId}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              + Link stand
            </button>
          </div>
        ) : null}
      </section>

      {/* Pay-as-cut settlements */}
      {sale.sale_type === "pay_as_cut" ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold text-gray-900">Settlements</h2>
            <span className="text-sm text-gray-500">
              {formatDollars(settledTotal)} settled to date
            </span>
            <button
              onClick={() => setEntering((e) => !e)}
              className="ml-auto rounded-lg bg-kelly-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-kelly-600"
            >
              + Enter settlement
            </button>
          </div>

          {entering ? (
            <div className="space-y-2 rounded-xl border border-gray-200 bg-white p-3">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={entryDate}
                  onChange={(e) => setEntryDate(e.target.value)}
                  className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                />
                <input
                  value={entryCheck}
                  onChange={(e) => setEntryCheck(e.target.value)}
                  placeholder="Check number"
                  className="w-32 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                />
                <input
                  value={entryMemo}
                  onChange={(e) => setEntryMemo(e.target.value)}
                  placeholder="Memo"
                  className="min-w-32 flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                />
              </div>
              {sale.stumpage_rates.length === 0 ? (
                <p className="text-sm text-red-600">
                  Add stumpage rates to the contract first (Edit contract terms).
                </p>
              ) : (
                sale.stumpage_rates.map((rate) => (
                  <div key={rate.product} className="flex items-center gap-2 text-sm">
                    <span className="w-44 text-gray-700">{rate.label}</span>
                    <input
                      type="number"
                      step="0.01"
                      value={entryTons[rate.product] ?? ""}
                      onChange={(e) =>
                        setEntryTons((t) => ({ ...t, [rate.product]: e.target.value }))
                      }
                      placeholder="Tons"
                      className="w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                    />
                    <span className="text-gray-500">
                      × {formatDollars(rate.price_per_ton)}/ton ={" "}
                      {formatDollars(Number(entryTons[rate.product] ?? 0) * rate.price_per_ton)}
                    </span>
                  </div>
                ))
              )}
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-pine-900">
                  Total: {formatDollars(entryTotal)}
                </span>
                <button
                  onClick={saveSettlement}
                  className="rounded-lg bg-kelly-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-kelly-600"
                >
                  Save settlement
                </button>
                <button
                  onClick={() => setEntering(false)}
                  className="text-sm text-gray-500 hover:underline"
                >
                  Cancel
                </button>
              </div>
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
            </div>
          ) : null}

          {totalsByProduct.size > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="px-3 py-2">Product</th>
                    <th className="px-3 py-2 text-right">Tons to date</th>
                    <th className="px-3 py-2 text-right">Dollars to date</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from(totalsByProduct.entries()).map(([product, t]) => (
                    <tr key={product} className="border-b border-gray-100 last:border-0">
                      <td className="px-3 py-2">{t.label}</td>
                      <td className="px-3 py-2 text-right">{formatNumber(Math.round(t.tons * 100) / 100)}</td>
                      <td className="px-3 py-2 text-right">{formatDollars(t.dollars)}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold text-pine-900">
                    <td className="px-3 py-2">Total</td>
                    <td className="px-3 py-2"></td>
                    <td className="px-3 py-2 text-right">{formatDollars(settledTotal)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : null}

          {settlements.length > 0 ? (
            <details className="rounded-lg border border-gray-200 bg-white">
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-gray-700">
                Settlement history ({settlements.length})
              </summary>
              <ul className="divide-y divide-gray-100 px-3 pb-2">
                {settlements.map((s) => (
                  <li key={s.id} className="py-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{s.settlement_date}</span>
                      <span className="font-medium">{formatDollars(s.total_amount)}</span>
                      <span className="text-gray-500">
                        {[s.check_number ? `check ${s.check_number}` : null, s.memo]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      <button
                        onClick={() => deleteSettlement(s.id)}
                        className="ml-auto text-xs font-medium text-red-600 hover:underline"
                      >
                        Delete
                      </button>
                    </div>
                    <p className="text-xs text-gray-500">
                      {(s.lines ?? [])
                        .map((l) => `${l.label}: ${formatNumber(l.tons)} tons`)
                        .join(" · ")}
                    </p>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      ) : null}

      {/* Lump sum expected/received payments */}
      {sale.sale_type === "lump_sum" ? (
        <section>
          <PaymentsSection
            orgId={orgId}
            timberSaleId={sale.id}
            computeExpected={computeExpected}
            emptyHint="No expected payments yet. Set the sale price (and schedule, if split), then press Generate expected payments."
          />
        </section>
      ) : null}

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Documents</h2>
        <EntityDocuments orgId={orgId} entityType="timber_sale" entityId={sale.id} />
      </section>

      <section className="border-t border-gray-200 pt-4">
        <button
          onClick={deleteSale}
          className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
        >
          Delete timber sale
        </button>
      </section>
    </div>
  );
}
