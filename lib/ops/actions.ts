// Ops actions (2026-11-09): the write half of the ops API, per
// turnrow-farm docs/OPS_ACTIONS.md. An Assignment in Turnrow Farm finds
// something wrong here, previews a fix with one of these actions, and a
// person confirms it on the assignment's page; Farm then calls apply with
// the preview's fingerprint and an idempotency key.
//
// Every action is one specific fix, made with the same writes the app's
// own pages make (the lease page's land links and assumptions, the lease
// form's dates, tenant and payment schedule, the tax upload's dates), so
// an action can never leave a record the app's screens could not. None
// records a payment received, deletes a row with money against it, or
// sends anything anywhere. Reads and writes go through the service role,
// always filtered by the one organization OPS_ORG names.
//
// Expected payments: Land projects a lease year's rent from the lease's
// terms, its payment schedule and the year's assumptions (lib/leaseLogic.ts
// generateLeasePayments), and lib/income.ts lets stored expected_payments
// rows for a (lease, year) win over that projection once any exist. So a
// crop share year is fixed either by its assumptions (the projection) or,
// when the payment dates do not fit the yearly schedule (a final payment
// the following July), by setting the year's expected payments directly.

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  annualRent,
  cropAssumptions,
  isGovShareLabel,
  normalizeCropEntries,
  type CropAssumption,
  type CropPractice,
  type LeaseLike,
  type SchedulePayment,
  type YearAssumptions,
} from "@/lib/leaseLogic";
import { OPS_APP, OPS_LABEL } from "./auth";

export interface ActionParam {
  name: string;
  type: "string" | "integer" | "number" | "boolean" | "date" | "array" | "object";
  required: boolean;
  description: string;
  enum?: string[];
}

export interface ActionDef {
  name: string;
  description: string;
  params: ActionParam[];
}

export interface Preview {
  app: string;
  action: string;
  params: Record<string, unknown>;
  headline: string;
  columns: string[];
  rows: Array<Array<string | number | null>>;
  notes: string[];
  changes: number;
  fingerprint: string;
  url: string;
}

