// GET /api/ops/brief (2026-11-08): what needs the landowner today, in the
// envelope the Turnrow Morning Brief reads (turnrow-farm docs/OPS_API.md).
// The same rules Home's "Needs your attention" card applies (past-due and
// coming payments, leases running out without auto-renew, tenant
// insurance, open maintenance, taxes near or past delinquency), plus the
// documents whose title still waits on a person and a farm link that
// stopped syncing. Every read is filtered by the organization; filters are
// eq/neq/in/is only and dates are compared here, so the fake client in the
// tests reads the same way the live one does.

import type { SupabaseClient } from "@supabase/supabase-js";
import { paymentStatus } from "@/lib/leaseLogic";
import { OPS_APP, OPS_LABEL } from "./auth";

export interface OpsTodo { id: string; text: string; due: string | null; status: "open" | "overdue" | "done"; owner: string | null; url: string }
export interface OpsAlert { severity: "high" | "medium" | "low"; text: string; amount: number | null; url: string }
export interface OpsMetric { key: string; label: string; value: number; unit: string; period: string | null; change: number | null; url: string }
export interface OpsList { name: string; columns: string[]; rows: Array<Array<string | number | null>>; url: string }
export interface OpsBrief {
  app: string; label: string; generated_at: string; as_of: string;
  todos: OpsTodo[]; alerts: OpsAlert[]; metrics: OpsMetric[]; lists: OpsList[]; notes: string[];
}

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const r2 = (n: number) => Math.round(n * 100) / 100;

