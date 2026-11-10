"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatAcres, formatDollars } from "@/lib/format";
import {
  ACTIVITY_BUTTON_ORDER,
  ACTIVITY_TYPES,
  TAX_CATEGORIES,
  TAX_NOTE,
  cleanDetails,
  defaultTitle,
  taxCategoryFor,
  type ActivityStatus,
  type ActivityType,
  type TaxCategory,
} from "@/lib/standActivities";

// "WHAT HAPPENED HERE?" Record (or schedule) work on one or more stands
// of a property, with its costs. Step 1 is a grid of plain buttons;
// step 2 a short form with the type's extra facts behind "More
// details". Saved in one call through save_stand_activity (migration
// 0045), so an activity, its stands, and its costs land together.

export interface FormStand {
  id: string;
  name: string;
  acres: number | null;
  year_established: number | null;
}

export interface FormCost {
  id?: string;
  paid_date: string;
  amount: string;
  vendor: string;
  description: string;
  tax_category: TaxCategory;
  cost_share_award_id?: string;
}

export interface ActivityDraft {
  id?: string;
  activity_type: ActivityType;
  status: ActivityStatus;
  activity_year: number;
  activity_date: string;
  title: string;
  notes: string;
  performed_by: string;
  acres_treated: string;
  timber_sale_id: string;
  plan_key: string;
  details: Record<string, string>;
  standIds: string[];
  costs: FormCost[];
}

export function newDraft(
  type: ActivityType,
  standIds: string[],
  over: Partial<ActivityDraft> = {}
): ActivityDraft {
  return {
    activity_type: type,
    status: "done",
    activity_year: new Date().getFullYear(),
    activity_date: "",
    title: "",
    notes: "",
    performed_by: "",
    acres_treated: "",
    timber_sale_id: "",
    plan_key: "",
    details: {},
    standIds,
    costs: [],
    ...over,
  };
}

const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm";
const labelCls = "mb-0.5 block text-xs font-medium text-gray-600";