// A refusal with its HTTP status: 400 bad action or params, 422 the app's
// rules say no.
export class ActionError extends Error {
  constructor(public status: 400 | 422, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

type Row = Record<string, unknown>;
type Db = SupabaseClient;

interface Ctx { client: Db; orgId: string; base: string }

// What one action does: read and check (plan), then write (apply). The
// plan carries the normalized params, the before-state that goes into the
// fingerprint, the table a person reads, and what apply needs.
interface Plan {
  params: Record<string, unknown>;
  before: unknown;
  headline: string;
  columns: string[];
  rows: Preview["rows"];
  notes: string[];
  changes: number;
  path: string;
  write: () => Promise<Record<string, unknown>>;
}

interface Action extends ActionDef {
  plan: (ctx: Ctx, params: Row) => Promise<Plan>;
}

const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const r2 = (n: number) => Math.round(n * 100) / 100;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function validDate(s: unknown): s is string {
  if (typeof s !== "string" || !ISO.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function fingerprintOf(action: string, params: unknown, before: unknown): string {
  return createHash("sha256").update(JSON.stringify({ action, params, before })).digest("hex").slice(0, 32);
}

async function rows(q: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<Row[]> {
  const { data, error } = await q;
  if (error) throw new Error(`Could not read ${what}: ${error.message}`);
  return (data ?? []) as Row[];
}

async function must(q: PromiseLike<{ error: { message: string } | null }>, what: string): Promise<void> {
  const { error } = await q;
  if (error) throw new Error(`Could not ${what}: ${error.message}`);
}

function str(p: Row, name: string, required = true): string | null {
  const v = p[name];
  if (v === undefined || v === null || v === "") {
    if (required) throw new ActionError(400, `${name} is needed.`);
    return null;
  }
  if (typeof v !== "string") throw new ActionError(400, `${name} must be text.`);
  return v.trim();
}

function int(p: Row, name: string, min: number, max: number): number {
  const v = Number(p[name]);
  if (!Number.isInteger(v) || v < min || v > max) throw new ActionError(400, `${name} must be a whole number from ${min} to ${max}.`);
  return v;
}

function numOrNull(v: unknown, name: string, min = 0): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min) throw new ActionError(400, `${name} must be a number of at least ${min}.`);
  return n;
}

// Resolve one record by id or exact name (case-insensitive), within the
// organization. More than one name match is refused rather than guessed.
async function resolve(ctx: Ctx, table: string, label: string, key: string, nameCol: string, cols: string): Promise<Row> {
  const all = await rows(ctx.client.from(table).select(cols).eq("organization_id", ctx.orgId), table);
  const byId = all.find((r) => r.id === key);
  if (byId) return byId;
  const lower = key.toLowerCase();
  const named = all.filter((r) => String(r[nameCol] ?? "").trim().toLowerCase() === lower);
  if (named.length === 1) return named[0];
  if (named.length > 1) throw new ActionError(400, `More than one ${label} is named "${key}"; give its id.`);
  throw new ActionError(400, `No ${label} "${key}" in Turnrow Land.`);
}

const LEASE_COLS = "id, name, tenant_id, lease_type, rent_structure, status, terms, payment_schedule, start_date, end_date";
const leaseOf = (ctx: Ctx, p: Row) => resolve(ctx, "leases", "lease", str(p, "lease")!, "name", LEASE_COLS);
const leasePath = (id: unknown) => `/leases/${String(id)}`;

async function leasedAcres(ctx: Ctx, leaseId: string): Promise<number> {
  const lands = await rows(ctx.client.from("lease_lands").select("lease_id, leased_acres").eq("organization_id", ctx.orgId).eq("lease_id", leaseId), "the lease's land");
  return lands.reduce((s, l) => s + Number(l.leased_acres ?? 0), 0);
}

// ---------------------------------------------------------------- set_expected_payments

const setExpectedPayments: Action = {
  name: "set_expected_payments",
  description: "Set the expected rent payments of one lease for one lease year: the unpaid installments are replaced by these (label, due date, amount); installments with payments recorded against them are kept. Once a year has expected payments they stand in for the projection from the lease's assumptions. Use it when the payment dates do not fit the lease's yearly schedule, such as a provisional payment in December and the final one the following July.",
  params: [
    { name: "lease", type: "string", required: true, description: "The lease's id or its exact name" },
    { name: "year", type: "integer", required: true, description: "The lease year the rent is for (the crop year)" },
    { name: "installments", type: "array", required: true, description: "1 to 8 of {label, due_date YYYY-MM-DD, amount in dollars}" },
  ],
  async plan(ctx, p) {
    const lease = await leaseOf(ctx, p);
    const year = int(p, "year", 2000, 2100);
    if (lease.status === "terminated") throw new ActionError(422, `${lease.name} is terminated; its payments are not expected any more.`);
    const raw = p.installments;
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 8) throw new ActionError(400, "installments must list 1 to 8 payments.");
    const installments = raw.map((x, i) => {
      const o = (x ?? {}) as Row;
      const label = typeof o.label === "string" && o.label.trim() ? o.label.trim().slice(0, 120) : `Payment ${i + 1}`;
      if (isGovShareLabel(label)) throw new ActionError(400, "Government payment shares are figured from the FSA records, not set here.");
      if (!validDate(o.due_date)) throw new ActionError(400, `Installment ${i + 1} needs a due_date as YYYY-MM-DD.`);
      const amount = numOrNull(o.amount, `Installment ${i + 1}'s amount`, 0.01);
      if (amount === null) throw new ActionError(400, `Installment ${i + 1} needs an amount.`);
      const due = o.due_date as string;
      const dueYear = Number(due.slice(0, 4));
      if (dueYear < year - 1 || dueYear > year + 2) throw new ActionError(400, `Installment ${i + 1} is due in ${dueYear}, too far from the ${year} lease year.`);
      return { label, due_date: due, amount: r2(amount) };
    });
    const existing = (await rows(ctx.client.from("expected_payments").select("id, lease_id, year, label, due_date, expected_amount").eq("organization_id", ctx.orgId).eq("lease_id", String(lease.id)).eq("year", year), "expected payments"))
      .filter((e) => !isGovShareLabel(e.label as string));
    const paidIds = new Set((await rows(ctx.client.from("payments").select("expected_payment_id").eq("organization_id", ctx.orgId).eq("lease_id", String(lease.id)), "payments")).map((x) => x.expected_payment_id).filter(Boolean));
    const kept = existing.filter((e) => paidIds.has(e.id));
    const replaced = existing.filter((e) => !paidIds.has(e.id));
    const before = existing.map((e) => [e.id, e.label, e.due_date, Number(e.expected_amount), paidIds.has(e.id)]).sort();
    const total = r2(installments.reduce((s, x) => s + x.amount, 0));
    const was = r2(replaced.reduce((s, e) => s + Number(e.expected_amount), 0));
    const table: Preview["rows"] = [
      ...replaced.map((e) => [`${e.label} due ${e.due_date}`, Number(e.expected_amount), null] as Preview["rows"][number]),
      ...installments.map((x) => [`${x.label} due ${x.due_date}`, null, x.amount] as Preview["rows"][number]),
    ];
    const same = replaced.length === installments.length && installments.every((x) => replaced.some((e) => e.label === x.label && e.due_date === x.due_date && r2(Number(e.expected_amount)) === x.amount));
    const params = { lease: lease.id, year, installments };
    return {
      params, before,
      headline: same
        ? `${lease.name} ${year}: the expected payments already match.`
        : `${lease.name} ${year}: ${installments.length} expected payment${installments.length === 1 ? "" : "s"} (${money(total)}) would replace ${replaced.length} (${money(was)}).`,
      columns: ["Payment", "Expected before", "Expected after"],
      rows: table,
      notes: [
        ...(kept.length ? [`${kept.length} installment${kept.length === 1 ? "" : "s"} with payments recorded against ${kept.length === 1 ? "it" : "them"} stay as they are.`] : []),
        "Once a lease year has expected payments, they stand in for the projection from its assumptions on the income pages.",
        "Government payment shares are not touched.",
      ],
      changes: same ? 0 : table.length,
      path: `/leases/${String(lease.id)}/breakdown`,
      async write() {
        if (replaced.length) await must(ctx.client.from("expected_payments").delete().eq("organization_id", ctx.orgId).in("id", replaced.map((e) => e.id as string)), "remove the unpaid installments");
        await must(ctx.client.from("expected_payments").insert(installments.map((x) => ({ organization_id: ctx.orgId, lease_id: lease.id, timber_sale_id: null, year, label: x.label, due_date: x.due_date, expected_amount: x.amount }))), "add the installments");
        return { lease: lease.name, year, removed: replaced.length, added: installments.length, total, kept: kept.length };
      },
    };
  },
};

// ---------------------------------------------------------------- set_crop_share_assumptions

const PRACTICES: CropPractice[] = ["blended", "irrigated", "dryland"];

const setCropShareAssumptions: Action = {
  name: "set_crop_share_assumptions",
  description: "Set one year's crop entries on a crop share lease (crop, practice, acres, expected yield, expected price, the landowner's share of expenses), the numbers the lease page projects the year's rent from. Replaces that year's crop entries; anything else saved for the year is kept.",
  params: [
    { name: "lease", type: "string", required: true, description: "The lease's id or its exact name" },
    { name: "year", type: "integer", required: true, description: "The lease year" },
    { name: "crops", type: "array", required: true, description: "1 to 12 of {crop, practice (blended, irrigated or dryland), acres, expected_yield (per acre), expected_price (per unit), expected_shared_expenses (dollars, optional)}" },
  ],
  async plan(ctx, p) {
    const lease = await leaseOf(ctx, p);
    const year = int(p, "year", 2000, 2100);
    if (lease.rent_structure !== "crop_share") throw new ActionError(422, `${lease.name} is not a crop share lease; its rent does not come from crop entries.`);
    const raw = p.crops;
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 12) throw new ActionError(400, "crops must list 1 to 12 entries.");
    const crops: CropAssumption[] = normalizeCropEntries(raw.map((x, i) => {
      const o = (x ?? {}) as Row;
      const crop = typeof o.crop === "string" && o.crop.trim() ? o.crop.trim().slice(0, 60) : null;
      if (!crop) throw new ActionError(400, `Crop entry ${i + 1} needs a crop.`);
      const practice = (o.practice ?? "blended") as CropPractice;
      if (!PRACTICES.includes(practice)) throw new ActionError(400, `Crop entry ${i + 1}: practice is blended, irrigated or dryland.`);
      return {
        crop,
        practice: practice === "blended" ? null : practice,
        acres: numOrNull(o.acres, `${crop} acres`),
        expected_yield: numOrNull(o.expected_yield, `${crop} expected yield`),
        expected_price: numOrNull(o.expected_price, `${crop} expected price`),
        expected_shared_expenses: numOrNull(o.expected_shared_expenses, `${crop} shared expenses`),
      };
    }));
    const existing = (await rows(ctx.client.from("lease_year_assumptions").select("id, lease_id, year, data").eq("organization_id", ctx.orgId).eq("lease_id", String(lease.id)).eq("year", year), "the year's assumptions"))[0] ?? null;
    const prevData = (existing?.data ?? {}) as YearAssumptions;
    // The multi-crop shape replaces the legacy single-crop fields, as the
    // lease page's assumption editor does.
    const { crop: _c, acres: _a, expected_yield: _y, expected_price: _p, expected_shared_expenses: _e, ...rest } = prevData;
    void _c; void _a; void _y; void _p; void _e;
    const nextData: YearAssumptions = { ...rest, crops };
    const acres = await leasedAcres(ctx, String(lease.id));
    const leaseLike = { ...(lease as unknown as LeaseLike), terms: (lease.terms ?? {}) as LeaseLike["terms"], payment_schedule: (lease.payment_schedule ?? []) as SchedulePayment[] };
    const rentBefore = annualRent(leaseLike, acres, prevData);
    const rentAfter = annualRent(leaseLike, acres, nextData);
    const fmt = (c: CropAssumption) => `${c.crop}${c.practice ? ` (${c.practice})` : ""}: ${c.acres ?? "?"} ac x ${c.expected_yield ?? "?"} x ${c.expected_price ?? "?"}`;
    const beforeCrops = cropAssumptions(prevData);
    const table: Preview["rows"] = [
      ...beforeCrops.map((c) => [fmt(c), "before", null] as Preview["rows"][number]),
      ...crops.map((c) => [fmt(c), null, "after"] as Preview["rows"][number]),
      ["Projected rent for the year", rentBefore === null ? null : r2(rentBefore), rentAfter === null ? null : r2(rentAfter)],
    ];
    const same = JSON.stringify(normalizeCropEntries(beforeCrops)) === JSON.stringify(crops);
    const share = Number((lease.terms as Row | null)?.landowner_share_pct ?? 0);
    return {
      params: { lease: lease.id, year, crops },
      before: existing ? { id: existing.id, data: existing.data } : null,
      headline: same
        ? `${lease.name} ${year}: the crop entries already match.`
        : `${lease.name} ${year}: ${crops.length} crop entr${crops.length === 1 ? "y" : "ies"}; projected rent ${rentBefore === null ? "incomplete" : money(rentBefore)} to ${rentAfter === null ? "incomplete" : money(rentAfter)}.`,
      columns: ["Crop entry", "Before", "After"],
      rows: table,
      notes: [
        share ? `The landowner's share is ${share}% (the lease's terms).` : "The lease has no landowner share percent yet, so the projection stays incomplete until it is set on the lease form.",
        "A crop entry missing acres, yield or price keeps the year Incomplete, as on the lease page.",
        "If the year already has expected payments, those stand in for this projection on the income pages.",
      ],
      changes: same ? 0 : crops.length,
      path: leasePath(lease.id),
      async write() {
        if (existing) await must(ctx.client.from("lease_year_assumptions").update({ data: nextData }).eq("organization_id", ctx.orgId).eq("id", existing.id as string), "save the assumptions");
        else await must(ctx.client.from("lease_year_assumptions").insert({ organization_id: ctx.orgId, lease_id: lease.id, year, data: nextData }), "save the assumptions");
        return { lease: lease.name, year, crops: crops.length, projected_rent: rentAfter === null ? null : r2(rentAfter) };
      },
    };
  },
};

// ---------------------------------------------------------------- set_payment_schedule

const setPaymentSchedule: Action = {
  name: "set_payment_schedule",
  description: "Set a lease's yearly payment schedule (1 to 4 payments, each a month and day in the lease year with a percent of the year's rent or a fixed amount), as on the lease form. Percents must add to 100.",
  params: [
    { name: "lease", type: "string", required: true, description: "The lease's id or its exact name" },
    { name: "schedule", type: "array", required: true, description: "1 to 4 of {label, month 1-12, day 1-31, percent or amount}" },
  ],
  async plan(ctx, p) {
    const lease = await leaseOf(ctx, p);
    const raw = p.schedule;
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 4) throw new ActionError(400, "schedule must list 1 to 4 payments.");
    const schedule: SchedulePayment[] = raw.map((x, i) => {
      const o = (x ?? {}) as Row;
      const month = Number(o.month), day = Number(o.day);
      if (!Number.isInteger(month) || month < 1 || month > 12) throw new ActionError(400, `Payment ${i + 1} needs a month from 1 to 12.`);
      if (!Number.isInteger(day) || day < 1 || day > 31) throw new ActionError(400, `Payment ${i + 1} needs a day from 1 to 31.`);
      const percent = numOrNull(o.percent, `Payment ${i + 1}'s percent`);
      const amount = numOrNull(o.amount, `Payment ${i + 1}'s amount`);
      if ((percent === null) === (amount === null)) throw new ActionError(400, `Payment ${i + 1} takes a percent or an amount, one of the two.`);
      const label = typeof o.label === "string" && o.label.trim() ? o.label.trim().slice(0, 120) : i === 0 ? "Annual payment" : `Payment ${i + 1}`;
      return { label, month, day, percent, amount };
    });
    const pcts = schedule.filter((s) => s.percent !== null);
    if (pcts.length && pcts.length !== schedule.length) throw new ActionError(400, "Use percents or fixed amounts on a schedule, not both.");
    if (pcts.length && Math.abs(pcts.reduce((s, x) => s + (x.percent ?? 0), 0) - 100) > 0.01) throw new ActionError(400, "The percents must add to 100.");
    const before = (lease.payment_schedule ?? []) as SchedulePayment[];
    const show = (s: SchedulePayment) => `${s.label}: ${s.month}/${s.day}, ${s.percent !== null && s.percent !== undefined ? `${s.percent}%` : money(Number(s.amount ?? 0))}`;
    const same = JSON.stringify(before) === JSON.stringify(schedule);
    return {
      params: { lease: lease.id, schedule }, before,
      headline: same ? `${lease.name}: the payment schedule already matches.` : `${lease.name}: the payment schedule would become ${schedule.length} payment${schedule.length === 1 ? "" : "s"} a year.`,
      columns: ["Payment", "Before", "After"],
      rows: [...before.map((s) => [show(s), "before", null] as Preview["rows"][number]), ...schedule.map((s) => [show(s), null, "after"] as Preview["rows"][number])],
      notes: ["Each payment falls in the lease year itself; a payment the following year is set with set_expected_payments for that year."],
      changes: same ? 0 : schedule.length,
      path: leasePath(lease.id),
      async write() {
        await must(ctx.client.from("leases").update({ payment_schedule: schedule }).eq("organization_id", ctx.orgId).eq("id", lease.id as string), "save the schedule");
        return { lease: lease.name, payments: schedule.length };
      },
    };
  },
};

