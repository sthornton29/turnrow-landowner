// GET /api/ops/brief (2026-11-08): what needs the landowner today, in the
// envelope the Turnrow Morning Brief reads (turnrow-farm docs/OPS_API.md).
// The same rules Home's "Needs your attention" card applies (past-due and
// coming payments, leases running out without auto-renew, tenant
// insurance, open maintenance, taxes near or past delinquency), plus the
// documents whose title still waits on a person and a farm link that
// stopped syncing. Every read is filtered by the organization; filters are
// eq/neq/in/is only and dates are compared here, so the fake client in the
// tests reads the same way the live one does.
//
// The rules Home shares are exported from here (addDaysISO,
// isAfterEndedLease, unpaidTaxByYear, taxAlertText) and Home imports
// them, so the two can never drift apart.

import type { SupabaseClient } from "@supabase/supabase-js";
import { formatDate, formatDollars, todayISO } from "@/lib/format";
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

const r2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------- shared with Home

// A calendar date (YYYY-MM-DD) moved by a number of days; negative goes back.
export function addDaysISO(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// An expected payment dated AFTER the end of a lease that is no longer
// active (expired or terminated) is not owed: the schedule simply ran on
// past the lease. Rent that came due during the lease's term still is,
// however old. A lease with no end date on file is left alone.
export function isAfterEndedLease(
  dueDate: string,
  lease: { status?: unknown; end_date?: unknown } | null | undefined
): boolean {
  if (!lease || (lease.status !== "expired" && lease.status !== "terminated")) return false;
  return typeof lease.end_date === "string" && lease.end_date !== "" && dueDate > lease.end_date;
}

// Unpaid property tax for one tax year that needs a person now.
// delinquent_date is the FIRST delinquent day, so the last day to pay is
// the day before it.
export interface TaxYearAlert {
  taxYear: number;
  delinquentOwed: number; // unpaid on statements already delinquent
  delinquentStatements: number;
  delinquentSince: string | null; // the earliest first-delinquent day among them
  soonOwed: number; // unpaid on statements that go delinquent within the horizon
  soonStatements: number;
  payBy: string | null; // the last day to pay the soonest of those
}

// Every tax year (not only the current one) with a statement that still
// has a balance and is past, or within the horizon of, its delinquent
// date. Property tax for a year is due October 1 and goes delinquent
// January 1 of the NEXT year, so last year's bills matter most in
// January. Newest tax year first. A statement with no delinquent date on
// file cannot be judged and is left out.
export function unpaidTaxByYear(
  statements: Array<{ id?: unknown; tax_year?: unknown; amount_due?: unknown; delinquent_date?: unknown }>,
  paidByStatement: Map<string, number>,
  today: string,
  horizon: string
): TaxYearAlert[] {
  const byYear = new Map<number, TaxYearAlert>();
  for (const s of statements) {
    const owed = Number(s.amount_due ?? 0) - (paidByStatement.get(String(s.id)) ?? 0);
    const date = typeof s.delinquent_date === "string" ? s.delinquent_date : "";
    if (owed <= 0.005 || !date || date > horizon) continue;
    const year = Number(s.tax_year);
    const a = byYear.get(year) ?? { taxYear: year, delinquentOwed: 0, delinquentStatements: 0, delinquentSince: null, soonOwed: 0, soonStatements: 0, payBy: null };
    if (date <= today) {
      a.delinquentOwed += owed;
      a.delinquentStatements += 1;
      if (!a.delinquentSince || date < a.delinquentSince) a.delinquentSince = date;
    } else {
      a.soonOwed += owed;
      a.soonStatements += 1;
      const last = addDaysISO(date, -1);
      if (!a.payBy || last < a.payBy) a.payBy = last;
    }
    byYear.set(year, a);
  }
  return Array.from(byYear.values())
    .map((a) => ({ ...a, delinquentOwed: r2(a.delinquentOwed), soonOwed: r2(a.soonOwed) }))
    .sort((a, b) => b.taxYear - a.taxYear);
}

// The sentence for one tax year's alert, the same on Home and in the brief.
export function taxAlertText(a: TaxYearAlert): string {
  const on = (n: number) => `on ${n.toLocaleString("en-US")} statement${n === 1 ? "" : "s"}`;
  if (a.delinquentStatements > 0) {
    return (
      `${formatDollars(a.delinquentOwed)} unpaid ${on(a.delinquentStatements)}, delinquent since ${formatDate(a.delinquentSince)}.` +
      (a.soonStatements > 0
        ? ` Another ${formatDollars(a.soonOwed)} ${on(a.soonStatements)} must be paid by ${formatDate(a.payBy)}.`
        : "")
    );
  }
  return `${formatDollars(a.soonOwed)} unpaid ${on(a.soonStatements)}. Pay by ${formatDate(a.payBy)} to avoid going delinquent.`;
}

// ---------------------------------------------------------------- the brief

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Row = Record<string, unknown>;
async function rows(q: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<Row[]> {
  const { data, error } = await q;
  if (error) throw new Error(`${what}: ${error.message}`);
  return (data ?? []) as Row[];
}

export async function buildBrief(client: SupabaseClient, orgId: string, base: string, now: Date = new Date()): Promise<OpsBrief> {
  // "Today" is the calendar day where the land is (US Central); the
  // server runs in UTC and would call it tomorrow every evening.
  const today = todayISO(now);
  const todayStart = new Date(today + "T00:00:00");
  const in30 = addDaysISO(today, 30);
  const in60 = addDaysISO(today, 60);
  const in90 = addDaysISO(today, 90);
  const url = (path: string) => `${base}${path}`;

  const [expected, payments, leases, sales, tenants, issues, statements, taxPaid, docs, connections, properties] = await Promise.all([
    rows(client.from("expected_payments").select("id, lease_id, timber_sale_id, label, due_date, expected_amount").eq("organization_id", orgId), "expected payments"),
    rows(client.from("payments").select("expected_payment_id, amount").eq("organization_id", orgId), "payments"),
    rows(client.from("leases").select("id, name, status, lease_type, end_date, auto_renew, tenant_id, terms").eq("organization_id", orgId), "leases"),
    rows(client.from("timber_sales").select("id, sale_name").eq("organization_id", orgId), "timber sales"),
    rows(client.from("tenants").select("id, name, insurance_on_file, insurance_expires").eq("organization_id", orgId), "tenants"),
    rows(client.from("maintenance_issues").select("id, severity, issue_type, label").eq("organization_id", orgId).eq("status", "open"), "maintenance"),
    // Every tax year: last year's bills go delinquent on January 1.
    rows(client.from("tax_statements").select("id, tax_year, county, authority_name, amount_due, delinquent_date").eq("organization_id", orgId), "tax statements"),
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
    const status = paymentStatus(amount, got, String(e.due_date), todayStart);
    if (status === "paid") continue;
    const lease = e.lease_id ? leaseById.get(String(e.lease_id)) : null;
    // A schedule row past the end of an expired or terminated lease is not owed.
    if (isAfterEndedLease(String(e.due_date), lease)) continue;
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

  // Property taxes near or past delinquency, for EVERY tax year with a
  // balance (not only this calendar year's), each named by its tax year.
  const paidBy = new Map<string, number>();
  for (const p of taxPaid) paidBy.set(String(p.tax_statement_id), (paidBy.get(String(p.tax_statement_id)) ?? 0) + Number(p.amount ?? 0));
  for (const a of unpaidTaxByYear(statements, paidBy, today, in60)) {
    const owed = r2(a.delinquentOwed + a.soonOwed);
    const late = a.delinquentStatements > 0;
    const count = a.delinquentStatements + a.soonStatements;
    const page = url(`/taxes?year=${a.taxYear}`);
    alerts.push({ severity: late ? "high" : "medium", text: `${a.taxYear} property taxes: ${taxAlertText(a)}`, amount: owed, url: page });
    // Due = the last day to pay (the day before the first delinquent day).
    const due = a.delinquentSince ? addDaysISO(a.delinquentSince, -1) : a.payBy;
    todos.push({ id: `taxes-${a.taxYear}`, text: `Pay the ${money(owed)} of ${a.taxYear} property taxes still unpaid (${count} statement${count === 1 ? "" : "s"}) and record the payments.`, due, status: late ? "overdue" : "open", owner: null, url: page });
  }
  // The headline figure follows Home's tax card: the latest tax year
  // that has statements (this calendar year when there are none).
  const taxYear = statements.reduce((latest, s) => Math.max(latest, Number(s.tax_year) || 0), 0) || Number(today.slice(0, 4));
  const taxOwed = r2(
    statements
      .filter((s) => Number(s.tax_year) === taxYear)
      .reduce((sum, s) => sum + Math.max(Number(s.amount_due ?? 0) - (paidBy.get(String(s.id)) ?? 0), 0), 0)
  );

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
