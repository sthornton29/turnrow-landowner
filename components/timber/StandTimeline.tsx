"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatAcres, formatDollars } from "@/lib/format";
import {
  ACTIVITY_TYPES,
  TAX_CATEGORIES,
  TAX_NOTE,
  detailSummary,
  isActivityType,
  type ActivityType,
  type TaxCategory,
} from "@/lib/standActivities";
import {
  PLAN_NOTE,
  REC_STATUS_LABELS,
  windowText,
  type Recommendation,
} from "@/lib/timberPlan";
import type { StandActivityRow, TimberCostRow } from "@/types/db";
import EntityDocuments from "@/components/documents/EntityDocuments";
import ActivityForm, { newDraft, type ActivityDraft, type FormStand } from "./ActivityForm";

// A stand's past and future on one page: "Coming up" (the schedule from
// lib/timberPlan.ts, each with Record it / Schedule / Not needed), then
// the history (planned work first, then what was done, newest first),
// with costs and attached paperwork per activity.

export interface TimelineActivity extends StandActivityRow {
  standIds: string[];
  costs: TimberCostRow[];
}

const STATUS_CHIP: Record<string, string> = {
  overdue: "bg-red-100 text-red-800",
  due: "bg-amber-100 text-amber-900",
  scheduled: "bg-sky-100 text-sky-900",
  upcoming: "bg-kelly-100 text-pine-900",
  later: "bg-gray-100 text-gray-600",
};

function toDraft(a: TimelineActivity): ActivityDraft | null {
  if (!isActivityType(a.activity_type)) return null;
  const details: Record<string, string> = {};
  for (const [k, v] of Object.entries(a.details ?? {})) details[k] = String(v ?? "");
  return {
    id: a.id,
    activity_type: a.activity_type,
    status: a.status,
    activity_year: a.activity_year,
    activity_date: a.activity_date ?? "",
    title: a.title ?? "",
    notes: a.notes ?? "",
    performed_by: a.performed_by ?? "",
    acres_treated: a.acres_treated != null ? String(a.acres_treated) : "",
    timber_sale_id: a.timber_sale_id ?? "",
    plan_key: a.plan_key ?? "",
    details,
    standIds: a.standIds,
    costs: a.costs.map((c) => ({
      id: c.id,
      paid_date: c.paid_date,
      amount: String(c.amount),
      vendor: c.vendor ?? "",
      description: c.description ?? "",
      tax_category: (c.tax_category as TaxCategory) ?? "not_sure",
      cost_share_award_id: c.cost_share_award_id ?? "",
    })),
  };
}

