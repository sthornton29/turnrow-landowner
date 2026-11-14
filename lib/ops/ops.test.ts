// The ops API (2026-11-08): the token gate (503 unset, 401 missing or
// wrong, accepted with OPS_TOKEN or OPS_TOKEN_NEXT), the brief envelope the
// morning brief reads (overdue first, absolute urls, org-scoped reads),
// and the datasets (index, params, unknown names).
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fakeDb } from "@/lib/testUtils/fakeDb";
import { checkOpsToken, opsContext } from "./auth";
import { addDaysISO, buildBrief, isAfterEndedLease, taxAlertText, unpaidTaxByYear } from "./brief";
import { DATASETS, datasetIndex, ParamError, runDataset } from "./data";

const req = (auth?: string) => new Request("https://turnrowland.com/api/ops/brief", { headers: auth ? { authorization: auth } : {} });
const ORG = "org-1";
const OTHER = "org-2";
const BASE = "https://turnrowland.com";
const NOW = new Date("2026-11-08T15:00:00Z");

describe("checkOpsToken", () => {
  it("answers 503 when no token is configured, 401 when missing or wrong, and passes either accepted token", async () => {
    expect(checkOpsToken(req("Bearer x"), {} as NodeJS.ProcessEnv)!.status).toBe(503);
    const env = { OPS_TOKEN: "tok-a", OPS_TOKEN_NEXT: "tok-b" } as unknown as NodeJS.ProcessEnv;
    expect(checkOpsToken(req(), env)!.status).toBe(401);
    expect(checkOpsToken(req("Bearer nope"), env)!.status).toBe(401);
    expect(checkOpsToken(req("Basic tok-a"), env)!.status).toBe(401);
    expect(checkOpsToken(req("Bearer tok-a"), env)).toBeNull();
    expect(checkOpsToken(req("bearer tok-b"), env)).toBeNull();
    const r = checkOpsToken(req("Bearer nope"), env)!;
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toEqual({ error: "That token is not accepted." });
  });

  it("needs OPS_ORG and the service role once the token passes", () => {
    const env = { OPS_TOKEN: "t" } as unknown as NodeJS.ProcessEnv;
    const c = opsContext(req("Bearer t"), env);
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.response.status).toBe(503);
    const ok = opsContext(req("Bearer t"), { ...env, OPS_ORG: ORG, NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" } as unknown as NodeJS.ProcessEnv);
    expect(ok.ok).toBe(true);
    if (ok.ok) { expect(ok.orgId).toBe(ORG); expect(ok.base).toBe(BASE); }
  });
});

function seed() {
  return fakeDb({
    leases: [
      { id: "l1", organization_id: ORG, name: "Smith cropland", status: "active", lease_type: "agricultural", end_date: "2026-12-31", auto_renew: false, tenant_id: "t1", terms: {} },
      { id: "l2", organization_id: ORG, name: "Deer camp", status: "active", lease_type: "hunting", end_date: "2026-10-01", auto_renew: false, tenant_id: "t2", terms: { insurance_required: true } },
      { id: "lx", organization_id: OTHER, name: "Not ours", status: "active", lease_type: "agricultural", end_date: "2026-11-20", auto_renew: false, tenant_id: "tx", terms: {} },
    ],
    tenants: [
      { id: "t1", organization_id: ORG, name: "Smith Farms", insurance_on_file: false, insurance_expires: null },
      { id: "t2", organization_id: ORG, name: "Hunt Club", insurance_on_file: false, insurance_expires: null },
    ],
    expected_payments: [
      { id: "e1", organization_id: ORG, lease_id: "l1", timber_sale_id: null, label: "Fall rent", due_date: "2026-10-15", expected_amount: 12000 },
      { id: "e2", organization_id: ORG, lease_id: "l1", timber_sale_id: null, label: "Spring rent", due_date: "2026-11-30", expected_amount: 5000 },
      { id: "e3", organization_id: ORG, lease_id: "l1", timber_sale_id: null, label: "Paid", due_date: "2026-09-01", expected_amount: 100 },
      { id: "ex", organization_id: OTHER, lease_id: "lx", timber_sale_id: null, label: "x", due_date: "2026-10-01", expected_amount: 999 },
    ],
    payments: [{ organization_id: ORG, expected_payment_id: "e3", amount: 100, received_date: "2026-09-01", lease_id: "l1", timber_sale_id: null, method: "check", memo: null }],
    timber_sales: [],
    maintenance_issues: [{ id: "m1", organization_id: ORG, severity: "high", issue_type: "wash", label: null, status: "open" }],
    tax_statements: [{ id: "s1", organization_id: ORG, tax_year: 2026, county: "Lawrence", authority_name: "Lawrence County", amount_due: 4000, delinquent_date: "2027-01-01" }],
    tax_payments: [],
    documents: [{ id: "d1", organization_id: ORG, title: "Deed", file_name: "deed.pdf", title_reviewed: false, created_at: "2026-11-01", doc_type: "deed", entity_type: "property" }],
    farm_connections: [{ id: "c1", organization_id: ORG, label: "Turnrow Farm", status: "active", last_error: "401 from the farm API", last_synced_at: null }],
    properties: [{ id: "p1", organization_id: ORG, name: "Home place", acres: 320.5, county: "Lawrence", state: "AL", entity_id: null, fsa_numbers: ["388"] }],
    parcels: [{ id: "pc1", organization_id: ORG, property_id: "p1" }],
    entities: [],
    lease_lands: [{ organization_id: ORG, lease_id: "l1", property_id: "p1", leased_acres: 300 }],
  });
}

describe("buildBrief", () => {
  it("lists what needs the landowner, overdue first, with absolute urls and only this organization's rows", async () => {
    const db = seed();
    const b = await buildBrief(db.client as SupabaseClient, ORG, BASE, NOW);
    expect(Object.keys(b)).toEqual(["app", "label", "generated_at", "as_of", "todos", "alerts", "metrics", "lists", "notes"]);
    expect(b.app).toBe("land");
    const ids = b.todos.map((t) => t.id);
    expect(ids).toContain("payment-e1");
    expect(ids).toContain("payment-e2");
    expect(ids).not.toContain("payment-e3");
    expect(ids).not.toContain("payment-ex");
    expect(ids).toContain("lease-ended-l2");
    expect(ids).toContain("lease-ending-l1");
    expect(ids).toContain("ins-none-t2");
    expect(ids).toContain("taxes-2026");
    expect(ids).toContain("document-titles");
    // Overdue first.
    const firstOpen = b.todos.findIndex((t) => t.status !== "overdue");
    expect(b.todos.slice(firstOpen).every((t) => t.status !== "overdue")).toBe(true);
    expect(b.todos.find((t) => t.id === "payment-e1")).toMatchObject({ status: "overdue", due: "2026-10-15", url: "https://turnrowland.com/leases/l1" });
    expect([...b.todos, ...b.alerts].every((x) => x.url.startsWith("https://turnrowland.com/"))).toBe(true);
    expect(b.alerts[0].severity).toBe("high");
    expect(b.alerts.find((a) => a.text.includes("past due"))!.amount).toBe(12000);
    expect(b.alerts.some((a) => a.text.includes("failed its last sync"))).toBe(true);
    expect(b.metrics.find((m) => m.key === "acres")!.value).toBe(320.5);
    expect(b.lists[0].rows.length).toBe(2);
    // Every read was scoped to the organization.
    expect(db.reads.every((r) => r.filters.some((f) => f.col === "organization_id" && f.value === ORG))).toBe(true);
  });

  it("says so when nothing needs attention", async () => {
    const b = await buildBrief(fakeDb({}).client as SupabaseClient, ORG, BASE, NOW);
    expect(b.todos).toEqual([]);
    expect(b.notes).toEqual(["Nothing needs attention on the land today."]);
  });
});

// Property tax for a year is due October 1 and goes delinquent January 1
// of the NEXT year. Reading only "this calendar year's" statements made
// the tax alert vanish on January 1, the very day last year's unpaid
// bills turned delinquent.
describe("property tax alerts cover every tax year with a balance", () => {
  const statement = (id: string, taxYear: number, amount: number, delinquent: string | null, org = ORG) => ({
    id, organization_id: org, tax_year: taxYear, county: "Lawrence", authority_name: "Lawrence County", amount_due: amount, delinquent_date: delinquent,
  });
  const taxDb = (statements: unknown[], payments: unknown[] = []) =>
    fakeDb({ tax_statements: statements as never[], tax_payments: payments as never[] });

  it("on January 1 last year's unpaid bills are delinquent, not gone", async () => {
    const db = taxDb([statement("s1", 2026, 4000, "2027-01-01"), statement("s2", 2026, 1500.5, "2027-01-01")]);
    const b = await buildBrief(db.client as SupabaseClient, ORG, BASE, new Date("2027-01-01T15:00:00Z"));
    const alert = b.alerts.find((a) => a.text.startsWith("2026 property taxes"))!;
    expect(alert).toMatchObject({
      severity: "high",
      amount: 5500.5,
      text: "2026 property taxes: $5,500.50 unpaid on 2 statements, delinquent since Jan 1, 2027.",
      url: "https://turnrowland.com/taxes?year=2026",
    });
    expect(b.todos.find((t) => t.id === "taxes-2026")).toMatchObject({ status: "overdue", due: "2026-12-31" });
    // The headline figure follows the latest tax year that has statements.
    expect(b.metrics.find((m) => m.key === "taxes_unpaid")).toMatchObject({ value: 5500.5, period: "2026" });
    expect(b.notes).toEqual([]);
  });

  it("before the delinquent date it says the last day to pay (the day before)", async () => {
    const db = taxDb([statement("s1", 2026, 4000, "2027-01-01")]);
    const b = await buildBrief(db.client as SupabaseClient, ORG, BASE, NOW);
    const alert = b.alerts.find((a) => a.text.startsWith("2026 property taxes"))!;
    expect(alert.severity).toBe("medium");
    expect(alert.text).toBe("2026 property taxes: $4,000.00 unpaid on 1 statement. Pay by Dec 31, 2026 to avoid going delinquent.");
    expect(b.todos.find((t) => t.id === "taxes-2026")).toMatchObject({ status: "open", due: "2026-12-31" });
  });

  it("the evening of December 31 in Alabama is still December 31, though UTC says January 1", async () => {
    const db = taxDb([statement("s1", 2026, 4000, "2027-01-01")]);
    // 9 pm Central on Dec 31, 2026.
    const b = await buildBrief(db.client as SupabaseClient, ORG, BASE, new Date("2027-01-01T03:00:00Z"));
    const alert = b.alerts.find((a) => a.text.startsWith("2026 property taxes"))!;
    expect(alert.severity).toBe("medium");
    expect(alert.text).toContain("Pay by Dec 31, 2026");
  });

  it("names each tax year, skips paid statements, counts part payments, and stays inside the organization", async () => {
    const db = taxDb(
      [
        statement("old", 2024, 900, "2025-01-01"), // part paid, long delinquent
        statement("paid", 2025, 1200, "2026-01-01"), // paid in full
        statement("cur", 2026, 4000, "2027-01-01"), // coming up
        statement("far", 2026, 700, "2027-06-01"), // more than 60 days off
        statement("nodate", 2026, 50, null), // no delinquent date on file
        statement("theirs", 2023, 9999, "2024-01-01", OTHER),
      ],
      [
        { organization_id: ORG, tax_statement_id: "old", amount: 400 },
        { organization_id: ORG, tax_statement_id: "paid", amount: 1200 },
      ]
    );
    const b = await buildBrief(db.client as SupabaseClient, ORG, BASE, NOW);
    const tax = b.alerts.filter((a) => a.text.includes("property taxes"));
    expect(tax.map((a) => a.text)).toEqual([
      "2024 property taxes: $500.00 unpaid on 1 statement, delinquent since Jan 1, 2025.",
      "2026 property taxes: $4,000.00 unpaid on 1 statement. Pay by Dec 31, 2026 to avoid going delinquent.",
    ]);
    expect(tax.map((a) => a.severity)).toEqual(["high", "medium"]);
    expect(b.todos.filter((t) => t.id.startsWith("taxes-")).map((t) => [t.id, t.status])).toEqual([
      ["taxes-2024", "overdue"],
      ["taxes-2026", "open"],
    ]);
    // 2026 is the latest tax year on file: all of its unpaid balance.
    expect(b.metrics.find((m) => m.key === "taxes_unpaid")).toMatchObject({ value: 4750, period: "2026" });
  });

  it("unpaidTaxByYear splits a year that is partly delinquent and partly still payable", () => {
    const out = unpaidTaxByYear(
      [
        { id: "a", tax_year: 2026, amount_due: 100, delinquent_date: "2027-01-01" },
        { id: "b", tax_year: 2026, amount_due: 250, delinquent_date: "2027-03-01" },
        { id: "c", tax_year: 2026, amount_due: 80, delinquent_date: "2027-02-15" },
      ],
      new Map([["b", 50]]),
      "2027-01-01",
      "2027-03-02"
    );
    expect(out).toEqual([
      { taxYear: 2026, delinquentOwed: 100, delinquentStatements: 1, delinquentSince: "2027-01-01", soonOwed: 280, soonStatements: 2, payBy: "2027-02-14" },
    ]);
    expect(taxAlertText(out[0])).toBe(
      "$100.00 unpaid on 1 statement, delinquent since Jan 1, 2027. Another $280.00 on 2 statements must be paid by Feb 14, 2027."
    );
  });

  it("addDaysISO moves a calendar date across month and year ends", () => {
    expect(addDaysISO("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDaysISO("2026-11-08", 60)).toBe("2027-01-07");
    expect(addDaysISO("2028-02-28", 2)).toBe("2028-03-01");
  });
});

describe("payments past the end of a lease that is over", () => {
  it("isAfterEndedLease is true only for an expired or terminated lease, after its end date", () => {
    expect(isAfterEndedLease("2027-03-01", { status: "expired", end_date: "2026-12-31" })).toBe(true);
    expect(isAfterEndedLease("2027-03-01", { status: "terminated", end_date: "2026-12-31" })).toBe(true);
    expect(isAfterEndedLease("2026-12-31", { status: "expired", end_date: "2026-12-31" })).toBe(false);
    expect(isAfterEndedLease("2026-10-15", { status: "expired", end_date: "2026-12-31" })).toBe(false);
    expect(isAfterEndedLease("2027-03-01", { status: "active", end_date: "2026-12-31" })).toBe(false);
    expect(isAfterEndedLease("2027-03-01", { status: "expired", end_date: null })).toBe(false);
    expect(isAfterEndedLease("2027-03-01", null)).toBe(false);
  });

  it("drops schedule rows dated after an expired lease ended and keeps rent that came due during its term", async () => {
    const db = fakeDb({
      leases: [{ id: "old", organization_id: ORG, name: "Old cropland", status: "expired", lease_type: "agricultural", end_date: "2025-12-31", auto_renew: false, tenant_id: "t1", terms: {} }],
      tenants: [{ id: "t1", organization_id: ORG, name: "Smith Farms", insurance_on_file: false, insurance_expires: null }],
      expected_payments: [
        { id: "term", organization_id: ORG, lease_id: "old", timber_sale_id: null, label: "Fall rent 2025", due_date: "2025-10-15", expected_amount: 8000 },
        { id: "after1", organization_id: ORG, lease_id: "old", timber_sale_id: null, label: "Fall rent 2026", due_date: "2026-10-15", expected_amount: 8000 },
        { id: "after2", organization_id: ORG, lease_id: "old", timber_sale_id: null, label: "Spring rent 2027", due_date: "2026-11-30", expected_amount: 8000 },
      ],
      payments: [],
    });
    const b = await buildBrief(db.client as SupabaseClient, ORG, BASE, NOW);
    expect(b.todos.map((t) => t.id)).toEqual(["payment-term"]);
    expect(b.alerts.find((a) => a.text.includes("past due"))).toMatchObject({ amount: 8000, text: "1 payment past due, $8,000.00 in all." });
    expect(b.metrics.find((m) => m.key === "due_30")!.value).toBe(0);
    expect(b.lists[0].rows).toHaveLength(1);
  });
});

describe("datasets", () => {
  it("describes 5 to 12 datasets and runs each against an empty organization", async () => {
    const idx = datasetIndex();
    expect(idx.datasets.length).toBeGreaterThanOrEqual(5);
    expect(idx.datasets.length).toBeLessThanOrEqual(12);
    for (const d of DATASETS) {
      const out = await runDataset(fakeDb({}).client as SupabaseClient, ORG, BASE, d.name, {}, NOW);
      expect(out).toMatchObject({ app: "land", dataset: d.name, total: 0, truncated: false });
      expect(out!.url.startsWith(BASE)).toBe(true);
    }
  });

  it("reads leases and payments with their names, filters by year, and refuses bad params and names", async () => {
    const db = seed();
    const leases = (await runDataset(db.client as SupabaseClient, ORG, BASE, "leases", {}, NOW))!;
    expect(leases.rows.map((r) => r[0])).toEqual(["Deer camp", "Smith cropland"]);
    expect(leases.rows[1][9]).toBe(300);
    const due = (await runDataset(db.client as SupabaseClient, ORG, BASE, "payments_expected", { status: "past_due" }, NOW))!;
    expect(due.rows).toEqual([["2026-10-15", "Smith cropland", "Fall rent", 12000, 0, 12000, "past_due"]]);
    await expect(runDataset(db.client as SupabaseClient, ORG, BASE, "property_taxes", { tax_year: "abc" }, NOW)).rejects.toBeInstanceOf(ParamError);
    expect(await runDataset(db.client as SupabaseClient, ORG, BASE, "nope", {}, NOW)).toBeNull();
  });
});
