"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatAcres, formatDollars, formatNumber } from "@/lib/format";
import {
  HARVEST_TYPE_LABELS,
  RATE_UNIT_LABELS,
  generateTimberPayments,
  normalizeSettlementLine,
  normalizeStumpageRate,
  type SettlementLine,
  type StumpageRate,
  type TimberSchedulePayment,
} from "@/lib/leaseLogic";
import {
  allocationShares,
  type AllocationMethod,
  type SettlementAllocation,
} from "@/lib/timberAllocation";
import TimberSaleForm from "@/components/timber/TimberSaleForm";
import SettlementUpload from "@/components/timber/SettlementUpload";
import PaymentsSection from "@/components/payments/PaymentsSection";
import EntityDocuments from "@/components/documents/EntityDocuments";

interface SaleRow {
  id: string;
  sale_name: string;
  buyer_name: string | null;
  buyer_tenant_id: string | null;
  sale_type: "lump_sum" | "pay_as_cut";
  delivered_net: boolean;
  harvest_type: string | null;
  allocation_method: AllocationMethod;
  status: "active" | "completed" | "expired";
  contract_date: string | null;
  harvest_deadline: string | null;
  performance_deposit: number | null;
  sale_acres: number | null;
  lump_sum_price: number | null;
  stumpage_rates: Array<Partial<StumpageRate> & { price_per_ton?: number }>;
  payment_schedule: TimberSchedulePayment[];
  notes: string | null;
}

interface StandLink {
  id: string;
  timber_stand_id: string;
  allocation_pct: number | null;
}