// ---------------------------------------------------------------- add_land_to_lease

async function landTarget(ctx: Ctx, p: Row) {
  const property = await resolve(ctx, "properties", "property", str(p, "property")!, "name", "id, name, acres");
  const fieldKey = str(p, "field", false);
  const field = fieldKey ? await resolve(ctx, "fields", "field", fieldKey, "name", "id, name, acres, property_id") : null;
  if (field && field.property_id !== property.id) throw new ActionError(400, `The field ${field.name} is not on ${property.name}.`);
  return { property, field };
}

const addLandToLease: Action = {
  name: "add_land_to_lease",
  description: "Link a property (or one field on it) to a lease with its leased acres, as Link land on the lease page. Leased acres default to the field's or property's mapped acres.",
  params: [
    { name: "lease", type: "string", required: true, description: "The lease's id or its exact name" },
    { name: "property", type: "string", required: true, description: "The property's id or its exact name" },
    { name: "field", type: "string", required: false, description: "One field on that property, by id or exact name (leave out for the whole property)" },
    { name: "leased_acres", type: "number", required: false, description: "Contract acres; defaults to the mapped acres" },
  ],
  async plan(ctx, p) {
    const lease = await leaseOf(ctx, p);
    const { property, field } = await landTarget(ctx, p);
    const links = await rows(ctx.client.from("lease_lands").select("id, lease_id, property_id, field_id, leased_acres").eq("organization_id", ctx.orgId).eq("lease_id", String(lease.id)), "the lease's land");
    if (links.some((l) => l.property_id === property.id && (l.field_id ?? null) === (field?.id ?? null))) throw new ActionError(422, `That land is already linked to ${lease.name}; set its acres with set_leased_acres.`);
    const given = numOrNull(p.leased_acres, "leased_acres");
    const acres = r2(given ?? Number(field?.acres ?? property.acres ?? 0));
    const total = r2(links.reduce((s, l) => s + Number(l.leased_acres ?? 0), 0));
    const what = field ? `${property.name}, ${field.name}` : String(property.name);
    return {
      params: { lease: lease.id, property: property.id, field: field?.id ?? null, leased_acres: acres },
      before: links.map((l) => [l.id, l.property_id, l.field_id ?? null, Number(l.leased_acres ?? 0)]).sort(),
      headline: `${lease.name}: link ${what} (${acres} acres); leased acres ${total} to ${r2(total + acres)}.`,
      columns: ["Land", "Leased acres before", "Leased acres after"],
      rows: [[what, null, acres], ["All land on the lease", total, r2(total + acres)]],
      notes: ["Leased acres feed a cash or per-acre lease's rent and the income split by property."],
      changes: 1,
      path: leasePath(lease.id),
      async write() {
        await must(ctx.client.from("lease_lands").insert({ organization_id: ctx.orgId, lease_id: lease.id, property_id: property.id, field_id: field?.id ?? null, leased_acres: acres }), "link the land");
        return { lease: lease.name, linked: what, leased_acres: acres };
      },
    };
  },
};

