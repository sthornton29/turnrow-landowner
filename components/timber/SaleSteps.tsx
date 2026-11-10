"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatDollars } from "@/lib/format";
import {
  STAGES,
  STAGE_ORDER,
  afterHarvestSuggestion,
  analyzeBids,
  foresterFee,
  stageItems,
  stageProgress,
  type CheckValue,
  type SaleStage,
} from "@/lib/timberSaleSteps";

// The sale as steps (migration 0048): a stage bar, the current step's
// goal and checklist, its few fields, the sealed bids, selling costs,
// and what to do after the harvest. Everything saves as you go.

export interface StepsSale {
  id: string;
  harvest_type: string | null;
  stage: SaleStage;
  checklist: Record<string, string>;
  forester_name: string | null;
  forester_fee_pct: number | null;
  min_bid: number | null;
  bid_date: string | null;
  harvest_start: string | null;
  harvest_end: string | null;
  closeout_date: string | null;
  deposit_returned_date: string | null;
  reforestation_due: string | null;
  form_1099s_received: boolean;
  form_1099s_amount: number | null;
}

export interface StepsBid {
  id: string;
  bidder: string;
  amount: number;
  received_date: string | null;
  is_winner: boolean;
}

export interface StepsCost {
  id: string;
  paid_date: string;
  amount: number;
  vendor: string | null;
  description: string | null;
  property_id: string;
}