interface Settlement {
  id: string;
  settlement_date: string;
  period_start: string | null;
  period_end: string | null;
  lines: Array<Partial<SettlementLine> & { tons?: number; price_per_ton?: number }>;
  total_amount: number;
  check_number: string | null;
  memo: string | null;
  allocation: SettlementAllocation | null;
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
  allStands: Array<{
    id: string;
    property_id: string;
    name: string;
    acres: number | null;
    last_thinning_year: number | null;
  }>;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [standLinks, setStandLinks] = useState<StandLink[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [addStandId, setAddStandId] = useState("");
  const [entering, setEntering] = useState(false);
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [entryQty, setEntryQty] = useState<Record<string, string>>({});
  const [entryCheck, setEntryCheck] = useState("");
  const [entryMemo, setEntryMemo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [thinningDismissed, setThinningDismissed] = useState(false);
  const [thinningYear, setThinningYear] = useState("");
  const [thinningStands, setThinningStands] = useState<Set<string>>(new Set());
  const [thinningInit, setThinningInit] = useState(false);

  const rates = useMemo(
    () => (sale.stumpage_rates ?? []).map(normalizeStumpageRate),
    [sale.stumpage_rates]
  );

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
  const linkedStands = standLinks.map((l) => ({
    link: l,
    stand: standById.get(l.timber_stand_id) ?? null,
  }));
  const linkedStandAcres = linkedStands.reduce(
    (sum, x) => sum + (x.stand?.acres ?? 0),
    0
  );
  const linkedIds = new Set(standLinks.map((l) => l.timber_stand_id));
  const unlinkedStands = allStands.filter((s) => !linkedIds.has(s.id));

  const shares = allocationShares(
    sale.allocation_method,
    linkedStands.map((x) => ({
      id: x.link.timber_stand_id,
      acres: x.stand?.acres ?? null,
      allocation_pct: x.link.allocation_pct,
    }))
  );
  const pctByStand = new Map(shares.map((s) => [s.standId, s.pct]));

  // Running totals by product across all settlements (quantity in the
  // product's unit; a mixed-unit product totals dollars only).
  const totalsByProduct = useMemo(() => {
    const map = new Map<
      string,
      { label: string; quantity: number; unit: string; mixedUnits: boolean; dollars: number }
    >();
    for (const s of settlements) {
      for (const raw of s.lines ?? []) {
        const line = normalizeSettlementLine(raw);
        const cur = map.get(line.product) ?? {
          label: line.label,
          quantity: 0,
          unit: line.unit,
          mixedUnits: false,
          dollars: 0,
        };
        if (cur.unit !== line.unit) cur.mixedUnits = true;
        cur.quantity += line.quantity;
        cur.dollars += line.amount;
        map.set(line.product, cur);
      }
    }
    return map;
  }, [settlements]);
  const settledTotal = settlements.reduce((s, x) => s + (x.total_amount ?? 0), 0);

  // Contract running check: dollars settled vs the contract rate per
  // product (display only).
  const contractRateFor = (product: string) =>
    rates.find((r) => r.product === product) ?? null;

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

  async function setAllocationMethod(method: AllocationMethod) {
    await supabase
      .from("timber_sales")
      .update({ allocation_method: method })
      .eq("id", sale.id);
    router.refresh();
  }

  async function saveManualPct(linkId: string, pct: string) {
    await supabase
      .from("timber_sale_stands")
      .update({ allocation_pct: pct.trim() === "" ? null : Number(pct) })
      .eq("id", linkId);
    load();
  }

  async function saveSettlement() {
    setError(null);
    const lines: SettlementLine[] = [];
    for (const rate of rates) {
      const quantity = Number(entryQty[rate.product] ?? 0);
      if (!quantity) continue;
      lines.push({
        product: rate.product,
        label: rate.label,
        quantity,
        unit: rate.unit,
        rate: rate.rate,
        amount: Math.round(quantity * rate.rate * 100) / 100,
      });
    }
    if (lines.length === 0) {
      setError(`Enter ${rates.some((r) => r.unit === "mbf") ? "quantities" : "tons"} for at least one product.`);
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
    setEntryQty({});
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

  // Marking a thinning-type sale completed: offer (reviewed, never
  // automatic) to set last_thinning_year on the linked stands.
  const isThinning =
    sale.harvest_type === "first_thinning" || sale.harvest_type === "second_thinning";
  const suggestedThinningYear = useMemo(() => {
    const settlementYears = settlements
      .map((s) => Number(s.settlement_date?.slice(0, 4)))
      .filter((y) => Number.isFinite(y));
    if (settlementYears.length > 0) return Math.max(...settlementYears);
    if (sale.harvest_deadline) return Number(sale.harvest_deadline.slice(0, 4));
    if (sale.contract_date) return Number(sale.contract_date.slice(0, 4));
    return new Date().getFullYear();
  }, [settlements, sale]);
  const thinningCandidates = linkedStands.filter((x) => x.stand);
  const showThinningOffer =
    sale.status === "completed" &&
    isThinning &&
    !thinningDismissed &&
    thinningCandidates.some(
      (x) => x.stand!.last_thinning_year !== suggestedThinningYear
    );
  useEffect(() => {
    if (showThinningOffer && !thinningInit) {
      setThinningInit(true);
      setThinningYear(String(suggestedThinningYear));
      setThinningStands(
        new Set(
          thinningCandidates
            .filter((x) => x.stand!.last_thinning_year !== suggestedThinningYear)
            .map((x) => x.stand!.id)
        )
      );
    }
  }, [showThinningOffer, thinningInit, suggestedThinningYear, thinningCandidates]);

  async function applyThinningYear() {
    const year = Number(thinningYear);
    if (!Number.isFinite(year) || thinningStands.size === 0) return;
    for (const standId of thinningStands) {
      await supabase
        .from("timber_stands")
        .update({ last_thinning_year: year })
        .eq("id", standId);
    }
    setThinningDismissed(true);
    router.refresh();
  }

  const entryTotal = rates.reduce(
    (s, r) => s + Number(entryQty[r.product] ?? 0) * r.rate,
    0
  );

  const saleOption = {
    id: sale.id,
    sale_name: sale.sale_name,
    buyer_name: sale.buyer_name,
    sale_type: sale.sale_type,
    status: sale.status,
    delivered_net: sale.delivered_net,
    allocation_method: sale.allocation_method,
    stumpage_rates: sale.stumpage_rates,
  };

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
          {sale.delivered_net ? (
            <span
              className="rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-800"
              title="Delivered price arrangement: the rates are net of cut and haul"
            >
              Delivered price (net)
            </span>
          ) : null}
          {sale.harvest_type ? (
            <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
              {HARVEST_TYPE_LABELS[sale.harvest_type] ?? sale.harvest_type}
            </span>
          ) : null}
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

      {showThinningOffer ? (
        <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-medium text-amber-900">
            This {HARVEST_TYPE_LABELS[sale.harvest_type!]?.toLowerCase()} is
            completed. Set the last thinning year on the linked stands?
          </p>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-1.5 text-xs text-amber-900">
              Year
              <input
                type="number"
                value={thinningYear}
                onChange={(e) => setThinningYear(e.target.value)}
                className="w-20 rounded-lg border border-amber-300 bg-white px-2 py-1 text-sm"
              />
            </label>
            {thinningCandidates.map((x) => (
              <label
                key={x.stand!.id}
                className="flex items-center gap-1.5 text-xs text-amber-900"
              >
                <input
                  type="checkbox"
                  checked={thinningStands.has(x.stand!.id)}
                  onChange={(e) =>
                    setThinningStands((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(x.stand!.id);
                      else next.delete(x.stand!.id);
                      return next;
                    })
                  }
                  className="h-3.5 w-3.5 accent-kelly-500"
                />
                {x.stand!.name}
                {x.stand!.last_thinning_year
                  ? ` (currently ${x.stand!.last_thinning_year})`
                  : ""}
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={applyThinningYear}
              className="rounded-lg bg-kelly-500 px-3 py-1 text-xs font-semibold text-white hover:bg-kelly-600"
            >
              Set on checked stands
            </button>
            <button
              onClick={() => setThinningDismissed(true)}
              className="text-xs text-amber-800 hover:underline"
            >
              Not now
            </button>
          </div>
        </div>
      ) : null}

      <details className="rounded-xl border border-gray-200 bg-white">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-kelly-700">
          Edit contract terms
        </summary>
        <div className="px-4 pb-4">
          <TimberSaleForm orgId={orgId} tenants={tenants} sale={sale} />
        </div>
      </details>

      {/* Linked stands + allocation */}
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
            {linkedStands.map(({ link, stand }) => (
              <li
                key={link.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2"
              >
                {stand ? (
                  <Link
                    href={`/timber/${stand.id}`}
                    className="font-medium text-gray-900 hover:underline"
                  >
                    {stand.name}
                  </Link>
                ) : (
                  <span className="font-medium text-gray-900">Stand</span>
                )}
                <span className="text-sm text-gray-500">
                  {formatAcres(stand?.acres ?? 0)} ac
                </span>
                {sale.allocation_method === "manual" ? (
                  <span className="flex items-center gap-1 text-xs text-gray-600">
                    <input
                      type="number"
                      step="0.1"
                      defaultValue={link.allocation_pct ?? ""}
                      onBlur={(e) => saveManualPct(link.id, e.target.value)}
                      placeholder="0"
                      className="w-16 rounded border border-gray-300 px-1.5 py-0.5 text-right text-xs"
                    />
                    %
                  </span>
                ) : sale.allocation_method === "by_acres" ? (
                  <span className="text-xs text-gray-500">
                    {formatNumber(
                      Math.round((pctByStand.get(link.timber_stand_id) ?? 0) * 10) / 10
                    )}
                    % of dollars
                  </span>
                ) : null}
                <button
                  onClick={() => removeStand(link.id)}
                  className="ml-auto text-xs font-medium text-red-600 hover:underline"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        {standLinks.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-600">
            <span className="font-medium">Allocate dollars to stands:</span>
            {(
              [
                ["by_acres", "By stand acres"],
                ["manual", "Manual percentages"],
                ["none", "Keep at sale level"],
              ] as Array<[AllocationMethod, string]>
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setAllocationMethod(value)}
                className={
                  "rounded-lg border px-2 py-1 font-medium " +
                  (sale.allocation_method === value
                    ? "border-kelly-500 bg-kelly-50 text-pine-900"
                    : "border-gray-300 bg-white text-gray-600")
                }
              >
                {label}
              </button>
            ))}
            <span className="text-gray-400">
              (each settlement can override this)
            </span>
          </div>
        ) : null}
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
            <span className="ml-auto flex gap-2">
              <SettlementUpload
                orgId={orgId}
                sales={[saleOption]}
                fixedSaleId={sale.id}
              />
              <button
                onClick={() => setEntering((e) => !e)}
                className="rounded-lg bg-kelly-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-kelly-600"
              >
                + Enter settlement
              </button>
            </span>
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
              {rates.length === 0 ? (
                <p className="text-sm text-red-600">
                  Add rates to the contract first (Edit contract terms).
                </p>
              ) : (
                rates.map((rate) => (
                  <div key={rate.product} className="flex items-center gap-2 text-sm">
                    <span className="w-44 text-gray-700">{rate.label}</span>
                    <input
                      type="number"
                      step="0.01"
                      value={entryQty[rate.product] ?? ""}
                      onChange={(e) =>
                        setEntryQty((t) => ({ ...t, [rate.product]: e.target.value }))
                      }
                      placeholder={rate.unit === "mbf" ? "MBF" : "Tons"}
                      className="w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                    />
                    <span className="text-gray-500">
                      × {formatDollars(rate.rate)}/{RATE_UNIT_LABELS[rate.unit]} ={" "}
                      {formatDollars(Number(entryQty[rate.product] ?? 0) * rate.rate)}
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
                    <th className="px-3 py-2 text-right">Quantity to date</th>
                    <th className="px-3 py-2 text-right">Contract rate</th>
                    <th className="px-3 py-2 text-right">Dollars to date</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from(totalsByProduct.entries()).map(([product, t]) => {
                    const contract = contractRateFor(product);
                    return (
                      <tr key={product} className="border-b border-gray-100 last:border-0">
                        <td className="px-3 py-2">{t.label}</td>
                        <td className="px-3 py-2 text-right">
                          {t.mixedUnits
                            ? "mixed units"
                            : `${formatNumber(Math.round(t.quantity * 100) / 100)} ${RATE_UNIT_LABELS[t.unit as "ton" | "mbf"]}${t.unit === "ton" ? "s" : ""}`}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-500">
                          {contract
                            ? `${formatDollars(contract.rate)}/${RATE_UNIT_LABELS[contract.unit]}`
                            : ""}
                        </td>
                        <td className="px-3 py-2 text-right">{formatDollars(t.dollars)}</td>
                      </tr>
                    );
                  })}
                  <tr className="font-semibold text-pine-900">
                    <td className="px-3 py-2">Total</td>
                    <td className="px-3 py-2"></td>
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
                      {s.period_start ? (
                        <span className="text-xs text-gray-500">
                          ({s.period_start}
                          {s.period_end && s.period_end !== s.period_start
                            ? ` to ${s.period_end}`
                            : ""}
                          )
                        </span>
                      ) : null}
                      <span className="font-medium">{formatDollars(s.total_amount)}</span>
                      <span className="text-gray-500">
                        {[s.check_number ? `check ${s.check_number}` : null, s.memo]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      {s.allocation ? (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600">
                          custom allocation
                        </span>
                      ) : null}
                      <button
                        onClick={() => deleteSettlement(s.id)}
                        className="ml-auto text-xs font-medium text-red-600 hover:underline"
                      >
                        Delete
                      </button>
                    </div>
                    <p className="text-xs text-gray-500">
                      {(s.lines ?? [])
                        .map(normalizeSettlementLine)
                        .map(
                          (l) =>
                            `${l.label}: ${formatNumber(l.quantity)} ${RATE_UNIT_LABELS[l.unit]}${l.unit === "ton" ? "s" : ""}` +
                            (l.load_count ? ` (${l.load_count} loads)` : "")
                        )
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