// ---------------------------------------------------------------- set_leased_acres

const setLeasedAcres: Action = {
  name: "set_leased_acres",
  description: "Change the leased acres of land already linked to a lease (the contract acres), as on the lease page.",
  params: [
    { name: "lease", type: "string", required: true, description: "The lease's id or its exact name" },
    { name: "property", type: "string", required: true, description: "The linked property's id or exact name" },
    { name: "field", type: "string", required: false, description: "The linked field, when the link is to one field" },
    { name: "leased_acres", type: "number", required: true, description: "The contract acres" },
  ],
  async plan(ctx, p) {
    const lease = await leaseOf(ctx, p);
    const { property, field } = await landTarget(ctx, p);
    const acres = numOrNull(p.leased_acres, "leased_acres");
    if (acres === null) throw new ActionError(400, "leased_acres is needed.");
    const links = await rows(ctx.client.from("lease_lands").select("id, lease_id, property_id, field_id, leased_acres").eq("organization_id", ctx.orgId).eq("lease_id", String(lease.id)), "the lease's land");
    const link = links.find((l) => l.property_id === property.id && (l.field_id ?? null) === (field?.id ?? null));
    if (!link) throw new ActionError(422, `That land is not linked to ${lease.name}; link it with add_land_to_lease.`);
    const was = Number(link.leased_acres ?? 0);
    const now = r2(acres);
    const total = r2(links.reduce((s, l) => s + Number(l.leased_acres ?? 0), 0));
    const what = field ? `${property.name}, ${field.name}` : String(property.name);
    return {
      params: { lease: lease.id, property: property.id, field: field?.id ?? null, leased_acres: now },
      before: [link.id, was],
      headline: `${lease.name}: ${what} leased acres ${was} to ${now}.`,
      columns: ["Land", "Leased acres before", "Leased acres after"],
      rows: [[what, was, now], ["All land on the lease", total, r2(total - was + now)]],
      notes: [],
      changes: was === now ? 0 : 1,
      path: leasePath(lease.id),
      async write() {
        await must(ctx.client.from("lease_lands").update({ leased_acres: now }).eq("organization_id", ctx.orgId).eq("id", link.id as string), "save the acres");
        return { lease: lease.name, land: what, leased_acres: now };
      },
    };
  },
};