export default function StandTimeline({
  orgId,
  standId,
  propertyId,
  stands,
  sales,
  awards = [],
  activities,
  recs,
}: {
  orgId: string;
  standId: string;
  propertyId: string;
  stands: FormStand[];
  sales: Array<{ id: string; sale_name: string }>;
  awards?: Array<{ id: string; title: string }>;
  activities: TimelineActivity[];
  recs: Recommendation[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [form, setForm] = useState<ActivityDraft | { standIds: string[] } | null>(null);
  const [docsOpen, setDocsOpen] = useState<string | null>(null);
  const [showSkipped, setShowSkipped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = new Date().getFullYear();
  const standName = new Map(stands.map((s) => [s.id, s.name]));

  const planned = activities
    .filter((a) => a.status === "planned")
    .sort((a, b) => a.activity_year - b.activity_year);
  const done = activities
    .filter((a) => a.status === "done")
    .sort(
      (a, b) =>
        b.activity_year - a.activity_year ||
        (b.activity_date ?? "").localeCompare(a.activity_date ?? "")
    );
  const skipped = activities.filter((a) => a.status === "skipped");

  const allCosts = activities.flatMap((a) => (a.status === "done" ? a.costs : []));
  const costTotal = allCosts.reduce((s, c) => s + Number(c.amount), 0);
  const byCategory = new Map<string, number>();
  for (const c of allCosts) {
    byCategory.set(c.tax_category, (byCategory.get(c.tax_category) ?? 0) + Number(c.amount));
  }

  function openForm(f: ActivityDraft | { standIds: string[] }) {
    setForm(f);
    setError(null);
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() =>
        document.getElementById("stand-activity-form")?.scrollIntoView({ behavior: "smooth", block: "start" })
      );
    }
  }

  async function notNeeded(r: Recommendation) {
    setError(null);
    const { error: err } = await supabase.rpc("save_stand_activity", {
      p: {
        property_id: propertyId,
        activity_type: r.activityType,
        status: "skipped",
        activity_year: now,
        title: `${r.title}: not needed`,
        plan_key: r.key,
        details: {},
        stands: [{ timber_stand_id: standId }],
        costs: [],
      },
    });
    if (err) setError(`Could not save: ${err.message}`);
    else router.refresh();
  }

  async function remove(a: TimelineActivity) {
    setError(null);
    const { count } = await supabase
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("entity_type", "stand_activity")
      .eq("entity_id", a.id);
    if ((count ?? 0) > 0) {
      setError("This activity has documents attached. Delete or move them first (Paperwork, then open each one).");
      return;
    }
    const others = a.standIds.filter((id) => id !== standId);
    const msg =
      others.length > 0
        ? `Delete "${a.title ?? "this activity"}"? It also covers ${others.map((id) => standName.get(id) ?? "another stand").join(", ")}, and will be removed there too, with its costs.`
        : `Delete "${a.title ?? "this activity"}" and its costs?`;
    if (!window.confirm(msg)) return;
    const { error: err } = await supabase.from("stand_activities").delete().eq("id", a.id);
    if (err) setError(`Could not delete: ${err.message}`);
    else router.refresh();
  }

  function renderActivity(a: TimelineActivity) {
    const type = isActivityType(a.activity_type) ? a.activity_type : ("other" as ActivityType);
    const def = ACTIVITY_TYPES[type];
    const summary = detailSummary(type, a.details);
    const others = a.standIds.filter((id) => id !== standId).map((id) => standName.get(id)).filter(Boolean);
    const total = a.costs.reduce((s, c) => s + Number(c.amount), 0);
    const draft = toDraft(a);
    const meta = [
      summary,
      a.performed_by ? `by ${a.performed_by}` : null,
      a.acres_treated != null ? `${formatAcres(a.acres_treated)} ac` : null,
      others.length > 0 ? `also ${others.join(", ")}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return (
      <li key={a.id} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="w-24 shrink-0 font-mono text-xs text-gray-500">
            {a.activity_date ?? a.activity_year}
          </span>
          <span className="font-medium text-gray-900">{a.title ?? def.label}</span>
          {a.status === "planned" ? (
            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-900">Planned</span>
          ) : null}
          {a.title && a.title !== def.label ? (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{def.label}</span>
          ) : null}
          {total > 0 ? <span className="ml-auto font-medium text-pine-900">{formatDollars(total)}</span> : null}
        </div>
        <div className="mt-0.5 space-y-0.5 text-gray-600">
          {meta ? <p>{meta}</p> : null}
          {a.costs.length > 0 ? (
            <p className="text-xs">
              {a.costs
                .map(
                  (c) =>
                    `${formatDollars(Number(c.amount))}${c.vendor ? ` to ${c.vendor}` : ""}${c.description ? ` for ${c.description}` : ""} (${TAX_CATEGORIES[c.tax_category as TaxCategory]?.short ?? c.tax_category})`
                )
                .join("; ")}
            </p>
          ) : null}
          {a.notes ? <p className="whitespace-pre-line text-gray-700">{a.notes}</p> : null}
          <div className="flex flex-wrap gap-3 pt-1 text-xs">
            {draft ? (
              <button onClick={() => openForm(draft)} className="font-medium text-kelly-700 hover:underline">
                Edit
              </button>
            ) : null}
            {a.status === "planned" && draft ? (
              <button
                onClick={() => openForm({ ...draft, status: "done", activity_year: now })}
                className="font-medium text-kelly-700 hover:underline"
              >
                Mark done
              </button>
            ) : null}
            <button
              onClick={() => setDocsOpen(docsOpen === a.id ? null : a.id)}
              className="font-medium text-kelly-700 hover:underline"
            >
              {docsOpen === a.id ? "Hide paperwork" : "Paperwork"}
            </button>
            <button onClick={() => remove(a)} className="text-red-600 hover:underline">
              Delete
            </button>
          </div>
          {docsOpen === a.id ? (
            <div className="mt-2 rounded-lg border border-gray-100 bg-gray-50 p-3">
              <EntityDocuments
                orgId={orgId}
                entityType="stand_activity"
                entityId={a.id}
                label={a.title ?? def.label}
              />
            </div>
          ) : null}
        </div>
      </li>
    );
  }

  return (
    <div className="space-y-5">
      {/* Coming up */}
      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-gray-900">Coming up</h2>
          <button
            onClick={() => openForm({ standIds: [standId] })}
            className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600"
          >
            Record work
          </button>
        </div>
        {recs.length === 0 ? (
          <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">
            Nothing suggested right now.
          </p>
        ) : (
          <ul className="space-y-2">
            {recs.map((r) => (
              <li key={r.key} className="rounded-xl border border-gray-200 bg-white p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CHIP[r.status]}`}>
                    {REC_STATUS_LABELS[r.status]}
                  </span>
                  <span className="font-semibold text-gray-900">{r.title}</span>
                  <span className="text-gray-500">{windowText(r)}</span>
                </div>
                <p className="mt-1 text-gray-600">{r.reason}</p>
                {r.setupOnly ? (
                  <p className="mt-1 text-xs text-gray-500">
                    Use Edit in the details above, or Record work, then Planted, with the year.
                  </p>
                ) : r.status === "scheduled" ? (
                  <p className="mt-1 text-xs text-gray-500">On the list below as planned work.</p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-3 text-xs">
                    {r.status === "later" ? null : (
                    <button
                      onClick={() =>
                        openForm(
                          newDraft(r.activityType, [standId], {
                            status: "done",
                            plan_key: r.key,
                            activity_year: Math.min(now, Math.max(r.windowStart, now - 50)),
                          })
                        )
                      }
                      className="font-semibold text-kelly-700 hover:underline"
                    >
                      Already done: record it
                    </button>
                    )}
                    <button
                      onClick={() =>
                        openForm(
                          newDraft(r.activityType, [standId], {
                            status: "planned",
                            plan_key: r.key,
                            activity_year: Math.max(r.windowStart, now),
                          })
                        )
                      }
                      className="font-semibold text-kelly-700 hover:underline"
                    >
                      Schedule it
                    </button>
                    <button onClick={() => notNeeded(r)} className="text-gray-500 hover:underline">
                      Not needed
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-xs text-gray-500">{PLAN_NOTE}</p>
      </section>

      {form ? (
        <div id="stand-activity-form">
          <ActivityForm
            key={"id" in form && form.id ? form.id : JSON.stringify(form).slice(0, 80)}
            propertyId={propertyId}
            stands={stands}
            sales={sales}
            awards={awards}
            initial={form}
            onClose={() => setForm(null)}
          />
        </div>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {/* History */}
      <section>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">
          History
          {costTotal > 0 ? (
            <span className="ml-2 text-sm font-normal text-gray-500">
              {formatDollars(costTotal)} in recorded costs
            </span>
          ) : null}
        </h2>
        {byCategory.size > 0 ? (
          <p className="mb-2 text-xs text-gray-500">
            {Array.from(byCategory.entries())
              .map(([k, v]) => `${TAX_CATEGORIES[k as TaxCategory]?.label ?? k}: ${formatDollars(v)}`)
              .join(" · ")}
            . {TAX_NOTE}
          </p>
        ) : null}
        {planned.length === 0 && done.length === 0 ? (
          <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">
            No history yet. Use <span className="font-semibold">Record work</span> for anything done
            here: when it was planted, sprayed, burned, or thinned. Even just the year helps.
          </p>
        ) : (
          <ul className="space-y-2">
            {planned.map(renderActivity)}
            {done.map(renderActivity)}
          </ul>
        )}
        {skipped.length > 0 ? (
          <div className="mt-2">
            <button
              onClick={() => setShowSkipped((v) => !v)}
              className="text-xs text-gray-500 hover:underline"
            >
              {showSkipped ? "Hide" : "Show"} {skipped.length} suggestion{skipped.length === 1 ? "" : "s"} marked not needed
            </button>
            {showSkipped ? <ul className="mt-2 space-y-2">{skipped.map(renderActivity)}</ul> : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
