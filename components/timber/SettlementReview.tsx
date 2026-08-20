"use client";

// Review screen for an extracted logger/mill settlement, shared by the
// timber sale's "Upload settlement", the timber module's unmatched
// upload, and the rent upload's timber routing. Everything is reviewed
// before saving (standing convention): extracted lines show against
// the contract's products and rates, rate mismatches flag WITHOUT
// blocking, allocation follows the sale's method but is adjustable per
// settlement, and the source file attaches to the sale.

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatAcres, formatDollars, formatNumber } from "@/lib/format";
import {
  RATE_UNIT_LABELS,
  normalizeSettlementLine,
  normalizeStumpageRate,
  type RateUnit,
  type SettlementLine,
  type StumpageRate,
} from "@/lib/leaseLogic";
import { rateMismatch } from "@/lib/timberSettlement";
import {
  allocationShares,
  type AllocationMethod,
} from "@/lib/timberAllocation";

export interface SettlementExtraction {
  payer_name: string | null;
  date: string | null;
  period_start: string | null;
  period_end: string | null;
  check_number: string | null;
  total_amount: number | null;
  lines: Array<Partial<SettlementLine> & { tons?: number; price_per_ton?: number }>;
  unsure_fields: string[];
}

export interface SaleOption {
  id: string;
  sale_name: string;
  buyer_name: string | null;
  sale_type: string;
  status: string;
  delivered_net?: boolean;
  allocation_method?: AllocationMethod;
  stumpage_rates: unknown;
}

interface LinkedStand {
  id: string;
  name: string;
  acres: number | null;
  allocation_pct: number | null;
}

const inputClass = "rounded-lg border border-gray-300 px-2 py-1.5 text-sm";
const amberClass =
  "rounded-lg border border-amber-400 bg-amber-50 px-2 py-1.5 text-sm";