// ---------------------------------------------------------------- set_lease_dates_tenant

const setLeaseDatesTenant: Action = {
  name: "set_lease_dates_tenant",
  description: "Correct a lease's start date, end date or tenant, as on the lease form. Leave out what does not change.",
  params: [
    { name: "lease", type: "string", required: true, description: "The lease's id or its exact name" },
    { name: "start_date", type: "date", required: false, description: "YYYY-MM-DD" },
    { name: "end_date", type: "date", required: false, description: "YYYY-MM-DD" },
    { name: "tenant", type: "string", required: false, description: "An existing tenant's id or exact name" },
  ],
  async plan(ctx, p) {
    const lease = await leaseOf(ctx, p);
    const patch: Row = {};
    for (const k of ["start_date", "end_date"] as const) {
      if (p[k] === undefined || p[k] === null || p[k] === "") continue;
      if (!validDate(p[k])) throw new ActionError(400, `${k} must be YYYY-MM-DD.`);
      patch[k] = p[k];
    }
    let tenantName: string | null = null;
    const tenantKey = str(p, "tenant", false);
    if (tenantKey) {
      const t = await resolve(ctx, "tenants", "tenant", tenantKey, "name", "id, name");
      patch.tenant_id = t.id;
      tenantName = String(t.name);
    }
    if (!Object.keys(patch).length) throw new ActionError(400, "Give a start_date, an end_date or a tenant.");
    const start = (patch.start_date ?? lease.start_date) as string | null;
    const end = (patch.end_date ?? lease.end_date) as string | null;
    if (start && end && end < start) throw new ActionError(400, "The end date is before the start date.");
    const tenants = await rows(ctx.client.from("tenants").select("id, name").eq("organization_id", ctx.orgId), "tenants");
    const tName = (id: unknown) => String(tenants.find((t) => t.id === id)?.name ?? id ?? "");
    const table: Preview["rows"] = [];
    if ("start_date" in patch) table.push(["Start date", (lease.start_date as string) ?? null, patch.start_date as string]);
    if ("end_date" in patch) table.push(["End date", (lease.end_date as string) ?? null, patch.end_date as string]);
    if ("tenant_id" in patch) table.push(["Tenant", tName(lease.tenant_id), tenantName]);
    const changed = table.filter((r) => r[1] !== r[2]).length;
    return {
      params: { lease: lease.id, ...("start_date" in patch ? { start_date: patch.start_date } : {}), ...("end_date" in patch ? { end_date: patch.end_date } : {}), ...("tenant_id" in patch ? { tenant: patch.tenant_id } : {}) },
      before: { start_date: lease.start_date ?? null, end_date: lease.end_date ?? null, tenant_id: lease.tenant_id },
      headline: changed ? `${lease.name}: ${table.map((r) => `${String(r[0]).toLowerCase()} ${r[1] ?? "blank"} to ${r[2]}`).join("; ")}.` : `${lease.name}: nothing would change.`,
      columns: ["What", "Before", "After"],
      rows: table,
      notes: ["The lease's years and projections follow its dates."],
      changes: changed,
      path: leasePath(lease.id),
      async write() {
        await must(ctx.client.from("leases").update(patch).eq("organization_id", ctx.orgId).eq("id", lease.id as string), "save the lease");
        return { lease: lease.name, ...patch };
      },
    };
  },
};

