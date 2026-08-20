"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatAcres } from "@/lib/format";
import {
  HARVEST_TYPE_LABELS,
  LOG_SCALE_LABELS,
  TIMBER_PRODUCTS,
  normalizeStumpageRate,
  type LogScale,
  type StumpageRate,
  type TimberSchedulePayment,
} from "@/lib/leaseLogic";
import type { AllocationMethod } from "@/lib/timberAllocation";

export interface TimberPrefill {
  sale_name?: string | null;
  buyer_name?: string | null;
  // The extractor may say delivered_net; that saves as pay_as_cut with
  // the delivered_net flag (net rates), per the model decision.
  sale_type?: "lump_sum" | "pay_as_cut" | "delivered_net" | null;
  harvest_type?: string | null;
  tract_description?: string | null;
  contract_date?: string | null;
  harvest_deadline?: string | null;
  performance_deposit?: number | null;
  sale_acres?: number | null;
  lump_sum_price?: number | null;
  stumpage_rates?: Array<Partial<StumpageRate> & { price_per_ton?: number }> | null;
  payment_schedule?: TimberSchedulePayment[] | null;
  notes?: string | null;
}

interface ExistingSale extends TimberPrefill {
  id: string;
  status: "active" | "completed" | "expired";
  buyer_tenant_id: string | null;
  delivered_net?: boolean;
  allocation_method?: AllocationMethod;
}

export interface StandOption {
  id: string;
  name: string;
  acres: number | null;
  propertyName?: string | null;
}

const inputClass = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";