type Row = Record<string, unknown>;
async function rows(q: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<Row[]> {
  const { data, error } = await q;
  if (error) throw new Error(`${what}: ${error.message}`);
  return (data ?? []) as Row[];
}

export async function buildBrief(client: SupabaseClient, orgId: string, base: string, now: Date = new Date()): Promise<OpsBrief> {
  const today = iso(now);
  const in30 = iso(new Date(now.getTime() + 30 * DAY));
  const in60 = iso(new Date(now.getTime() + 60 * DAY));
  const in90 = iso(new Date(now.getTime() + 90 * DAY));
  const taxYear = now.getUTCFullYear();
  const url = (path: string) => `${base}${path}`;

  const [expected, payments, leases, sales, tenants, issues, statements, taxPaid, docs, connections, properties] = await Promise.all([
    rows(client.from("expected_payments").select("id, lease_id, timber_sale_id, label, due_date, expected_amount").eq("organization_id", orgId), "expected payments"),
    rows(client.from("payments").select("expected_payment_id, amount").eq("organization_id", orgId), "payments"),
    rows(client.from("leases").select("id, name, status, lease_type, end_date, auto_renew, tenant_id, terms").eq("organization_id", orgId), "leases"),
    rows(client.from("timber_sales").select("id, sale_name").eq("organization_id", orgId), "timber sales"),
    rows(client.from("tenants").select("id, name, insurance_on_file, insurance_expires").eq("organization_id", orgId), "tenants"),
    rows(client.from("maintenance_issues").select("id, severity, issue_type, label").eq("organization_id", orgId).eq("status", "open"), "maintenance"),
    rows(client.from("tax_statements").select("id, tax_year, county, authority_name, amount_due, delinquent_date").eq("organization_id", orgId).eq("tax_year", taxYear), "tax statements"),
    rows(client.from("tax_payments").select("tax_statement_id, amount").eq("organization_id", orgId), "tax payments"),
    rows(client.from("documents").select("id, title, file_name, title_reviewed").eq("organization_id", orgId).eq("title_reviewed", false), "documents"),
    rows(client.from("farm_connections").select("id, label, status, last_error, last_synced_at").eq("organization_id", orgId).neq("status", "revoked"), "farm connections"),
    rows(client.from("properties").select("id, acres").eq("organization_id", orgId), "properties"),
  ]);

  const todos: OpsTodo[] = [];
  const alerts: OpsAlert[] = [];
  const leaseById = new Map(leases.map((l) => [String(l.id), l]));
  const saleName = new Map(sales.map((s) => [String(s.id), String(s.sale_name)]));

  // Payments: past due or part paid, or due within 30 days.
  const received = new Map<string, number>();
  for (const p of payments) if (p.expected_payment_id) received.set(String(p.expected_payment_id), (received.get(String(p.expected_payment_id)) ?? 0) + Number(p.amount ?? 0));
  let pastDueTotal = 0, pastDueCount = 0, comingTotal = 0;
  const upcoming: OpsList["rows"] = [];
  for (const e of expected.sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))) {
    const amount = Number(e.expected_amount ?? 0);
    const got = received.get(String(e.id)) ?? 0;
    const status = paymentStatus(amount, got, String(e.due_date), now);
    if (status === "paid") continue;
    const lease = e.lease_id ? leaseById.get(String(e.lease_id)) : null;
    const from = lease ? String(lease.name) : e.timber_sale_id ? saleName.get(String(e.timber_sale_id)) ?? "a timber sale" : "a lease";
    const page = e.lease_id ? `/leases/${e.lease_id}` : `/timber-sales/${e.timber_sale_id}`;
    const owed = r2(amount - got);
    const label = e.label ? ` (${e.label})` : "";
    if (status === "past_due" || status === "partial") {
      const late = String(e.due_date) < today;
      if (late) { pastDueTotal += owed; pastDueCount++; }
      todos.push({ id: `payment-${e.id}`, text: `Follow up the ${money(owed)} ${status === "partial" ? "still owed" : "due"} from ${from}${label}${status === "partial" ? `; ${money(r2(got))} came in` : ""}, and record it when it arrives.`, due: String(e.due_date), status: late ? "overdue" : "open", owner: null, url: url(page) });
    } else if (String(e.due_date) <= in30) {
      comingTotal += owed;
      todos.push({ id: `payment-${e.id}`, text: `Watch for ${money(owed)} from ${from}${label} and record it when it arrives.`, due: String(e.due_date), status: "open", owner: null, url: url(page) });
    }
    if (String(e.due_date) <= in60 && upcoming.length < 25) upcoming.push([String(e.due_date), from, String(e.label ?? ""), owed, status.replace("_", " ")]);
  }
  if (pastDueCount > 0) alerts.push({ severity: "high", text: `${pastDueCount} payment${pastDueCount === 1 ? "" : "s"} past due, ${money(r2(pastDueTotal))} in all.`, amount: r2(pastDueTotal), url: url("/income") });

  // Leases running out without auto-renew.
  const active = leases.filter((l) => l.status === "active");
  for (const l of active) {
    if (!l.end_date || l.auto_renew) continue;
    const end = String(l.end_date);
    if (end < today) todos.push({ id: `lease-ended-${l.id}`, text: `${l.name} ended ${end} and is still marked active: renew it or mark it expired.`, due: end, status: "overdue", owner: null, url: url(`/leases/${l.id}`) });
    else if (end <= in90) todos.push({ id: `lease-ending-${l.id}`, text: `${l.name} ends ${end}: talk renewal with the tenant.`, due: end, status: "open", owner: null, url: url(`/leases/${l.id}`) });
  }

  // Tenant insurance, one line per tenant on an active lease.
  const tenantById = new Map(tenants.map((t) => [String(t.id), t]));
  const flagged = new Set<string>();
  for (const l of active) {
    const t = tenantById.get(String(l.tenant_id));
    if (!t || flagged.has(String(t.id))) continue;
    const required = l.lease_type === "hunting" && (l.terms as { insurance_required?: boolean } | null)?.insurance_required === true;
    const exp = t.insurance_expires ? String(t.insurance_expires) : null;
    const page = url(`/tenants/${t.id}`);
    if (required && !t.insurance_on_file) {
      flagged.add(String(t.id));
      alerts.push({ severity: "high", text: `${t.name}: ${l.name} requires insurance and no certificate is on file.`, amount: null, url: page });
      todos.push({ id: `ins-none-${t.id}`, text: `Get an insurance certificate from ${t.name} (${l.name} requires one).`, due: null, status: "open", owner: null, url: page });
    } else if (t.insurance_on_file && exp && exp < today) {
      flagged.add(String(t.id));
      todos.push({ id: `ins-expired-${t.id}`, text: `Ask ${t.name} for a current insurance certificate; the one on file expired ${exp}.`, due: exp, status: "overdue", owner: null, url: page });
    } else if (t.insurance_on_file && exp && exp <= in60) {
      flagged.add(String(t.id));
      todos.push({ id: `ins-soon-${t.id}`, text: `${t.name}'s insurance certificate expires ${exp}; ask for the renewal.`, due: exp, status: "open", owner: null, url: page });
    }
  }

  // Open maintenance on the ground.
  const high = issues.filter((i) => i.severity === "high").length;
  if (issues.length) alerts.push({ severity: high ? "high" : "medium", text: `${issues.length} open maintenance issue${issues.length === 1 ? "" : "s"} on the land${high ? ` (${high} high severity)` : ""}.`, amount: null, url: url("/maintenance") });

  // This year's property taxes near or past delinquency.
  const paidBy = new Map<string, number>();
  for (const p of taxPaid) paidBy.set(String(p.tax_statement_id), (paidBy.get(String(p.tax_statement_id)) ?? 0) + Number(p.amount ?? 0));
  const unpaid = statements.map((s) => ({ s, owed: r2(Number(s.amount_due ?? 0) - (paidBy.get(String(s.id)) ?? 0)) })).filter((x) => x.owed > 0.005);
  const taxOwed = r2(unpaid.reduce((sum, x) => sum + x.owed, 0));
  const delinquent = unpaid.map((x) => x.s.delinquent_date).filter((d): d is string => typeof d === "string" && !!d).sort()[0] ?? null;
  if (taxOwed > 0 && delinquent) {
    if (delinquent < today) alerts.push({ severity: "high", text: `${taxYear} property taxes: ${money(taxOwed)} unpaid and delinquent since ${delinquent}.`, amount: taxOwed, url: url("/taxes") });
    else if (delinquent <= in60) alerts.push({ severity: "medium", text: `${taxYear} property taxes: ${money(taxOwed)} unpaid, delinquent ${delinquent}.`, amount: taxOwed, url: url("/taxes") });
    if (delinquent <= in60) todos.push({ id: `taxes-${taxYear}`, text: `Pay the ${money(taxOwed)} of ${taxYear} property taxes still unpaid (${unpaid.length} statement${unpaid.length === 1 ? "" : "s"}) and record the payments.`, due: delinquent, status: delinquent < today ? "overdue" : "open", owner: null, url: url("/taxes") });
  }

  // Documents whose title waits on a person.
  if (docs.length) todos.push({ id: "document-titles", text: `Check the title read from ${docs.length} document${docs.length === 1 ? "" : "s"}.`, due: null, status: "open", owner: null, url: url("/documents/titles") });

  // A farm link that stopped syncing.
  for (const c of connections) if (c.last_error) alerts.push({ severity: "medium", text: `The farm link "${c.label ?? "Turnrow Farm"}" failed its last sync: ${String(c.last_error).slice(0, 200)}`, amount: null, url: url("/farm-activity") });

  const rank = (t: OpsTodo) => (t.status === "overdue" ? 0 : 1);
  todos.sort((a, b) => rank(a) - rank(b) || (a.due ?? "9999").localeCompare(b.due ?? "9999"));
  const sev = { high: 0, medium: 1, low: 2 } as const;
  alerts.sort((a, b) => sev[a.severity] - sev[b.severity]);

  const acres = r2(properties.reduce((s, p) => s + Number(p.acres ?? 0), 0));
  const metrics: OpsMetric[] = [
    { key: "acres", label: "Acres held", value: acres, unit: "acres", period: null, change: null, url: url("/properties") },
    { key: "active_leases", label: "Active leases", value: active.length, unit: "count", period: null, change: null, url: url("/leases") },
    { key: "past_due", label: "Past due payments", value: r2(pastDueTotal), unit: "$", period: null, change: null, url: url("/income") },
    { key: "due_30", label: "Payments due in 30 days", value: r2(comingTotal), unit: "$", period: "next 30 days", change: null, url: url("/income") },
    { key: "taxes_unpaid", label: "Property taxes unpaid", value: taxOwed, unit: "$", period: String(taxYear), change: null, url: url("/taxes") },
    { key: "open_issues", label: "Open maintenance issues", value: issues.length, unit: "count", period: null, change: null, url: url("/maintenance") },
  ];
  const lists: OpsList[] = upcoming.length ? [{ name: "Payments due in the next 60 days", columns: ["Due", "From", "For", "Owed", "Status"], rows: upcoming, url: url("/income") }] : [];
  const notes: string[] = [];
  if (!todos.length && !alerts.length) notes.push("Nothing needs attention on the land today.");
  const stamp = now.toISOString();
  return { app: OPS_APP, label: OPS_LABEL, generated_at: stamp, as_of: stamp, todos: todos.slice(0, 25), alerts, metrics, lists, notes };
}