// ---------------------------------------------------------------- set_tax_statement_dates

const setTaxStatementDates: Action = {
  name: "set_tax_statement_dates",
  description: "Correct a property tax statement's due date or delinquent date (a date read wrong from the bill). A fully paid statement is left alone.",
  params: [
    { name: "statement", type: "string", required: true, description: "The tax statement's id" },
    { name: "due_date", type: "date", required: false, description: "YYYY-MM-DD" },
    { name: "delinquent_date", type: "date", required: false, description: "YYYY-MM-DD, the first day the tax is delinquent" },
  ],
  async plan(ctx, p) {
    const id = str(p, "statement")!;
    const s = (await rows(ctx.client.from("tax_statements").select("id, tax_year, county, authority_name, amount_due, due_date, delinquent_date").eq("organization_id", ctx.orgId).eq("id", id), "tax statements"))[0];
    if (!s) throw new ActionError(400, `No tax statement ${id} in Turnrow Land.`);
    const patch: Row = {};
    for (const k of ["due_date", "delinquent_date"] as const) {
      if (p[k] === undefined || p[k] === null || p[k] === "") continue;
      if (!validDate(p[k])) throw new ActionError(400, `${k} must be YYYY-MM-DD.`);
      patch[k] = p[k];
    }
    if (!Object.keys(patch).length) throw new ActionError(400, "Give a due_date or a delinquent_date.");
    const due = (patch.due_date ?? s.due_date) as string | null;
    const delinquent = (patch.delinquent_date ?? s.delinquent_date) as string | null;
    if (due && delinquent && delinquent < due) throw new ActionError(400, "The delinquent date is before the due date.");
    const paid = (await rows(ctx.client.from("tax_payments").select("tax_statement_id, amount").eq("organization_id", ctx.orgId).eq("tax_statement_id", id), "tax payments")).reduce((t, x) => t + Number(x.amount ?? 0), 0);
    if (Number(s.amount_due ?? 0) > 0 && paid >= Number(s.amount_due)) throw new ActionError(422, "That statement is paid in full; its dates no longer matter.");
    const name = `${s.tax_year} ${s.authority_name ?? s.county ?? "tax"} statement (${money(Number(s.amount_due ?? 0))})`;
    const table: Preview["rows"] = Object.keys(patch).map((k) => [k === "due_date" ? "Due date" : "Delinquent date", (s[k] as string) ?? null, patch[k] as string]);
    const changed = table.filter((r) => r[1] !== r[2]).length;
    return {
      params: { statement: id, ...patch },
      before: { due_date: s.due_date ?? null, delinquent_date: s.delinquent_date ?? null, paid: r2(paid) },
      headline: changed ? `${name}: ${table.map((r) => `${String(r[0]).toLowerCase()} ${r[1] ?? "blank"} to ${r[2]}`).join("; ")}.` : `${name}: nothing would change.`,
      columns: ["Date", "Before", "After"],
      rows: table,
      notes: ["The taxes page and the brief figure delinquency from the delinquent date."],
      changes: changed,
      path: "/taxes",
      async write() {
        await must(ctx.client.from("tax_statements").update(patch).eq("organization_id", ctx.orgId).eq("id", id), "save the dates");
        return { statement: id, ...patch };
      },
    };
  },
};