export default function TimberSaleForm({
  orgId,
  tenants,
  sale,
  prefill,
  unsure = [],
  sourceFile,
  standOptions,
  suggestedStandIds = [],
}: {
  orgId: string;
  tenants: Array<{ id: string; name: string }>;
  sale?: ExistingSale | null;
  prefill?: TimberPrefill | null;
  unsure?: string[];
  sourceFile?: File | null;
  // New-sale flow only: offer stand links (suggested ones pre-checked
  // from the contract's tract description) and the allocation method.
  standOptions?: StandOption[];
  suggestedStandIds?: string[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const src = sale ?? prefill ?? {};

  const [saleName, setSaleName] = useState(src.sale_name ?? "");
  const [buyerName, setBuyerName] = useState(src.buyer_name ?? "");
  const [buyerTenantId, setBuyerTenantId] = useState(sale?.buyer_tenant_id ?? "");
  const [saleType, setSaleType] = useState<"lump_sum" | "pay_as_cut">(
    src.sale_type === "pay_as_cut" || src.sale_type === "delivered_net"
      ? "pay_as_cut"
      : "lump_sum"
  );
  const [deliveredNet, setDeliveredNet] = useState(
    sale?.delivered_net ?? src.sale_type === "delivered_net"
  );
  const [harvestType, setHarvestType] = useState(src.harvest_type ?? "");
  const [status, setStatus] = useState(sale?.status ?? "active");
  const [contractDate, setContractDate] = useState(src.contract_date ?? "");
  const [deadline, setDeadline] = useState(src.harvest_deadline ?? "");
  const [deposit, setDeposit] = useState(String(src.performance_deposit ?? ""));
  const [saleAcres, setSaleAcres] = useState(String(src.sale_acres ?? ""));
  const [lumpPrice, setLumpPrice] = useState(String(src.lump_sum_price ?? ""));
  const [rates, setRates] = useState<StumpageRate[]>(
    (src.stumpage_rates ?? []).map(normalizeStumpageRate)
  );
  const [schedule, setSchedule] = useState<TimberSchedulePayment[]>(
    src.payment_schedule ?? []
  );
  const [notes, setNotes] = useState(src.notes ?? "");
  // Stand links (new-sale flow)
  const [checkedStands, setCheckedStands] = useState<Set<string>>(
    () => new Set(suggestedStandIds)
  );
  const [allocationMethod, setAllocationMethod] =
    useState<AllocationMethod>("by_acres");
  const [manualPcts, setManualPcts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ring = (key: string) =>
    unsure.includes(key) ? " border-amber-400 ring-2 ring-amber-100" : "";
  const num = (v: string) => (v.trim() === "" ? null : Number(v));

  function addStandardRates() {
    const existing = new Set(rates.map((r) => r.product));
    setRates([
      ...rates,
      ...TIMBER_PRODUCTS.filter((p) => !existing.has(p.product)).map((p) => ({
        product: p.product,
        label: p.label,
        rate: 0,
        unit: "ton" as const,
        log_scale: null,
      })),
    ]);
  }

  function patchRate(i: number, patch: Partial<StumpageRate>) {
    setRates((r) =>
      r.map((x, j) => {
        if (j !== i) return x;
        const next = { ...x, ...patch };
        if (patch.unit === "mbf" && !next.log_scale) next.log_scale = "doyle";
        if (patch.unit === "ton") next.log_scale = null;
        return next;
      })
    );
  }

  async function save() {
    setBusy(true);
    setError(null);
    const row = {
      organization_id: orgId,
      sale_name: saleName.trim() || "Untitled sale",
      buyer_name: buyerName.trim() || null,
      buyer_tenant_id: buyerTenantId || null,
      sale_type: saleType,
      delivered_net: saleType === "pay_as_cut" ? deliveredNet : false,
      harvest_type: harvestType || null,
      status,
      contract_date: contractDate || null,
      harvest_deadline: deadline || null,
      performance_deposit: num(deposit),
      sale_acres: num(saleAcres),
      lump_sum_price: saleType === "lump_sum" ? num(lumpPrice) : null,
      stumpage_rates: saleType === "pay_as_cut" ? rates : [],
      payment_schedule: schedule,
      notes: notes.trim() || null,
    };

    if (sale) {
      const { error: err } = await supabase.from("timber_sales").update(row).eq("id", sale.id);
      setBusy(false);
      if (err) return setError("Could not save: " + err.message);
      router.refresh();
      return;
    }

    const insertRow = {
      ...row,
      allocation_method: standOptions ? allocationMethod : "by_acres",
    };
    const { data, error: err } = await supabase
      .from("timber_sales")
      .insert(insertRow)
      .select("id")
      .single();
    if (err || !data) {
      setBusy(false);
      return setError("Could not save: " + (err?.message ?? ""));
    }
    // Confirmed stand links, with manual percentages when chosen.
    if (standOptions && checkedStands.size > 0) {
      const links = Array.from(checkedStands).map((standId) => ({
        organization_id: orgId,
        timber_sale_id: data.id,
        timber_stand_id: standId,
        allocation_pct:
          allocationMethod === "manual"
            ? Number(manualPcts[standId]) || 0
            : null,
      }));
      const { error: linkErr } = await supabase
        .from("timber_sale_stands")
        .insert(links);
      if (linkErr) {
        setBusy(false);
        return setError(
          "Sale saved, but linking stands failed: " + linkErr.message
        );
      }
    }
    if (sourceFile) {
      const path = `${orgId}/timber_sale/${crypto.randomUUID()}-${sourceFile.name}`;
      const { error: upErr } = await supabase.storage
        .from("documents")
        .upload(path, sourceFile, { contentType: sourceFile.type });
      if (!upErr) {
        await supabase.from("documents").insert({
          organization_id: orgId,
          entity_type: "timber_sale",
          entity_id: data.id,
          file_name: sourceFile.name,
          storage_path: path,
          content_type: sourceFile.type,
          size_bytes: sourceFile.size,
        });
      }
    }
    router.push(`/timber-sales/${data.id}`);
  }

  const manualTotal = Array.from(checkedStands).reduce(
    (s, id) => s + (Number(manualPcts[id]) || 0),
    0
  );

  return (
    <div className="space-y-4">
      {unsure.length > 0 ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Amber fields are ones the AI was not confident about. Check them
          against the contract before saving.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Sale name</label>
          <input
            value={saleName}
            onChange={(e) => setSaleName(e.target.value)}
            placeholder="e.g. North tract 2026 thinning"
            className={inputClass + ring("sale_name")}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Buyer</label>
          <input
            value={buyerName}
            onChange={(e) => setBuyerName(e.target.value)}
            placeholder="Buyer name"
            className={inputClass + ring("buyer_name")}
          />
          <select
            value={buyerTenantId}
            onChange={(e) => setBuyerTenantId(e.target.value)}
            className={`${inputClass} mt-2`}
          >
            <option value="">Not linked to a tenant record</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                Link to: {t.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Sale type</label>
          <div className="grid grid-cols-2 gap-1.5">
            {(
              [
                ["lump_sum", "Lump sum"],
                ["pay_as_cut", "Pay as cut"],
              ] as Array<["lump_sum" | "pay_as_cut", string]>
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setSaleType(value)}
                className={
                  "rounded-lg border px-2 py-1.5 text-sm font-medium " +
                  (saleType === value
                    ? "border-kelly-500 bg-kelly-50 text-pine-900"
                    : "border-gray-300 bg-white text-gray-600") +
                  ring("sale_type")
                }
              >
                {label}
              </button>
            ))}
          </div>
          {saleType === "pay_as_cut" ? (
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={deliveredNet}
                onChange={(e) => setDeliveredNet(e.target.checked)}
                className="h-4 w-4 accent-kelly-500"
              />
              Delivered price sale (rates are NET of cut and haul)
            </label>
          ) : null}
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Harvest type
          </label>
          <select
            value={harvestType}
            onChange={(e) => setHarvestType(e.target.value)}
            className={inputClass + ring("harvest_type")}
          >
            <option value="">Not set</option>
            {Object.entries(HARVEST_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
            className={inputClass}
          >
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="expired">Expired</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Contract date</label>
          <input
            type="date"
            value={contractDate}
            onChange={(e) => setContractDate(e.target.value)}
            className={inputClass + ring("contract_date")}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Harvest deadline / expiration
          </label>
          <input
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className={inputClass + ring("harvest_deadline")}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Performance deposit ($)
          </label>
          <input
            type="number"
            step="0.01"
            value={deposit}
            onChange={(e) => setDeposit(e.target.value)}
            className={inputClass + ring("performance_deposit")}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Total sale acres
          </label>
          <input
            type="number"
            step="0.1"
            value={saleAcres}
            onChange={(e) => setSaleAcres(e.target.value)}
            className={inputClass + ring("sale_acres")}
          />
        </div>
      </div>

      {saleType === "lump_sum" ? (
        <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
          <div className="max-w-xs">
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Total sale price ($)
            </label>
            <input
              type="number"
              step="0.01"
              value={lumpPrice}
              onChange={(e) => setLumpPrice(e.target.value)}
              className={inputClass + ring("lump_sum_price")}
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className={"text-sm font-medium text-gray-700" + (unsure.includes("payment_schedule") ? " rounded bg-amber-100 px-1" : "")}>
                Payment schedule (if split; leave empty for one payment at closing)
              </label>
              <button
                type="button"
                onClick={() =>
                  setSchedule((s) => [
                    ...s,
                    { label: `Payment ${s.length + 1}`, due_date: "", amount: 0 },
                  ])
                }
                className="text-sm font-medium text-kelly-700 hover:underline"
              >
                + Add payment
              </button>
            </div>
            {schedule.map((row, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <input
                  value={row.label}
                  onChange={(e) =>
                    setSchedule((s) => s.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)))
                  }
                  className="w-32 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                />
                <input
                  type="date"
                  value={row.due_date}
                  onChange={(e) =>
                    setSchedule((s) => s.map((r, j) => (j === i ? { ...r, due_date: e.target.value } : r)))
                  }
                  className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                />
                <input
                  type="number"
                  step="0.01"
                  value={row.amount || ""}
                  onChange={(e) =>
                    setSchedule((s) => s.map((r, j) => (j === i ? { ...r, amount: Number(e.target.value) } : r)))
                  }
                  placeholder="Amount $"
                  className="w-28 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                />
                <button
                  type="button"
                  onClick={() => setSchedule((s) => s.filter((_, j) => j !== i))}
                  className="text-xs font-medium text-red-600 hover:underline"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
          <div className="flex items-center justify-between">
            <label className={"text-sm font-medium text-gray-700" + (unsure.includes("stumpage_rates") ? " rounded bg-amber-100 px-1" : "")}>
              {deliveredNet
                ? "Net rates by product (delivered minus cut and haul)"
                : "Stumpage rates by product"}
            </label>
            <span className="flex gap-3">
              <button
                type="button"
                onClick={addStandardRates}
                className="text-sm font-medium text-kelly-700 hover:underline"
              >
                Add standard products
              </button>
              <button
                type="button"
                onClick={() =>
                  setRates((r) => [
                    ...r,
                    { product: `custom_${r.length}`, label: "", rate: 0, unit: "ton", log_scale: null },
                  ])
                }
                className="text-sm font-medium text-kelly-700 hover:underline"
              >
                + Custom product
              </button>
            </span>
          </div>
          {rates.length === 0 ? (
            <p className="text-xs text-gray-500">
              No rates yet. Add the standard products or custom ones.
            </p>
          ) : (
            rates.map((rate, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <input
                  value={rate.label}
                  onChange={(e) => patchRate(i, { label: e.target.value })}
                  placeholder="Product"
                  className="w-40 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                />
                <span className="text-xs text-gray-500">$</span>
                <input
                  type="number"
                  step="0.01"
                  value={rate.rate || ""}
                  onChange={(e) => patchRate(i, { rate: Number(e.target.value) })}
                  className="w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                />
                <select
                  value={rate.unit}
                  onChange={(e) =>
                    patchRate(i, { unit: e.target.value as StumpageRate["unit"] })
                  }
                  className="rounded-lg border border-gray-300 px-1.5 py-1.5 text-xs"
                  title="Dollars per ton, or per thousand board feet for scaled sawtimber"
                >
                  <option value="ton">/ ton</option>
                  <option value="mbf">/ MBF</option>
                </select>
                {rate.unit === "mbf" ? (
                  <select
                    value={rate.log_scale ?? "doyle"}
                    onChange={(e) =>
                      patchRate(i, { log_scale: e.target.value as LogScale })
                    }
                    className="rounded-lg border border-gray-300 px-1.5 py-1.5 text-xs"
                    title="Log scale for board-foot measurement"
                  >
                    {Object.entries(LOG_SCALE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                ) : null}
                <button
                  type="button"
                  onClick={() => setRates((r) => r.filter((_, j) => j !== i))}
                  className="text-xs font-medium text-red-600 hover:underline"
                >
                  Remove
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {standOptions ? (
        <div className="space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
          <label className="text-sm font-medium text-gray-700">
            Timber stands this sale covers
          </label>
          {prefill?.tract_description ? (
            <p className="rounded-lg bg-white px-2.5 py-1.5 text-xs italic text-gray-600">
              Contract describes the land as: {'"'}
              {prefill.tract_description}
              {'"'}
            </p>
          ) : null}
          {standOptions.length === 0 ? (
            <p className="text-xs text-gray-500">
              No timber stands mapped yet; link them later from the sale page.
            </p>
          ) : (
            <div className="space-y-1">
              {standOptions.map((s) => (
                <div key={s.id} className="flex items-center gap-2 text-sm text-gray-800">
                  <label className="flex flex-1 cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={checkedStands.has(s.id)}
                      onChange={(e) =>
                        setCheckedStands((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(s.id);
                          else next.delete(s.id);
                          return next;
                        })
                      }
                      className="h-4 w-4 accent-kelly-500"
                    />
                    <span>
                      {s.name}
                      {s.propertyName ? (
                        <span className="text-gray-500"> · {s.propertyName}</span>
                      ) : null}
                      <span className="text-gray-500">
                        {" "}
                        · {formatAcres(s.acres)} ac
                      </span>
                    </span>
                    {suggestedStandIds.includes(s.id) ? (
                      <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                        Suggested from contract
                      </span>
                    ) : null}
                  </label>
                  {allocationMethod === "manual" && checkedStands.has(s.id) ? (
                    <span className="flex items-center gap-1 text-xs text-gray-600">
                      <input
                        type="number"
                        step="0.1"
                        value={manualPcts[s.id] ?? ""}
                        onChange={(e) =>
                          setManualPcts((p) => ({ ...p, [s.id]: e.target.value }))
                        }
                        placeholder="0"
                        className="w-16 rounded border border-gray-300 px-1.5 py-0.5 text-right text-xs"
                      />
                      %
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          )}
          {checkedStands.size > 0 ? (
            <div className="space-y-1 pt-1">
              <p className="text-xs font-medium text-gray-600">
                Allocate sale dollars across the linked stands
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ["by_acres", "By stand acres"],
                    ["manual", "Manual percentages"],
                    ["none", "Keep at sale level"],
                  ] as Array<[AllocationMethod, string]>
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setAllocationMethod(value)}
                    className={
                      "rounded-lg border px-2 py-1 text-xs font-medium " +
                      (allocationMethod === value
                        ? "border-kelly-500 bg-kelly-50 text-pine-900"
                        : "border-gray-300 bg-white text-gray-600")
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
              {allocationMethod === "manual" ? (
                <p className="text-xs text-gray-500">
                  Percentages total {Math.round(manualTotal * 10) / 10}%
                  {manualTotal < 100 ? "; the rest stays unallocated." : "."}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">Notes</label>
        <textarea
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className={inputClass + ring("notes")}
        />
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <button
        onClick={save}
        disabled={busy}
        className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-60"
      >
        {busy ? "Saving..." : sale ? "Save changes" : "Save timber sale"}
      </button>
    </div>
  );
}
