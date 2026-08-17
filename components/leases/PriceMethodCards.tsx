"use client";

// Cards and flows for lease price methods on the year assumption panel.
// Every card SUGGESTS: "Use this price" fills the assumption input
// (amber until saved); nothing auto-saves.

import { useCallback, useEffect, useState } from "react";
import { formatDollars } from "@/lib/format";
import type { RmaCachedData } from "@/lib/rma";
import { resolveBenchmark, windowState } from "@/lib/rma";
import type { TenantPriceCard } from "@/lib/leasePricing";
import type { PriceRecipe, RmaBenchmarkConfig } from "@/lib/leaseLogic";
import {
  evaluateExpression,
  substituteExpression,
  validateExpression,
} from "@/lib/priceExpression";

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------
// Tenant average price
// ---------------------------------------------------------------------

export function TenantPriceCardView({
  card,
  onUse,
}: {
  card: TenantPriceCard;
  onUse?: (price: number) => void; // absent on flex (reference only)
}) {
  if (card.state === "no_connection") {
    return (
      <p className="text-xs text-gray-500">
        No farm connection covers this lease{"'"}s land, so the tenant{"'"}s
        average price is not available.
      </p>
    );
  }
  if (card.state === "scope_off") {
    return (
      <p className="text-xs text-gray-500">
        Your farmer has not shared projected prices.
      </p>
    );
  }
  if (card.state === "no_crop") {
    return (
      <p className="text-xs text-gray-500">
        Enter the crop first; prices are matched strictly by crop.
      </p>
    );
  }
  if (card.state === "no_price") {
    return (
      <p className="text-xs text-gray-500">
        Your farmer has not set a projected price for this crop yet.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-kelly-100 bg-kelly-50 px-2.5 py-1.5 text-sm">
      <span className="font-medium text-pine-900">
        {card.isFinal ? "Tenant's final average price" : "Tenant's average price"}:{" "}
        {formatDollars(card.price)} {card.unitLabel} ({card.crop})
      </span>
      <span
        className={
          "rounded-full px-2 py-0.5 text-xs font-medium " +
          (card.isFinal ? "bg-pine-800 text-white" : "bg-amber-100 text-amber-800")
        }
      >
        {card.isFinal ? "FINAL" : "PROJECTED"}
      </span>
      {card.asOf ? (
        <span className="text-xs text-gray-500">
          as of {new Date(card.asOf).toLocaleDateString()}
        </span>
      ) : null}
      {card.isFinal ? (
        <span className="text-xs text-gray-600">
          Marked complete by your farmer; this is the settlement number.
        </span>
      ) : null}
      {onUse ? (
        <button
          onClick={() => onUse(round2(card.price))}
          className="rounded-lg border border-kelly-500 px-2 py-1 text-xs font-medium text-kelly-700 hover:bg-kelly-100"
        >
          Use this price
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------
// RMA benchmark (fetches the cached public data via /api/rma-price)
// ---------------------------------------------------------------------

export interface RmaFetchState {
  loading: boolean;
  error: string | null;
  data: (RmaCachedData & { stale?: boolean; stale_reason?: string }) | null;
}

export function useRmaPrice(crop: string | null, state: string, year: number) {
  const [result, setResult] = useState<RmaFetchState>({
    loading: false,
    error: null,
    data: null,
  });
  const fetchIt = useCallback(async () => {
    if (!crop) return;
    setResult((r) => ({ ...r, loading: true, error: null }));
    try {
      const res = await fetch("/api/rma-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ crop, state, year }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "RMA lookup failed.");
      setResult({ loading: false, error: null, data: body });
    } catch (err) {
      setResult({
        loading: false,
        error: err instanceof Error ? err.message : "RMA lookup failed.",
        data: null,
      });
    }
  }, [crop, state, year]);
  useEffect(() => {
    fetchIt();
  }, [fetchIt]);
  return result;
}

function componentLine(
  label: string,
  side: { price: number | null; status: string; begin: string | null; end: string | null } | null,
  unitLabel: string
): string {
  if (!side) return `${label}: n/a`;
  const state = windowState(side.status, side.begin, side.end, new Date());
  return side.price !== null
    ? `${label} ${formatDollars(side.price)} ${unitLabel} (${state})`
    : `${label}: ${state}`;
}

export function RmaBenchmarkCard({
  config,
  year,
  onUse,
}: {
  config: RmaBenchmarkConfig;
  year: number;
  onUse?: (price: number) => void;
}) {
  const { loading, error, data } = useRmaPrice(config.crop, config.state, year);
  if (loading) return <p className="text-xs text-gray-500">Checking RMA prices...</p>;
  if (error) return <p className="text-xs text-amber-700">{error}</p>;
  if (!data) return null;
  if (data.no_offer) {
    return (
      <p className="text-xs text-gray-500">
        RMA lists no offer for {config.crop} in {config.state}.
      </p>
    );
  }
  const resolved = resolveBenchmark(data, config.formula);
  return (
    <div className="space-y-1 rounded-lg border border-kelly-100 bg-kelly-50 px-2.5 py-1.5 text-sm">
      <p className="text-xs text-gray-600">
        RMA {config.crop} ({config.state} {year}):{" "}
        {componentLine("Projected", data.projected, data.unit_label)}
        {" / "}
        {componentLine("Harvest", data.harvest, data.unit_label)}
        {data.stale ? " (cached value; RMA is unreachable right now)" : ""}
      </p>
      <p className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-pine-900">
          {config.formula === "average"
            ? "Average of projected and harvest"
            : config.formula === "projected"
              ? "Projected price"
              : "Harvest price"}
          :{" "}
          {resolved.result !== null
            ? `${formatDollars(resolved.result)} ${data.unit_label}`
            : "not available yet"}
        </span>
        {resolved.result !== null && onUse ? (
          <button
            onClick={() => onUse(round2(resolved.result!))}
            className="rounded-lg border border-kelly-500 px-2 py-1 text-xs font-medium text-kelly-700 hover:bg-kelly-100"
          >
            Use this price
          </button>
        ) : null}
      </p>
      {resolved.note ? <p className="text-xs text-amber-800">{resolved.note}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------
// Custom recipe: yearly computation
// ---------------------------------------------------------------------

export function RecipeComputeCard({
  recipe,
  year,
  crop,
  rmaState,
  tenantCard,
  onUse,
}: {
  recipe: PriceRecipe;
  year: number;
  crop: string | null;
  rmaState: string;
  tenantCard: TenantPriceCard;
  onUse?: (price: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [manualValues, setManualValues] = useState<Record<string, string>>({});
  const needsRma = recipe.inputs.some(
    (i) => i.source === "rma_projected" || i.source === "rma_harvest"
  );
  const rma = useRmaPrice(open && needsRma ? (crop ?? "corn") : null, rmaState, year);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg border border-kelly-500 px-2 py-1 text-xs font-medium text-kelly-700 hover:bg-kelly-50"
      >
        Compute price ({recipe.description.slice(0, 60)}
        {recipe.description.length > 60 ? "..." : ""})
      </button>
    );
  }

  // Resolve each input: auto sources fill with labels, manual inputs are
  // typed by the user with the recipe's guidance shown.
  const values: Record<string, number> = {};
  const unresolved: string[] = [];
  for (const input of recipe.inputs) {
    if (input.source === "manual") {
      const raw = manualValues[input.name];
      if (raw !== undefined && raw.trim() !== "" && Number.isFinite(Number(raw))) {
        values[input.name.toLowerCase()] = Number(raw);
      } else unresolved.push(input.name);
    } else if (input.source === "tenant_average") {
      if (tenantCard.state === "price") {
        values[input.name.toLowerCase()] = tenantCard.price;
      } else unresolved.push(input.name);
    } else {
      const side = input.source === "rma_projected" ? rma.data?.projected : rma.data?.harvest;
      if (side?.price !== null && side?.price !== undefined) {
        values[input.name.toLowerCase()] = side.price;
      } else unresolved.push(input.name);
    }
  }

  let computed: number | null = null;
  let computeError: string | null = null;
  if (unresolved.length === 0) {
    try {
      computed = evaluateExpression(recipe.expression, values);
    } catch (err) {
      computeError = err instanceof Error ? err.message : "Could not compute.";
    }
  }

  const sourceLabel = (source: string) =>
    source === "rma_projected"
      ? "RMA projected"
      : source === "rma_harvest"
        ? "RMA harvest"
        : source === "tenant_average"
          ? "tenant's average"
          : "manual";

  return (
    <div className="w-full space-y-2 rounded-lg border border-kelly-100 bg-kelly-50 p-2.5 text-sm">
      <p className="text-xs text-gray-600">{recipe.description}</p>
      {recipe.inputs.map((input) => (
        <div key={input.name} className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-gray-800">{input.label}</span>
          <span className="text-xs text-gray-500">({sourceLabel(input.source)})</span>
          {input.source === "manual" ? (
            <input
              type="number"
              step="0.0001"
              value={manualValues[input.name] ?? ""}
              onChange={(e) =>
                setManualValues((v) => ({ ...v, [input.name]: e.target.value }))
              }
              placeholder="Enter"
              className="w-28 rounded-lg border border-gray-300 px-2 py-1 text-sm"
            />
          ) : values[input.name.toLowerCase()] !== undefined ? (
            <span className="text-pine-900">
              {formatDollars(values[input.name.toLowerCase()])}
            </span>
          ) : (
            <span className="text-xs text-amber-700">
              not available yet{rma.loading ? " (checking...)" : ""}
            </span>
          )}
          {input.guidance ? (
            <span className="w-full text-xs text-gray-500 sm:w-auto">{input.guidance}</span>
          ) : null}
        </div>
      ))}
      {computed !== null ? (
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-pine-900">
            {substituteExpression(recipe.expression, values)} ={" "}
            {formatDollars(round2(computed))}
          </span>
          {onUse ? (
            <button
              onClick={() => onUse(round2(computed!))}
              className="rounded-lg border border-kelly-500 px-2 py-1 text-xs font-medium text-kelly-700 hover:bg-kelly-100"
            >
              Use this price
            </button>
          ) : null}
        </p>
      ) : computeError ? (
        <p className="text-xs text-red-600">{computeError}</p>
      ) : (
        <p className="text-xs text-gray-500">
          Fill the remaining inputs to compute. The same recipe and inputs
          always produce the same number.
        </p>
      )}
      <button onClick={() => setOpen(false)} className="text-xs text-gray-500 hover:underline">
        Close
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------
// Custom recipe: setup / edit (AI designs once, user reviews, then the
// app computes deterministically every year)
// ---------------------------------------------------------------------

export function RecipeEditor({
  initialClause,
  recipe,
  onSave,
  onCancel,
}: {
  initialClause: string;
  recipe: PriceRecipe | null;
  onSave: (recipe: PriceRecipe) => Promise<void>;
  onCancel: () => void;
}) {
  const [clause, setClause] = useState(initialClause);
  const [draft, setDraft] = useState<PriceRecipe | null>(recipe);
  const [designing, setDesigning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function design() {
    setDesigning(true);
    setError(null);
    try {
      const res = await fetch("/api/price-recipe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clause }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Recipe design failed.");
      setDraft(body.recipe as PriceRecipe);
      if (body.expression_error) setError("Check the formula: " + body.expression_error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Recipe design failed.");
    } finally {
      setDesigning(false);
    }
  }

  function updateInput(i: number, patch: Partial<PriceRecipe["inputs"][number]>) {
    setDraft((d) =>
      d
        ? {
            ...d,
            inputs: d.inputs.map((input, j) => (j === i ? { ...input, ...patch } : input)),
          }
        : d
    );
  }

  async function save() {
    if (!draft) return;
    const check = validateExpression(
      draft.expression,
      draft.inputs.map((i) => i.name)
    );
    if (!check.ok) {
      setError("The formula is not valid: " + check.error);
      return;
    }
    setSaving(true);
    setError(null);
    await onSave(draft);
    setSaving(false);
  }

  return (
    <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
      <p className="text-xs text-amber-900">
        The AI structures the clause into inputs and a formula; it does not
        fetch bespoke market data. Anything it cannot source automatically
        becomes a manual entry with guidance. Review everything; nothing
        saves until you confirm.
      </p>
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          Pricing clause from the lease
        </label>
        <textarea
          rows={3}
          value={clause}
          onChange={(e) => setClause(e.target.value)}
          placeholder='e.g. "the average of the Wednesday closing prices of December corn futures during October, plus ten cents"'
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          onClick={design}
          disabled={designing || clause.trim().length < 10}
          className="mt-1 rounded-lg bg-kelly-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-60"
        >
          {designing ? "Designing..." : draft ? "Redesign from clause" : "Design recipe"}
        </button>
      </div>

      {draft ? (
        <div className="space-y-2 rounded-lg border border-amber-300 bg-white p-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">
              Plain-language description
            </label>
            <input
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              className="w-full rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-sm"
            />
          </div>
          <label className="block text-xs font-medium text-gray-700">Inputs</label>
          {draft.inputs.map((input, i) => (
            <div key={i} className="flex flex-wrap items-center gap-1.5">
              <input
                value={input.name}
                onChange={(e) => updateInput(i, { name: e.target.value })}
                className="w-32 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 font-mono text-xs"
                title="Identifier used in the formula"
              />
              <input
                value={input.label}
                onChange={(e) => updateInput(i, { label: e.target.value })}
                className="w-40 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-xs"
              />
              <select
                value={input.source}
                onChange={(e) =>
                  updateInput(i, {
                    source: e.target.value as PriceRecipe["inputs"][number]["source"],
                  })
                }
                className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-xs"
              >
                <option value="manual">Manual entry</option>
                <option value="rma_projected">RMA projected</option>
                <option value="rma_harvest">RMA harvest</option>
                <option value="tenant_average">Tenant's average</option>
              </select>
              <input
                value={input.guidance ?? ""}
                onChange={(e) => updateInput(i, { guidance: e.target.value || null })}
                placeholder="Where the number comes from"
                className="min-w-40 flex-1 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-xs"
              />
            </div>
          ))}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">
              Formula (inputs, numbers, + - * / and parentheses)
            </label>
            <input
              value={draft.expression}
              onChange={(e) => setDraft({ ...draft, expression: e.target.value })}
              className="w-full rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 font-mono text-sm"
            />
          </div>
        </div>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={saving || !draft}
          className="rounded-lg bg-kelly-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-60"
        >
          {saving ? "Saving..." : "Confirm and save recipe"}
        </button>
        <button onClick={onCancel} className="text-sm text-gray-600 hover:underline">
          Cancel
        </button>
      </div>
    </div>
  );
}