// ---------------------------------------------------------------- the catalog

export const ACTIONS: Action[] = [setExpectedPayments, setCropShareAssumptions, setPaymentSchedule, addLandToLease, setLeasedAcres, setLeaseDatesTenant, setTaxStatementDates];
const NAMES = ACTIONS.map((a) => a.name);

export function actionCatalog() {
  return { app: OPS_APP, label: OPS_LABEL, actions: ACTIONS.map(({ name, description, params }) => ({ name, description, params })) };
}

function findAction(name: unknown): Action {
  const a = ACTIONS.find((x) => x.name === name);
  if (!a) throw new ActionError(400, `Unknown action ${String(name)}.`, { actions: NAMES });
  return a;
}

async function planFor(ctx: Ctx, body: Row): Promise<{ action: Action; plan: Plan; preview: Preview }> {
  const action = findAction(body.action);
  const params = body.params && typeof body.params === "object" && !Array.isArray(body.params) ? (body.params as Row) : {};
  const plan = await action.plan(ctx, params);
  const preview: Preview = {
    app: OPS_APP, action: action.name, params: plan.params,
    headline: plan.headline, columns: plan.columns, rows: plan.rows, notes: plan.notes, changes: plan.changes,
    fingerprint: fingerprintOf(action.name, plan.params, plan.before),
    url: `${ctx.base}${plan.path}`,
  };
  return { action, plan, preview };
}