const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm";
const labelCls = "mb-0.5 block text-xs font-medium text-gray-600";

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function SaleSteps({
  orgId,
  sale,
  bids,
  costs,
  received,
  properties,
  standsByProperty,
  accountByProperty,
}: {
  orgId: string;
  sale: StepsSale;
  bids: StepsBid[];
  costs: StepsCost[];
  received: number;
  properties: Array<{ id: string; name: string }>;
  standsByProperty: Record<string, string[]>;
  accountByProperty: Record<string, string | null>;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [view, setView] = useState<SaleStage>(sale.stage);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [f, setF] = useState({
    forester_name: sale.forester_name ?? "",
    forester_fee_pct: sale.forester_fee_pct != null ? String(sale.forester_fee_pct) : "",
    min_bid: sale.min_bid != null ? String(sale.min_bid) : "",
    bid_date: sale.bid_date ?? "",
    harvest_start: sale.harvest_start ?? "",
    harvest_end: sale.harvest_end ?? "",
    closeout_date: sale.closeout_date ?? "",
    deposit_returned_date: sale.deposit_returned_date ?? "",
    reforestation_due: sale.reforestation_due ?? "",
    form_1099s_amount: sale.form_1099s_amount != null ? String(sale.form_1099s_amount) : "",
  });
  const [bid, setBid] = useState({ bidder: "", amount: "", date: localToday() });
  const [cost, setCost] = useState({
    amount: "",
    date: localToday(),
    vendor: "",
    description: "",
    property_id: properties[0]?.id ?? "",
  });

  async function patch(values: Record<string, unknown>) {
    setError(null);
    const { error: err } = await supabase.from("timber_sales").update(values).eq("id", sale.id);
    if (err) setError(`Could not save: ${err.message}`);
    else router.refresh();
  }

  const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(/[$,%]/g, "")));

  async function saveFields() {
    await patch({
      forester_name: f.forester_name.trim() || null,
      forester_fee_pct: num(f.forester_fee_pct),
      min_bid: num(f.min_bid),
      bid_date: f.bid_date || null,
      harvest_start: f.harvest_start || null,
      harvest_end: f.harvest_end || null,
      closeout_date: f.closeout_date || null,
      deposit_returned_date: f.deposit_returned_date || null,
      reforestation_due: f.reforestation_due || null,
      form_1099s_amount: num(f.form_1099s_amount),
    });
    setNotice("Saved.");
  }

  async function setCheck(key: string, value: CheckValue) {
    const next = { ...sale.checklist };
    if (next[key] === value) delete next[key];
    else next[key] = value;
    await patch({ checklist: next });
  }

  async function addBid() {
    setError(null);
    const amount = Number(bid.amount.replace(/[$,]/g, ""));
    if (!bid.bidder.trim() || !(amount > 0)) return setError("Enter the bidder and the amount.");
    const { error: err } = await supabase.from("timber_sale_bids").insert({
      organization_id: orgId,
      timber_sale_id: sale.id,
      bidder: bid.bidder.trim(),
      amount: Math.round(amount * 100) / 100,
      received_date: bid.date || null,
    });
    if (err) return setError(`Could not save: ${err.message}`);
    setBid({ bidder: "", amount: "", date: bid.date });
    router.refresh();
  }

  async function markWinner(id: string) {
    setError(null);
    const r1 = await supabase.from("timber_sale_bids").update({ is_winner: false }).eq("timber_sale_id", sale.id);
    const r2 = await supabase.from("timber_sale_bids").update({ is_winner: true }).eq("id", id);
    const err = r1.error ?? r2.error;
    if (err) setError(`Could not save: ${err.message}`);
    else router.refresh();
  }

  async function removeBid(id: string) {
    const { error: err } = await supabase.from("timber_sale_bids").delete().eq("id", id);
    if (err) setError(`Could not remove: ${err.message}`);
    else router.refresh();
  }

  async function addCost() {
    setError(null);
    const amount = Number(cost.amount.replace(/[$,]/g, ""));
    if (!(amount > 0) || !cost.property_id) return setError("Enter the amount (and the property).");
    const { error: err } = await supabase.from("timber_costs").insert({
      organization_id: orgId,
      property_id: cost.property_id,
      timber_sale_id: sale.id,
      paid_date: cost.date,
      amount: Math.round(amount * 100) / 100,
      vendor: cost.vendor.trim() || null,
      description: cost.description.trim() || null,
      tax_category: "selling_expense",
    });
    if (err) return setError(`Could not save: ${err.message}`);
    setCost({ ...cost, amount: "", vendor: "", description: "" });
    router.refresh();
  }

  async function removeCost(id: string) {
    const { error: err } = await supabase.from("timber_costs").delete().eq("id", id);
    if (err) setError(`Could not remove: ${err.message}`);
    else router.refresh();
  }

  // After the harvest: one planned activity per property on the sale's stands.
  const next = afterHarvestSuggestion(sale.harvest_type);
  async function scheduleNext() {
    if (!next) return;
    setError(null);
    const year = new Date().getFullYear() + (next.activity === "prescribed_burn" ? 2 : 1);
    for (const p of properties) {
      const stands = standsByProperty[p.id] ?? [];
      if (stands.length === 0) continue;
      const { error: err } = await supabase.rpc("save_stand_activity", {
        p: {
          property_id: p.id,
          activity_type: next.activity,
          status: "planned",
          activity_year: year,
          title: next.activity === "planting" ? "Replant after harvest" : "Burn after thinning",
          timber_sale_id: sale.id,
          details: {},
          stands: stands.map((id) => ({ timber_stand_id: id })),
          costs: [],
        },
      });
      if (err) return setError(`Could not schedule: ${err.message}`);
    }
    await setCheck("d_next", "yes");
    setNotice(`Scheduled for ${year} on the stand pages.`);
  }

  const bidInfo = analyzeBids(bids, sale.min_bid);
  const fee = foresterFee(sale.forester_fee_pct, received);
  const costTotal = costs.reduce((s, c) => s + Number(c.amount), 0);
  const stagesToShow = showAll ? STAGE_ORDER : [view];

  return (
    <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-gray-900">Sale steps</h2>
        <button onClick={() => setShowAll((v) => !v)} className="text-xs font-medium text-kelly-700 hover:underline">
          {showAll ? "Show one step" : "Show every step"}
        </button>
      </div>

      {/* Stage bar */}
      <ol className="flex flex-wrap gap-1.5">
        {STAGE_ORDER.map((s, i) => {
          const current = s === sale.stage;
          const past = STAGE_ORDER.indexOf(sale.stage) > i;
          const prog = stageProgress(s, sale.checklist);
          return (
            <li key={s}>
              <button
                onClick={() => setView(s)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  current
                    ? "bg-pine-800 text-white"
                    : past
                      ? "bg-kelly-100 text-pine-900"
                      : "border border-gray-300 bg-white text-gray-600"
                } ${view === s && !current ? "ring-2 ring-kelly-400" : ""}`}
              >
                {i + 1}. {STAGES[s].label}
                {prog.done > 0 ? ` (${prog.done}/${prog.total})` : ""}
              </button>
            </li>
          );
        })}
      </ol>
      {view !== sale.stage ? (
        <button onClick={() => patch({ stage: view })} className="text-xs font-semibold text-kelly-700 hover:underline">
          Move the sale to {STAGES[view].label}
        </button>
      ) : null}

      {stagesToShow.map((s) => (
        <div key={s} className="space-y-3 rounded-lg bg-gray-50 p-3">
          <p className="text-sm text-gray-700">
            <span className="font-semibold text-gray-900">{STAGES[s].label}.</span> {STAGES[s].goal}
          </p>
          <ul className="space-y-1">
            {stageItems(s).map((item) => {
              const v = sale.checklist[item.key];
              return (
                <li key={item.key} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="flex gap-1">
                    {(["yes", "no", "na"] as CheckValue[]).map((opt) => (
                      <button
                        key={opt}
                        onClick={() => setCheck(item.key, opt)}
                        className={`rounded px-1.5 py-0.5 text-xs ${
                          v === opt
                            ? opt === "yes"
                              ? "bg-kelly-600 text-white"
                              : opt === "no"
                                ? "bg-red-600 text-white"
                                : "bg-gray-500 text-white"
                            : "border border-gray-300 bg-white text-gray-600"
                        }`}
                      >
                        {opt === "yes" ? "Yes" : opt === "no" ? "No" : "N/A"}
                      </button>
                    ))}
                  </span>
                  <span className={v === "yes" || v === "na" ? "text-gray-500" : "text-gray-900"}>{item.label}</span>
                  {item.help ? <span className="w-full pl-28 text-xs text-gray-500">{item.help}</span> : null}
                </li>
              );
            })}
          </ul>

          {/* The fields that belong to this step */}
          {s === "planning" ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label className={labelCls}>Consulting forester</label>
                <input value={f.forester_name} onChange={(e) => setF({ ...f, forester_name: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Fee (% of the sale)</label>
                <input value={f.forester_fee_pct} onChange={(e) => setF({ ...f, forester_fee_pct: e.target.value })} inputMode="decimal" className={inputCls} />
              </div>
            </div>
          ) : null}
          {s === "cruise" ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div>
                <label className={labelCls}>Minimum acceptable bid</label>
                <input value={f.min_bid} onChange={(e) => setF({ ...f, min_bid: e.target.value })} inputMode="decimal" placeholder="$" className={inputCls} />
              </div>
            </div>
          ) : null}
          {s === "marketing" ? (
            <div className="space-y-2">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div>
                  <label className={labelCls}>Bid opening date</label>
                  <input type="date" value={f.bid_date} onChange={(e) => setF({ ...f, bid_date: e.target.value })} className={inputCls} />
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <p className="mb-1 text-sm font-medium text-gray-900">Bids received</p>
                {bids.length === 0 ? (
                  <p className="text-xs text-gray-500">None recorded yet.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {[...bids]
                      .sort((a, b) => b.amount - a.amount)
                      .map((b) => (
                        <li key={b.id} className="flex flex-wrap items-center gap-x-3">
                          <span className="font-medium text-gray-900">{b.bidder}</span>
                          <span>{formatDollars(Number(b.amount))}</span>
                          {b.is_winner ? (
                            <span className="rounded-full bg-kelly-100 px-2 py-0.5 text-xs text-pine-900">Winner</span>
                          ) : (
                            <button onClick={() => markWinner(b.id)} className="text-xs text-kelly-700 hover:underline">
                              Mark winner
                            </button>
                          )}
                          <button onClick={() => removeBid(b.id)} className="ml-auto text-xs text-red-600 hover:underline">
                            Remove
                          </button>
                        </li>
                      ))}
                  </ul>
                )}
                {bidInfo.count > 1 || bidInfo.meetsMin !== null ? (
                  <p className="mt-1 text-xs text-gray-600">
                    {bidInfo.count > 1 && bidInfo.spreadPct !== null
                      ? `${bidInfo.count} bids; the high bid is ${Math.round(bidInfo.spreadPct * 100)}% above the low. `
                      : ""}
                    {bidInfo.meetsMin === true ? "The high bid meets your minimum." : null}
                    {bidInfo.meetsMin === false ? "No bid meets your minimum; you do not have to sell." : null}
                  </p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  <input value={bid.bidder} onChange={(e) => setBid({ ...bid, bidder: e.target.value })} placeholder="Bidder" className="min-w-0 flex-1 rounded-lg border border-gray-300 px-2 py-1 text-sm" />
                  <input value={bid.amount} onChange={(e) => setBid({ ...bid, amount: e.target.value })} placeholder="Amount $" inputMode="decimal" className="w-32 rounded-lg border border-gray-300 px-2 py-1 text-sm" />
                  <input type="date" value={bid.date} onChange={(e) => setBid({ ...bid, date: e.target.value })} className="rounded-lg border border-gray-300 px-2 py-1 text-sm" />
                  <button onClick={addBid} className="rounded-lg bg-kelly-500 px-3 py-1 text-sm font-semibold text-white hover:bg-kelly-600">
                    Add bid
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          {s === "contract" ? (
            <p className="text-xs text-gray-500">
              The contract terms themselves (buyer, rates or price, deadline, deposit) are in the sale details below.
            </p>
          ) : null}
          {s === "harvesting" ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div>
                <label className={labelCls}>Logging started</label>
                <input type="date" value={f.harvest_start} onChange={(e) => setF({ ...f, harvest_start: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Logging finished</label>
                <input type="date" value={f.harvest_end} onChange={(e) => setF({ ...f, harvest_end: e.target.value })} className={inputCls} />
              </div>
            </div>
          ) : null}
          {s === "closeout" ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div>
                <label className={labelCls}>Closeout walk</label>
                <input type="date" value={f.closeout_date} onChange={(e) => setF({ ...f, closeout_date: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Deposit returned</label>
                <input type="date" value={f.deposit_returned_date} onChange={(e) => setF({ ...f, deposit_returned_date: e.target.value })} className={inputCls} />
              </div>
            </div>
          ) : null}
          {s === "complete" ? (
            <div className="space-y-2">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={sale.form_1099s_received}
                    onChange={(e) => patch({ form_1099s_received: e.target.checked })}
                    className="h-4 w-4 accent-kelly-500"
                  />
                  1099-S received
                </label>
                <div>
                  <label className={labelCls}>1099-S amount</label>
                  <input value={f.form_1099s_amount} onChange={(e) => setF({ ...f, form_1099s_amount: e.target.value })} inputMode="decimal" placeholder="$" className={inputCls} />
                </div>
                {next?.activity === "planting" ? (
                  <div>
                    <label className={labelCls}>Replant by</label>
                    <input type="date" value={f.reforestation_due} onChange={(e) => setF({ ...f, reforestation_due: e.target.value })} className={inputCls} />
                  </div>
                ) : null}
              </div>
              <div className="space-y-1 text-sm">
                {properties.map((p) => (
                  <p key={p.id}>
                    {accountByProperty[p.id] ? (
                      <Link href={`/timber/basis/${accountByProperty[p.id]}`} className="font-medium text-kelly-700 hover:underline">
                        Record the depletion for {p.name}
                      </Link>
                    ) : (
                      <Link href="/timber/basis" className="font-medium text-kelly-700 hover:underline">
                        Set up the timber basis for {p.name} to record depletion
                      </Link>
                    )}
                  </p>
                ))}
                {next ? (
                  <p className="text-gray-700">
                    {next.text}{" "}
                    <button onClick={scheduleNext} className="font-semibold text-kelly-700 hover:underline">
                      {next.activity === "planting" ? "Schedule replanting" : "Schedule the burn"}
                    </button>
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
          {["planning", "cruise", "marketing", "harvesting", "closeout", "complete"].includes(s) ? (
            <button onClick={saveFields} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50">
              Save these details
            </button>
          ) : null}
        </div>
      ))}

      {/* Selling costs */}
      <div className="rounded-lg border border-gray-200 p-3">
        <p className="text-sm font-medium text-gray-900">
          Selling costs{costTotal > 0 ? `: ${formatDollars(costTotal)}` : ""}
        </p>
        <p className="mb-2 text-xs text-gray-500">
          The forester&apos;s sale fee, a cruise for the sale, legal fees. They lower the taxable gain.
          {fee !== null ? ` At ${sale.forester_fee_pct}% of ${formatDollars(received)} received, the forester's fee is about ${formatDollars(fee)}.` : ""}
        </p>
        {costs.length > 0 ? (
          <ul className="mb-2 space-y-1 text-sm">
            {costs.map((c) => (
              <li key={c.id} className="flex flex-wrap gap-x-3">
                <span className="font-mono text-xs text-gray-500">{c.paid_date}</span>
                <span className="text-gray-900">{[c.description, c.vendor].filter(Boolean).join(", ") || "Cost"}</span>
                {properties.length > 1 ? (
                  <span className="text-gray-500">{properties.find((p) => p.id === c.property_id)?.name}</span>
                ) : null}
                <span className="ml-auto">{formatDollars(Number(c.amount))}</span>
                <button onClick={() => removeCost(c.id)} className="text-xs text-red-600 hover:underline">
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <input value={cost.amount} onChange={(e) => setCost({ ...cost, amount: e.target.value })} placeholder="Amount $" inputMode="decimal" className="w-28 rounded-lg border border-gray-300 px-2 py-1 text-sm" />
          <input type="date" value={cost.date} onChange={(e) => setCost({ ...cost, date: e.target.value })} className="rounded-lg border border-gray-300 px-2 py-1 text-sm" />
          <input value={cost.vendor} onChange={(e) => setCost({ ...cost, vendor: e.target.value })} placeholder="Paid to" className="w-36 rounded-lg border border-gray-300 px-2 py-1 text-sm" />
          <input value={cost.description} onChange={(e) => setCost({ ...cost, description: e.target.value })} placeholder="For (forester fee)" className="min-w-0 flex-1 rounded-lg border border-gray-300 px-2 py-1 text-sm" />
          {properties.length > 1 ? (
            <select value={cost.property_id} onChange={(e) => setCost({ ...cost, property_id: e.target.value })} className="rounded-lg border border-gray-300 px-2 py-1 text-sm">
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : null}
          <button onClick={addCost} className="rounded-lg bg-kelly-500 px-3 py-1 text-sm font-semibold text-white hover:bg-kelly-600">
            Add
          </button>
        </div>
      </div>

      {notice ? <p className="text-xs text-pine-900">{notice}</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </section>
  );
}