export default function ActivityForm({
  propertyId,
  stands,
  sales,
  awards = [],
  initial,
  onClose,
}: {
  propertyId: string;
  stands: FormStand[];
  sales: Array<{ id: string; sale_name: string }>;
  awards?: Array<{ id: string; title: string }>;
  initial: ActivityDraft | { standIds: string[] }; // a draft, or just "start here"
  onClose: () => void;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [draft, setDraft] = useState<ActivityDraft | null>(
    "activity_type" in initial ? initial : null
  );
  const startStands = initial.standIds;
  const [showMore, setShowMore] = useState(
    "activity_type" in initial && Object.keys(initial.details).length > 0
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const standById = useMemo(() => new Map(stands.map((s) => [s.id, s])), [stands]);
  const selectedAcres = (draft?.standIds ?? []).reduce(
    (sum, id) => sum + (standById.get(id)?.acres ?? 0),
    0
  );

  function pick(type: ActivityType) {
    setDraft(newDraft(type, startStands));
    setShowMore(false);
  }

  function set<K extends keyof ActivityDraft>(key: K, value: ActivityDraft[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }

  function suggestedTax(d: ActivityDraft): TaxCategory {
    const firstStand = standById.get(d.standIds[0] ?? "");
    return taxCategoryFor(d.activity_type, firstStand?.year_established, d.activity_year);
  }

  function addCost() {
    if (!draft) return;
    set("costs", [
      ...draft.costs,
      {
        paid_date: draft.activity_date || `${draft.activity_year}-12-31`,
        amount: "",
        vendor: draft.performed_by,
        description: "",
        tax_category: suggestedTax(draft),
      },
    ]);
  }

  function setCost(i: number, patch: Partial<FormCost>) {
    if (!draft) return;
    set(
      "costs",
      draft.costs.map((c, j) => (j === i ? { ...c, ...patch } : c))
    );
  }

  async function save() {
    if (!draft) return;
    setError(null);
    if (draft.standIds.length === 0) {
      setError("Pick at least one stand.");
      return;
    }
    const year = draft.activity_date ? Number(draft.activity_date.slice(0, 4)) : draft.activity_year;
    if (!Number.isInteger(year) || year < 1900 || year > 2200) {
      setError("Enter a year.");
      return;
    }
    const costs = [];
    for (const c of draft.costs) {
      const amount = Number(c.amount.replace(/[$,]/g, ""));
      if (c.amount.trim() === "" && !c.vendor && !c.description) continue; // empty row
      if (!Number.isFinite(amount) || amount < 0) {
        setError("Each cost needs a dollar amount.");
        return;
      }
      if (!c.paid_date) {
        setError("Each cost needs the date it was paid.");
        return;
      }
      costs.push({
        ...c,
        amount: Math.round(amount * 100) / 100,
        cost_share_award_id: c.cost_share_award_id || null,
      });
    }
    const details = cleanDetails(draft.activity_type, draft.details);
    const acres = draft.acres_treated.trim() === "" ? null : Number(draft.acres_treated.replace(/,/g, ""));
    const payload = {
      id: draft.id ?? null,
      property_id: propertyId,
      activity_type: draft.activity_type,
      status: draft.status,
      activity_year: year,
      activity_date: draft.activity_date || null,
      title: draft.title.trim() || defaultTitle(draft.activity_type, details),
      notes: draft.notes.trim(),
      performed_by: draft.performed_by.trim(),
      acres_treated: acres !== null && Number.isFinite(acres) ? acres : null,
      timber_sale_id: draft.timber_sale_id || null,
      plan_key: draft.plan_key || null,
      details,
      stands: draft.standIds.map((id) => ({
        timber_stand_id: id,
        acres: standById.get(id)?.acres ?? null,
      })),
      costs,
    };
    setBusy(true);
    const { error: err } = await supabase.rpc("save_stand_activity", { p: payload });
    setBusy(false);
    if (err) {
      setError(`Could not save: ${err.message}`);
      return;
    }
    onClose();
    router.refresh();
  }

  // ---------------------------------------------------------------- step 1
  if (!draft) {
    return (
      <div className="rounded-xl border border-kelly-200 bg-kelly-50/40 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">What happened here?</h3>
          <button onClick={onClose} className="text-sm text-gray-500 hover:underline">
            Cancel
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
          {ACTIVITY_BUTTON_ORDER.map((t) => (
            <button
              key={t}
              onClick={() => pick(t)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-left hover:border-kelly-500 hover:bg-kelly-50"
            >
              <span className="block text-sm font-semibold text-gray-900">
                {ACTIVITY_TYPES[t].button}
              </span>
              <span className="block text-xs text-gray-500">{ACTIVITY_TYPES[t].hint}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- step 2
  const def = ACTIVITY_TYPES[draft.activity_type];
  const costTotal = draft.costs.reduce(
    (s, c) => s + (Number(c.amount.replace(/[$,]/g, "")) || 0),
    0
  );

  return (
    <div className="space-y-3 rounded-xl border border-kelly-200 bg-kelly-50/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-gray-900">
          {draft.id ? "Edit: " : ""}
          {def.label}
        </h3>
        <div className="flex items-center gap-3 text-sm">
          {!draft.id ? (
            <button onClick={() => setDraft(null)} className="text-kelly-700 hover:underline">
              Change type
            </button>
          ) : null}
          <button onClick={onClose} className="text-gray-500 hover:underline">
            Cancel
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["done", "planned"] as const).map((s) => (
          <button
            key={s}
            onClick={() => set("status", s)}
            className={`rounded-full px-3 py-1 text-sm font-medium ${
              draft.status === s ? "bg-pine-800 text-white" : "border border-gray-300 bg-white text-gray-700"
            }`}
          >
            {s === "done" ? "Already done" : "Planning to do it"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className={labelCls}>Year</label>
          <input
            type="number"
            value={draft.activity_date ? draft.activity_date.slice(0, 4) : draft.activity_year}
            disabled={!!draft.activity_date}
            onChange={(e) => set("activity_year", Number(e.target.value))}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Exact date (if you know it)</label>
          <input
            type="date"
            value={draft.activity_date}
            onChange={(e) => set("activity_date", e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Done by</label>
          <input
            value={draft.performed_by}
            onChange={(e) => set("performed_by", e.target.value)}
            placeholder="Contractor, forester, or family"
            className={inputCls}
          />
        </div>
      </div>

      <div>
        <label className={labelCls}>Which stands</label>
        <div className="flex flex-wrap gap-2">
          {stands.map((s) => {
            const on = draft.standIds.includes(s.id);
            return (
              <button
                key={s.id}
                onClick={() =>
                  set(
                    "standIds",
                    on ? draft.standIds.filter((x) => x !== s.id) : [...draft.standIds, s.id]
                  )
                }
                className={`rounded-full px-3 py-1 text-sm ${
                  on ? "bg-kelly-600 text-white" : "border border-gray-300 bg-white text-gray-700"
                }`}
              >
                {s.name}
                {s.acres != null ? ` · ${formatAcres(s.acres)} ac` : ""}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className={labelCls}>Acres worked</label>
          <input
            value={draft.acres_treated}
            onChange={(e) => set("acres_treated", e.target.value)}
            placeholder={selectedAcres > 0 ? `${formatAcres(selectedAcres)} (all of it)` : ""}
            className={inputCls}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>Short title</label>
          <input
            value={draft.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder={defaultTitle(draft.activity_type, draft.details)}
            className={inputCls}
          />
        </div>
      </div>

      {def.linksSale && sales.length > 0 ? (
        <div>
          <label className={labelCls}>Timber sale</label>
          <select
            value={draft.timber_sale_id}
            onChange={(e) => set("timber_sale_id", e.target.value)}
            className={inputCls}
          >
            <option value="">Not linked to a sale</option>
            {sales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.sale_name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {def.details.length > 0 ? (
        <div>
          <button
            onClick={() => setShowMore((v) => !v)}
            className="text-sm font-medium text-kelly-700 hover:underline"
          >
            {showMore ? "Fewer details" : "More details"}
          </button>
          {showMore ? (
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {def.details.map((f) => (
                <div key={f.key}>
                  <label className={labelCls}>{f.label}</label>
                  {f.input === "select" ? (
                    <select
                      value={draft.details[f.key] ?? ""}
                      onChange={(e) => set("details", { ...draft.details, [f.key]: e.target.value })}
                      className={inputCls}
                    >
                      <option value="">Choose</option>
                      {Object.entries(f.options ?? {}).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={f.input === "number" ? "number" : "text"}
                      value={draft.details[f.key] ?? ""}
                      placeholder={f.placeholder}
                      onChange={(e) => set("details", { ...draft.details, [f.key]: e.target.value })}
                      className={inputCls}
                    />
                  )}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div>
        <label className={labelCls}>Notes</label>
        <textarea
          rows={2}
          value={draft.notes}
          onChange={(e) => set("notes", e.target.value)}
          className={inputCls}
        />
      </div>

      {/* Costs */}
      <div className="rounded-lg border border-gray-200 bg-white p-3">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-sm font-semibold text-gray-900">
            What it cost{costTotal > 0 ? `: ${formatDollars(costTotal)}` : ""}
          </h4>
          <button onClick={addCost} className="text-sm font-medium text-kelly-700 hover:underline">
            + Add a cost
          </button>
        </div>
        {draft.costs.length === 0 ? (
          <p className="text-xs text-gray-500">
            Add the bills for this work (seedlings, spraying, the burn crew, the forester). Costs
            are what lower your taxes when timber is sold or trees are replanted.
          </p>
        ) : (
          <div className="space-y-3">
            {draft.costs.map((c, i) => (
              <div key={i} className="space-y-2 border-t border-gray-100 pt-2 first:border-0 first:pt-0">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <input
                    value={c.amount}
                    onChange={(e) => setCost(i, { amount: e.target.value })}
                    placeholder="Amount $"
                    inputMode="decimal"
                    className={inputCls}
                  />
                  <input
                    type="date"
                    value={c.paid_date}
                    onChange={(e) => setCost(i, { paid_date: e.target.value })}
                    className={inputCls}
                    title="Date paid"
                  />
                  <input
                    value={c.vendor}
                    onChange={(e) => setCost(i, { vendor: e.target.value })}
                    placeholder="Paid to"
                    className={inputCls}
                  />
                  <input
                    value={c.description}
                    onChange={(e) => setCost(i, { description: e.target.value })}
                    placeholder="For (seedlings, labor...)"
                    className={inputCls}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-xs text-gray-600">This cost was for:</label>
                  <select
                    value={c.tax_category}
                    onChange={(e) => setCost(i, { tax_category: e.target.value as TaxCategory })}
                    className="min-w-0 flex-1 rounded-lg border border-gray-300 px-2 py-1 text-xs"
                  >
                    {Object.entries(TAX_CATEGORIES).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.question}
                      </option>
                    ))}
                  </select>
                  {awards.length > 0 ? (
                    <select
                      value={c.cost_share_award_id ?? ""}
                      onChange={(e) => setCost(i, { cost_share_award_id: e.target.value })}
                      className="rounded-lg border border-gray-300 px-2 py-1 text-xs"
                      title="Cost-share that helped pay this"
                    >
                      <option value="">No cost-share</option>
                      {awards.map((a) => (
                        <option key={a.id} value={a.id}>
                          Cost-share: {a.title}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  <button
                    onClick={() => set("costs", draft.costs.filter((_, j) => j !== i))}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
            <p className="text-xs text-gray-500">{TAX_NOTE}</p>
          </div>
        )}
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <button
          onClick={onClose}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          onClick={save}
          disabled={busy}
          className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-50"
        >
          {busy ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}