export async function previewAction(ctx: Ctx, body: Row): Promise<Preview> {
  return (await planFor(ctx, body)).preview;
}

export interface ApplyAnswer { status: number; body: Record<string, unknown> }

async function log(ctx: Ctx, entry: Row): Promise<void> {
  // The log is the audit trail: a failure to write it is reported, not
  // swallowed, but never undoes a change already made.
  const { error } = await ctx.client.from("ops_action_log").insert({ organization_id: ctx.orgId, ...entry });
  if (error) console.error(`[ops actions] could not log: ${error.message}`);
}

// Apply: replay an applied key, else preview again; a moved fingerprint is
// stale (409, nothing changes); else write and log.
export async function applyAction(ctx: Ctx, body: Row): Promise<ApplyAnswer> {
  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (!key || key.length > 200) return { status: 400, body: { error: "key is needed (the proposal id)." } };
  const approvedBy = typeof body.approved_by === "string" ? body.approved_by.trim().slice(0, 300) : "";
  if (!approvedBy) return { status: 400, body: { error: "approved_by is needed." } };
  const fingerprint = typeof body.fingerprint === "string" ? body.fingerprint : "";
  if (!fingerprint) return { status: 400, body: { error: "fingerprint is needed (from the preview)." } };

  const done = (await rows(ctx.client.from("ops_action_log").select("key, action, result, outcome").eq("organization_id", ctx.orgId).eq("key", key).eq("outcome", "applied"), "the action log"))[0];
  if (done) return { status: 200, body: { app: OPS_APP, action: done.action, applied: true, replay: true, result: done.result, key } };

  const base = { key, action: String(body.action ?? ""), params: (body.params ?? {}) as Row, fingerprint, approved_by: approvedBy };
  let planned: Awaited<ReturnType<typeof planFor>>;
  try {
    planned = await planFor(ctx, body);
  } catch (err) {
    if (err instanceof ActionError) {
      await log(ctx, { ...base, outcome: "refused", error: err.message });
      return { status: err.status, body: { error: err.message, ...err.extra } };
    }
    const message = err instanceof Error ? err.message : "The preview failed.";
    await log(ctx, { ...base, outcome: "failed", error: message });
    return { status: 500, body: { error: message } };
  }
  const { action, plan, preview } = planned;
  if (preview.fingerprint !== fingerprint) {
    await log(ctx, { ...base, outcome: "stale", error: "The records changed since the preview." });
    return { status: 409, body: { stale: true, error: "The records changed since the preview.", preview } };
  }
  if (preview.changes === 0) {
    await log(ctx, { ...base, outcome: "refused", error: "Nothing to change." });
    return { status: 422, body: { error: `Nothing to change: ${preview.headline}` } };
  }
  try {
    const result = await plan.write();
    await log(ctx, { ...base, action: action.name, params: plan.params, outcome: "applied", result });
    return { status: 200, body: { app: OPS_APP, action: action.name, applied: true, result, url: preview.url, key } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "The change failed.";
    await log(ctx, { ...base, outcome: "failed", error: message });
    return { status: 500, body: { error: message } };
  }
}