export default function SettlementReview({
  orgId,
  file,
  extraction,
  sales,
  initialSaleId,
  saleSuggested = false,
  saleLocked = false,
  onSaved,
  onDiscard,
}: {
  orgId: string;
  file: File;
  extraction: SettlementExtraction;
  sales: SaleOption[];
  initialSaleId: string;
  saleSuggested?: boolean;
  saleLocked?: boolean;
  onSaved?: () => void;
  onDiscard?: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [saleId, setSaleId] = useState(initialSaleId);
  const [date, setDate] = useState(extraction.date ?? "");
  const [periodStart, setPeriodStart] = useState(extraction.period_start ?? "");
  const [periodEnd, setPeriodEnd] = useState(extraction.period_end ?? "");
  const [checkNumber, setCheckNumber] = useState(extraction.check_number ?? "");
  const [lines, setLines] = useState<SettlementLine[]>(
    extraction.lines.map(normalizeSettlementLine)
  );
  const [linkedStands, setLinkedStands] = useState<LinkedStand[]>([]);
  const [allocationOverride, setAllocationOverride] = useState<
    "inherit" | AllocationMethod
  >("inherit");
  const [manualPcts, setManualPcts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sale = sales.find((s) => s.id === saleId) ?? null;
  const contractRates: StumpageRate[] = useMemo(
    () =>
      Array.isArray(sale?.stumpage_rates)
        ? (sale!.stumpage_rates as Array<Record<string, unknown>>).map((r) =>
            normalizeStumpageRate(r as Partial<StumpageRate>)
          )
        : [],
    [sale]
  );

  // Linked stands for the allocation panel, per selected sale.
  const loadStands = useCallback(async () => {
    if (!saleId) {
      setLinkedStands([]);
      return;
    }
    const { data: links } = await supabase
      .from("timber_sale_stands")
      .select("timber_stand_id, allocation_pct")
      .eq("timber_sale_id", saleId);
    const ids = (links ?? []).map((l) => l.timber_stand_id);
    if (ids.length === 0) {
      setLinkedStands([]);
      return;
    }
    const { data: stands } = await supabase
      .from("timber_stands")
      .select("id, name, acres")
      .in("id", ids);
    const pctByStand = new Map(
      (links ?? []).map((l) => [l.timber_stand_id, l.allocation_pct])
    );
    setLinkedStands(
      (stands ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        acres: s.acres,
        allocation_pct: pctByStand.get(s.id) ?? null,
      }))
    );
  }, [supabase, saleId]);

  useEffect(() => {
    loadStands();
  }, [loadStands]);

  function patchLine(i: number, patch: Partial<SettlementLine>) {
    setLines((prev) =>
      prev.map((l, j) => {
        if (j !== i) return l;
        const next = { ...l, ...patch };
        // Quantity or rate edits recompute the amount unless the amount
        // itself was edited.
        if (
          (patch.quantity !== undefined || patch.rate !== undefined) &&
          patch.amount === undefined
        ) {
          next.amount = Math.round(next.quantity * next.rate * 100) / 100;
        }
        return next;
      })
    );
  }

  const total =
    Math.round(lines.reduce((s, l) => s + (l.amount || 0), 0) * 100) / 100;
  const statedTotal = extraction.total_amount;

  const effectiveMethod: AllocationMethod =
    allocationOverride === "inherit"
      ? (sale?.allocation_method ?? "by_acres")
      : allocationOverride;
  const shares = allocationShares(
    effectiveMethod,
    linkedStands.map((s) => ({
      id: s.id,
      acres: s.acres,
      allocation_pct:
        allocationOverride === "manual" || (allocationOverride === "inherit" && effectiveMethod === "manual")
          ? (manualPcts[s.id] !== undefined && manualPcts[s.id] !== ""
              ? Number(manualPcts[s.id])
              : s.allocation_pct)
          : s.allocation_pct,
    })),
    undefined
  );

  async function save() {
    if (!saleId) {
      setError("Pick the timber sale first.");
      return;
    }
    const goodLines = lines.filter((l) => l.quantity > 0 || l.amount > 0);
    if (goodLines.length === 0) {
      setError("Nothing to save: the settlement has no product lines.");
      return;
    }
    setSaving(true);
    setError(null);
    const allocation =
      allocationOverride === "inherit"
        ? null
        : allocationOverride === "manual"
          ? {
              method: "manual" as const,
              percents: Object.fromEntries(
                linkedStands
                  .map((s) => [s.id, Number(manualPcts[s.id]) || 0] as const)
                  .filter(([, pct]) => pct > 0)
              ),
            }
          : { method: allocationOverride };
    const provenance = `Uploaded settlement "${file.name}", extracted ${new Date().toISOString().slice(0, 10)}`;
    const { error: insErr } = await supabase.from("timber_settlements").insert({
      organization_id: orgId,
      timber_sale_id: saleId,
      settlement_date: date || new Date().toISOString().slice(0, 10),
      period_start: periodStart || null,
      period_end: periodEnd || null,
      lines: goodLines,
      total_amount: total,
      check_number: checkNumber.trim() || null,
      memo: provenance,
      allocation,
    });
    if (insErr) {
      setSaving(false);
      setError("Could not save the settlement: " + insErr.message);
      return;
    }
    const path = `${orgId}/timber_sale/${crypto.randomUUID()}-${file.name}`;
    const { error: upErr } = await supabase.storage
      .from("documents")
      .upload(path, file, { contentType: file.type || undefined });
    if (!upErr) {
      await supabase.from("documents").insert({
        organization_id: orgId,
        entity_type: "timber_sale",
        entity_id: saleId,
        file_name: file.name,
        storage_path: path,
        content_type: file.type || null,
        size_bytes: file.size,
      });
    }
    setSaving(false);
    setSaved(true);
    onSaved?.();
  }

  const unsure = (key: string) =>
    extraction.unsure_fields?.includes(key) ? amberClass : inputClass;

  if (saved) {
    return (
      <p className="rounded-lg bg-kelly-50 px-3 py-2 text-sm font-medium text-pine-900">
        Settlement saved to {sale?.sale_name ?? "the sale"} with the document
        attached.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {!saleLocked ? (
        <label className="block text-xs text-gray-600">
          Timber sale
          {saleSuggested && saleId === initialSaleId && saleId ? (
            <span className="ml-1.5 rounded-full bg-kelly-100 px-1.5 py-0.5 text-[10px] font-medium text-kelly-700">
              Suggested from buyer and products
            </span>
          ) : null}
          <select
            value={saleId}
            onChange={(e) => setSaleId(e.target.value)}
            className={`${inputClass} mt-0.5 block w-full`}
          >
            <option value="">Pick a sale...</option>
            {sales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.sale_name}
                {s.buyer_name ? ` (${s.buyer_name})` : ""}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-gray-600">
          Settlement date
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={`${unsure("date")} block`}
          />
        </label>
        <label className="text-xs text-gray-600">
          Period from
          <input
            type="date"
            value={periodStart}
            onChange={(e) => setPeriodStart(e.target.value)}
            className={`${unsure("period_start")} block`}
          />
        </label>
        <label className="text-xs text-gray-600">
          to
          <input
            type="date"
            value={periodEnd}
            onChange={(e) => setPeriodEnd(e.target.value)}
            className={`${unsure("period_end")} block`}
          />
        </label>
        <label className="text-xs text-gray-600">
          Check #
          <input
            value={checkNumber}
            onChange={(e) => setCheckNumber(e.target.value)}
            className={`${unsure("check_number")} block w-24`}
          />
        </label>
      </div>

      <div className="space-y-1.5 rounded-lg bg-gray-50 p-2">
        <p className="text-xs font-medium text-gray-700">
          Product lines{" "}
          {lines.some((l) => l.load_count && l.load_count > 1)
            ? "(per-load detail collapsed to period lines)"
            : ""}
        </p>
        {lines.map((line, i) => {
          const mismatch = rateMismatch(line, contractRates);
          return (
            <div key={i} className="space-y-0.5">
              <div className="flex flex-wrap items-center gap-1.5 text-sm">
                <input
                  value={line.label}
                  onChange={(e) => patchLine(i, { label: e.target.value })}
                  className={`${inputClass} w-40`}
                />
                <input
                  type="number"
                  step="0.01"
                  value={line.quantity || ""}
                  onChange={(e) =>
                    patchLine(i, { quantity: Number(e.target.value) })
                  }
                  className={`${inputClass} w-20 text-right`}
                  title={`Quantity in ${RATE_UNIT_LABELS[line.unit]}s`}
                />
                <select
                  value={line.unit}
                  onChange={(e) =>
                    patchLine(i, { unit: e.target.value as RateUnit })
                  }
                  className={`${inputClass} px-1`}
                >
                  <option value="ton">tons</option>
                  <option value="mbf">MBF</option>
                </select>
                <span className="text-xs text-gray-500">at $</span>
                <input
                  type="number"
                  step="0.01"
                  value={line.rate || ""}
                  onChange={(e) => patchLine(i, { rate: Number(e.target.value) })}
                  className={`${inputClass} w-20 text-right`}
                />
                <span className="text-xs text-gray-500">
                  = {formatDollars(line.amount || 0)}
                </span>
                <button
                  onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
                  className="text-xs font-medium text-red-600 hover:underline"
                >
                  Remove
                </button>
              </div>
              {line.load_count || line.date_from ? (
                <p className="pl-1 text-[11px] text-gray-500">
                  {line.load_count
                    ? `${line.load_count} load${line.load_count === 1 ? "" : "s"}`
                    : ""}
                  {line.date_from
                    ? `${line.load_count ? ", " : ""}${line.date_from}${
                        line.date_to && line.date_to !== line.date_from
                          ? ` to ${line.date_to}`
                          : ""
                      }`
                    : ""}
                </p>
              ) : null}
              {mismatch ? (
                <p className="pl-1 text-[11px] font-medium text-amber-700">
                  {mismatch.unitMismatch
                    ? `Settlement pays per ${RATE_UNIT_LABELS[line.unit]}, contract prices this product per ${RATE_UNIT_LABELS[mismatch.contract.unit]}.`
                    : `Settlement pays ${formatDollars(line.rate)}/${RATE_UNIT_LABELS[line.unit]}, contract says ${formatDollars(mismatch.contract.rate)}.`}
                </p>
              ) : null}
            </div>
          );
        })}
        <div className="flex items-center gap-3 pt-1">
          <span className="text-sm font-semibold text-pine-900">
            Total: {formatDollars(total)}
          </span>
          {statedTotal != null && Math.abs(statedTotal - total) > 0.01 ? (
            <span className="text-xs font-medium text-amber-700">
              The statement says {formatDollars(statedTotal)}; check the lines.
            </span>
          ) : null}
        </div>
      </div>

      {linkedStands.length > 0 ? (
        <div className="space-y-1.5 rounded-lg bg-gray-50 p-2">
          <p className="text-xs font-medium text-gray-700">
            Allocation across linked stands
          </p>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["inherit", `Sale's method`],
                ["by_acres", "By stand acres"],
                ["manual", "Manual"],
                ["none", "Keep at sale level"],
              ] as Array<["inherit" | AllocationMethod, string]>
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setAllocationOverride(value)}
                className={
                  "rounded-lg border px-2 py-1 text-xs font-medium " +
                  (allocationOverride === value
                    ? "border-kelly-500 bg-kelly-50 text-pine-900"
                    : "border-gray-300 bg-white text-gray-600")
                }
              >
                {label}
              </button>
            ))}
          </div>
          {effectiveMethod === "manual" ? (
            <div className="space-y-1">
              {linkedStands.map((s) => (
                <label
                  key={s.id}
                  className="flex items-center gap-2 text-xs text-gray-700"
                >
                  <span className="w-40 truncate">
                    {s.name} ({formatAcres(s.acres)} ac)
                  </span>
                  <input
                    type="number"
                    step="0.1"
                    value={manualPcts[s.id] ?? String(s.allocation_pct ?? "")}
                    onChange={(e) =>
                      setManualPcts((p) => ({ ...p, [s.id]: e.target.value }))
                    }
                    className="w-16 rounded border border-gray-300 px-1.5 py-0.5 text-right"
                  />
                  %
                </label>
              ))}
            </div>
          ) : shares.length > 0 ? (
            <p className="text-[11px] text-gray-500">
              {shares
                .map((sh) => {
                  const stand = linkedStands.find((s) => s.id === sh.standId);
                  return `${stand?.name ?? "Stand"} ${formatNumber(Math.round(sh.pct * 10) / 10)}%`;
                })
                .join(" · ")}
            </p>
          ) : (
            <p className="text-[11px] text-gray-500">
              Stays at sale level (not allocated to stands).
            </p>
          )}
        </div>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-kelly-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save settlement"}
        </button>
        {onDiscard ? (
          <button onClick={onDiscard} className="text-sm text-gray-500 hover:underline">
            Discard
          </button>
        ) : null}
      </div>
    </div>
  );
}
