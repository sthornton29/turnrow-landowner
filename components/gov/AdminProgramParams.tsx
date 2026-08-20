"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Platform-admin editor for the GLOBAL government payment parameters:
// program_year_config (per program year) and covered_commodities
// (statutory reference prices, loan rates), plus the per-year price rows
// (ERP, MYA final/manual, WASDE midpoint). RLS enforces the admin-only
// write policies; this UI is simply hidden from everyone else.

type ConfigRow = {
  crop_year: number;
  arc_guarantee_pct: number;
  arc_payment_cap_pct: number;
  erp_olympic_factor: number;
  erp_cap_pct: number;
  payment_factor: number;
  arc_ic_payment_factor: number;
  sequestration_pct: number;
};
type CommodityRow = {
  slug: string;
  name: string;
  unit: string;
  statutory_reference_price: number;
  national_loan_rate: number;
  marketing_year_start_month: number;
};
type PriceRow = {
  id?: string;
  commodity: string;
  program_year: number;
  effective_reference_price: number | null;
  mya_price_estimate: number | null;
  mya_price_final: number | null;
  wasde_midpoint: number | null;
  benchmark_price: number | null;
  source: string;
};

const cell = "w-full rounded border border-gray-300 px-1.5 py-0.5 text-right text-xs";

export default function AdminProgramParams({
  configs,
  commodities,
  prices,
}: {
  configs: ConfigRow[];
  commodities: CommodityRow[];
  prices: PriceRow[];
}) {
  const supabase = createClient();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState(new Date().getFullYear());

  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true);
    setError(null);
    const { error: err } = await fn();
    setBusy(false);
    if (err) setError(err.message);
    else router.refresh();
  }

  const priceFor = (slug: string): PriceRow =>
    prices.find((p) => p.commodity === slug && Number(p.program_year) === year) ?? {
      commodity: slug, program_year: year, effective_reference_price: null, mya_price_estimate: null,
      mya_price_final: null, wasde_midpoint: null, benchmark_price: null, source: "manual",
    };

  return (
    <div className="space-y-5 text-sm">
      {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">{error}</p> : null}

      <div>
        <h3 className="mb-1 font-semibold text-gray-900">Program year parameters</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="px-1 py-1">Year</th>
                <th className="px-1 py-1">ARC guar.</th>
                <th className="px-1 py-1">ARC cap</th>
                <th className="px-1 py-1">ERP factor</th>
                <th className="px-1 py-1">ERP cap</th>
                <th className="px-1 py-1">Pay factor</th>
                <th className="px-1 py-1">ARC-IC factor</th>
                <th className="px-1 py-1">Sequestration</th>
              </tr>
            </thead>
            <tbody>
              {configs.map((c) => (
                <tr key={c.crop_year}>
                  <td className="px-1 py-1 font-medium">{c.crop_year}</td>
                  {(["arc_guarantee_pct", "arc_payment_cap_pct", "erp_olympic_factor", "erp_cap_pct", "payment_factor", "arc_ic_payment_factor", "sequestration_pct"] as const).map((k) => (
                    <td key={k} className="px-1 py-1">
                      <input
                        defaultValue={Number(c[k])}
                        type="number"
                        step="0.001"
                        disabled={busy}
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (v !== Number(c[k])) run(() => supabase.from("program_year_config").update({ [k]: v }).eq("crop_year", c.crop_year));
                        }}
                        className={cell}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          disabled={busy}
          onClick={() => {
            const next = Math.max(...configs.map((c) => c.crop_year), new Date().getFullYear()) + 1;
            run(() => supabase.from("program_year_config").insert({ crop_year: next, notes: "Copied defaults" }));
          }}
          className="mt-1 text-xs font-medium text-kelly-700 hover:underline"
        >
          + Add the next program year (OBBBA defaults)
        </button>
      </div>

      <div>
        <h3 className="mb-1 font-semibold text-gray-900">Covered commodities (statutory reference price, loan rate)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="px-1 py-1">Commodity</th>
                <th className="px-1 py-1">Unit</th>
                <th className="px-1 py-1">Reference price</th>
                <th className="px-1 py-1">Loan rate</th>
                <th className="px-1 py-1">MY start</th>
              </tr>
            </thead>
            <tbody>
              {commodities.map((c) => (
                <tr key={c.slug}>
                  <td className="px-1 py-1 font-medium">{c.name}</td>
                  <td className="px-1 py-1 text-gray-500">{c.unit}</td>
                  {(["statutory_reference_price", "national_loan_rate", "marketing_year_start_month"] as const).map((k) => (
                    <td key={k} className="px-1 py-1">
                      <input
                        defaultValue={Number(c[k])}
                        type="number"
                        step="0.0001"
                        disabled={busy}
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (v !== Number(c[k])) run(() => supabase.from("covered_commodities").update({ [k]: v }).eq("slug", c.slug));
                        }}
                        className={cell}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center gap-2">
          <h3 className="font-semibold text-gray-900">Prices by program year</h3>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="rounded border border-gray-300 px-1.5 py-0.5 text-xs">
            {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 3 + i).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <p className="mb-1 text-xs text-gray-500">
          Final beats manual beats WASDE midpoint beats the NASS estimate. Editing the estimate here marks it manual so refreshes never overwrite it.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="px-1 py-1">Commodity</th>
                <th className="px-1 py-1">ERP (published)</th>
                <th className="px-1 py-1">MYA final</th>
                <th className="px-1 py-1">MYA manual/est.</th>
                <th className="px-1 py-1">WASDE midpoint</th>
                <th className="px-1 py-1">Benchmark price</th>
                <th className="px-1 py-1">Source</th>
              </tr>
            </thead>
            <tbody>
              {commodities.map((c) => {
                const p = priceFor(c.slug);
                const save = (patch: Partial<PriceRow>) =>
                  run(() =>
                    supabase.from("arc_plc_price_data").upsert(
                      {
                        commodity: c.slug, program_year: year,
                        effective_reference_price: p.effective_reference_price,
                        mya_price_final: p.mya_price_final,
                        mya_price_estimate: p.mya_price_estimate,
                        wasde_midpoint: p.wasde_midpoint,
                        benchmark_price: p.benchmark_price,
                        source: p.source,
                        ...patch,
                        updated_at: new Date().toISOString(),
                      },
                      { onConflict: "commodity,program_year" }
                    )
                  );
                const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));
                return (
                  <tr key={c.slug}>
                    <td className="px-1 py-1 font-medium">{c.name}</td>
                    <td className="px-1 py-1"><input defaultValue={p.effective_reference_price ?? ""} disabled={busy} onBlur={(e) => save({ effective_reference_price: numOrNull(e.target.value) })} className={cell} /></td>
                    <td className="px-1 py-1"><input defaultValue={p.mya_price_final ?? ""} disabled={busy} onBlur={(e) => save({ mya_price_final: numOrNull(e.target.value), source: numOrNull(e.target.value) == null ? p.source : "usda" })} className={cell} /></td>
                    <td className="px-1 py-1"><input defaultValue={p.mya_price_estimate ?? ""} disabled={busy} onBlur={(e) => { const v = numOrNull(e.target.value); if (v !== p.mya_price_estimate) save({ mya_price_estimate: v, source: v == null ? "estimate" : "manual" }); }} className={cell} /></td>
                    <td className="px-1 py-1"><input defaultValue={p.wasde_midpoint ?? ""} disabled={busy} onBlur={(e) => save({ wasde_midpoint: numOrNull(e.target.value) })} className={cell} /></td>
                    <td className="px-1 py-1"><input defaultValue={p.benchmark_price ?? ""} disabled={busy} onBlur={(e) => save({ benchmark_price: numOrNull(e.target.value) })} className={cell} /></td>
                    <td className="px-1 py-1 text-gray-500">{p.source}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
