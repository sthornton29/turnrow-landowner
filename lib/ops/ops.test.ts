// The ops API (2026-11-08): the token gate (503 unset, 401 missing or
// wrong, accepted with OPS_TOKEN or OPS_TOKEN_NEXT), the brief envelope the
// morning brief reads (overdue first, absolute urls, org-scoped reads),
// and the datasets (index, params, unknown names).
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fakeDb } from "@/lib/testUtils/fakeDb";
import { checkOpsToken, opsContext } from "./auth";
import { buildBrief } from "./brief";
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
