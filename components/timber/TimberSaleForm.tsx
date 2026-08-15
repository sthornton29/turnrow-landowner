"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  TIMBER_PRODUCTS,
  type StumpageRate,
  type TimberSchedulePayment,
} from "@/lib/leaseLogic";

export interface TimberPrefill {
  sale_name?: string | null;
  buyer_name?: string | null;
  sale_type?: "lump_sum" | "pay_as_cut" | null;
  contract_date?: string | null;
  harvest_deadline?: string | null;
  performance_deposit?: number | null;
  sale_acres?: number | null;
  lump_sum_price?: number | null;
  stumpage_rates?: StumpageRate[] | null;
  payment_schedule?: TimberSchedulePayment[] | null;
  notes?: string | null;
}

interface ExistingSale extends TimberPrefill {
  id: string;
  status: "active" | "completed" | "expired";
  buyer_tenant_id: string | null;
}

const inputClass = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";

export default function TimberSaleForm({
  orgId,
  tenants,
  sale,
  prefill,
  unsure = [],
  sourceFile,
}: {
  orgId: string;
  tenants: Array<{ id: string; name: string }>;
  sale?: ExistingSale | null;
  prefill?: TimberPrefill | null;
  unsure?: string[];
  sourceFile?: File | null;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const src = sale ?? prefill ?? {};

  const [saleName, setSaleName] = useState(src.sale_name ?? "");
  const [buyerName, setBuyerName] = useState(src.buyer_name ?? "");
  const [buyerTenantId, setBuyerTenantId] = useState(sale?.buyer_tenant_id ?? "");
  const [saleType, setSaleType] = useState<"lump_sum" | "pay_as_cut">(
    src.sale_type ?? "lump_sum"
  );
  const [status, setStatus] = useState(sale?.status ?? "active");
  const [contractDate, setContractDate] = useState(src.contract_date ?? "");
  const [deadline, setDeadline] = useState(src.harvest_deadline ?? "");
  const [deposit, setDeposit] = useState(String(src.performance_deposit ?? ""));
  const [saleAcres, setSaleAcres] = useState(String(src.sale_acres ?? ""));
  const [lumpPrice, setLumpPrice] = useState(String(src.lump_sum_price ?? ""));
  const [rates, setRates] = useState<StumpageRate[]>(src.stumpage_rates ?? []);
  const [schedule, setSchedule] = useState<TimberSchedulePayment[]>(
    src.payment_schedule ?? []
  );
  const [notes, setNotes] = useState(src.notes ?? "");
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
        price_per_ton: 0,
      })),
    ]);
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

    const { data, error: err } = await supabase
      .from("timber_sales")
      .insert(row)
      .select("id")
      .single();
    if (err || !data) {
      setBusy(false);
      return setError("Could not save: " + (err?.message ?? ""));
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
              Stumpage rates ($ per ton by product)
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
                    { product: `custom_${r.length}`, label: "", price_per_ton: 0 },
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
                  onChange={(e) =>
                    setRates((r) => r.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                  }
                  placeholder="Product"
                  className="w-44 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                />
                <span className="text-xs text-gray-500">$/ton</span>
                <input
                  type="number"
                  step="0.01"
                  value={rate.price_per_ton || ""}
                  onChange={(e) =>
                    setRates((r) =>
                      r.map((x, j) => (j === i ? { ...x, price_per_ton: Number(e.target.value) } : x))
                    )
                  }
                  className="w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                />
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
