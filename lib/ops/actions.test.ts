// Ops actions (2026-11-09; turnrow-farm docs/OPS_ACTIONS.md): the write
// token gate (503 unset, 401 wrong, the read token refused), the preview
// shape and its fingerprint, apply (stale 409, replay by key, the log),
// and the refusals (paid installments kept, a paid tax statement, a
// lease that is not crop share).
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fakeDb } from "@/lib/testUtils/fakeDb";
import { checkOpsWriteToken, opsWriteContext } from "./auth";
import { actionCatalog, applyAction, previewAction } from "./actions";

const ORG = "org-1";
const OTHER = "org-2";
const BASE = "https://www.turnrowland.com";
const req = (auth?: string) => new Request(`${BASE}/api/ops/actions`, { headers: auth ? { authorization: auth } : {} });

function seed() {
  return fakeDb({
    leases: [
      { id: "l1", organization_id: ORG, name: "View Celeste-Albemarle 2026", tenant_id: "t1", lease_type: "agricultural", rent_structure: "crop_share", status: "active", terms: { landowner_share_pct: 10 }, payment_schedule: [], start_date: "2026-02-01", end_date: "2026-12-31" },
      { id: "l2", organization_id: ORG, name: "Smith cash", tenant_id: "t1", lease_type: "agricultural", rent_structure: "cash", status: "active", terms: { rate_per_acre: 100 }, payment_schedule: [], start_date: "2026-01-01", end_date: "2026-12-31" },
      { id: "lx", organization_id: OTHER, name: "View Celeste-Albemarle 2026", tenant_id: "tx", lease_type: "agricultural", rent_structure: "crop_share", status: "active", terms: {}, payment_schedule: [], start_date: null, end_date: null },
    ],
    tenants: [{ id: "t1", organization_id: ORG, name: "View Celeste Farm, LLC" }, { id: "t2", organization_id: ORG, name: "Other Tenant" }],
    lease_lands: [{ id: "ll1", organization_id: ORG, lease_id: "l1", property_id: "p1", field_id: null, leased_acres: 486.4 }],
    properties: [{ id: "p1", organization_id: ORG, name: "Blythe", acres: 486.4 }, { id: "p2", organization_id: ORG, name: "Long Pond", acres: 113.2 }],
    fields: [],
    lease_year_assumptions: [],
    expected_payments: [
      { id: "e1", organization_id: ORG, lease_id: "l1", timber_sale_id: null, year: 2026, label: "Old guess", due_date: "2026-12-10", expected_amount: 1000 },
      { id: "e2", organization_id: ORG, lease_id: "l1", timber_sale_id: null, year: 2026, label: "Deposit", due_date: "2026-03-01", expected_amount: 500 },
      { id: "eg", organization_id: ORG, lease_id: "l1", timber_sale_id: null, year: 2026, label: "Government payment share (program year 2025)", due_date: "2026-10-01", expected_amount: 77 },
    ],
    payments: [{ id: "pay1", organization_id: ORG, lease_id: "l1", timber_sale_id: null, expected_payment_id: "e2", amount: 500, received_date: "2026-03-01" }],
    tax_statements: [
      { id: "ts1", organization_id: ORG, tax_year: 2026, county: "Lawrence", authority_name: "Lawrence County", amount_due: 736.49, due_date: "2026-10-01", delinquent_date: "2026-01-01" },
      { id: "ts2", organization_id: ORG, tax_year: 2025, county: "Lawrence", authority_name: "Lawrence County", amount_due: 700, due_date: "2025-10-01", delinquent_date: "2026-01-01" },
    ],
    tax_payments: [{ organization_id: ORG, tax_statement_id: "ts2", amount: 700, paid_date: "2025-12-01" }],
    ops_action_log: [],
  });
}

const ctxOf = (db: ReturnType<typeof seed>) => ({ client: db.client as SupabaseClient, orgId: ORG, base: BASE });
const ALBEMARLE = { lease: "View Celeste-Albemarle 2026", year: 2026, installments: [{ label: "Provisional payment", due_date: "2026-12-10", amount: 302813.37 }, { label: "Final payment", due_date: "2027-07-01", amount: 75703.34 }] };

describe("the write token", () => {
  it("is closed until set, refuses the read token, and takes the write token or the next one", async () => {
    expect(checkOpsWriteToken(req("Bearer w"), { OPS_TOKEN: "read-tok" } as unknown as NodeJS.ProcessEnv)!.status).toBe(503);
    const r503 = checkOpsWriteToken(req("Bearer w"), {} as NodeJS.ProcessEnv)!;
    expect(await r503.json()).toEqual({ error: "Ops actions are not configured." });
    const env = { OPS_TOKEN: "read-tok", OPS_WRITE_TOKEN: "write-tok", OPS_WRITE_TOKEN_NEXT: "write-next" } as unknown as NodeJS.ProcessEnv;
    expect(checkOpsWriteToken(req("Bearer read-tok"), env)!.status).toBe(401);
    expect(checkOpsWriteToken(req(), env)!.status).toBe(401);
    expect(checkOpsWriteToken(req("Bearer write-tok"), env)).toBeNull();
    expect(checkOpsWriteToken(req("Bearer write-next"), env)).toBeNull();
    const c = opsWriteContext(req("Bearer read-tok"), { ...env, OPS_ORG: ORG, NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" } as unknown as NodeJS.ProcessEnv);
    expect(c.ok).toBe(false);
  });
});

describe("the catalog", () => {
  it("lists 3 to 8 named actions with described params", () => {
    const c = actionCatalog();
    expect(c.app).toBe("land");
    expect(c.actions.length).toBeGreaterThanOrEqual(3);
    expect(c.actions.length).toBeLessThanOrEqual(8);
    for (const a of c.actions) { expect(a.description.length).toBeGreaterThan(20); expect(a.params.length).toBeGreaterThan(0); }
    expect(JSON.stringify(c)).not.toContain(String.fromCharCode(0x2014));
  });
});

describe("set_expected_payments (the Albemarle case)", () => {
  it("previews the replacement, keeps paid and government rows, writes nothing", async () => {
    const db = seed();
    const p = await previewAction(ctxOf(db), { action: "set_expected_payments", params: ALBEMARLE });
    expect(p).toMatchObject({ app: "land", action: "set_expected_payments", changes: 3, url: `${BASE}/leases/l1/breakdown` });
    expect(p.params).toMatchObject({ lease: "l1", year: 2026 });
    expect(p.headline).toContain("$378,516.71");
    expect(p.headline).toContain("would replace 1 ($1,000.00)");
    expect(p.notes.join(" ")).toContain("1 installment with payments recorded against it");
    expect(p.fingerprint).toMatch(/^[0-9a-f]{32}$/);
    expect(db.tables.expected_payments).toHaveLength(3);
    // The same records and params give the same fingerprint.
    expect((await previewAction(ctxOf(db), { action: "set_expected_payments", params: ALBEMARLE })).fingerprint).toBe(p.fingerprint);
  });

  it("applies with the fingerprint, logs, and replays the key without writing twice", async () => {
    const db = seed();
    const p = await previewAction(ctxOf(db), { action: "set_expected_payments", params: ALBEMARLE });
    const body = { action: p.action, params: p.params, fingerprint: p.fingerprint, key: "prop-1", approved_by: "Stuart <stuart@turnrow.farm>" };
    const a = await applyAction(ctxOf(db), body);
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ applied: true, key: "prop-1", result: { removed: 1, added: 2, kept: 1, total: 378516.71 } });
    const ids = db.tables.expected_payments.map((e) => e.id);
    expect(ids).toContain("e2");
    expect(ids).toContain("eg");
    expect(ids).not.toContain("e1");
    expect(db.tables.expected_payments.find((e) => e.due_date === "2027-07-01")).toMatchObject({ year: 2026, expected_amount: 75703.34, organization_id: ORG });
    expect(db.tables.ops_action_log).toHaveLength(1);
    expect(db.tables.ops_action_log[0]).toMatchObject({ key: "prop-1", outcome: "applied", approved_by: "Stuart <stuart@turnrow.farm>", organization_id: ORG });
    const again = await applyAction(ctxOf(db), body);
    expect(again).toMatchObject({ status: 200, body: { replay: true, applied: true } });
    expect(db.tables.expected_payments).toHaveLength(4);
    expect(db.tables.ops_action_log).toHaveLength(1);
  });

  it("answers 409 stale when the records moved since the preview, and changes nothing", async () => {
    const db = seed();
    const p = await previewAction(ctxOf(db), { action: "set_expected_payments", params: ALBEMARLE });
    db.tables.expected_payments.find((e) => e.id === "e1")!.expected_amount = 2000;
    const a = await applyAction(ctxOf(db), { action: p.action, params: p.params, fingerprint: p.fingerprint, key: "prop-2", approved_by: "Stuart" });
    expect(a.status).toBe(409);
    expect(a.body).toMatchObject({ stale: true });
    expect((a.body.preview as { fingerprint: string }).fingerprint).not.toBe(p.fingerprint);
    expect(db.tables.expected_payments.find((e) => e.id === "e1")).toBeTruthy();
    expect(db.tables.ops_action_log[0]).toMatchObject({ outcome: "stale" });
  });

  it("refuses bad params and reads only its own organization", async () => {
    const db = seed();
    await expect(previewAction(ctxOf(db), { action: "set_expected_payments", params: { ...ALBEMARLE, installments: [{ due_date: "2026-13-01", amount: 5 }] } })).rejects.toMatchObject({ status: 400 });
    await expect(previewAction(ctxOf(db), { action: "set_expected_payments", params: { ...ALBEMARLE, installments: [{ label: "Government payment share (x)", due_date: "2026-10-01", amount: 5 }] } })).rejects.toMatchObject({ status: 400 });
    await expect(previewAction(ctxOf(db), { action: "nope", params: {} })).rejects.toMatchObject({ status: 400, extra: { actions: expect.arrayContaining(["set_expected_payments"]) } });
    await previewAction(ctxOf(db), { action: "set_expected_payments", params: ALBEMARLE });
    for (const r of db.reads) expect(r.filters).toContainEqual({ op: "eq", col: "organization_id", value: ORG });
  });
});

describe("the other actions", () => {
  it("sets a crop share year's crops and shows the projected rent; refuses a cash lease", async () => {
    const db = seed();
    const p = await previewAction(ctxOf(db), { action: "set_crop_share_assumptions", params: { lease: "l1", year: 2026, crops: [{ crop: "Corn", acres: 400, expected_yield: 200, expected_price: 4.5 }] } });
    expect(p.headline).toContain("$36,000.00");
    const a = await applyAction(ctxOf(db), { action: p.action, params: p.params, fingerprint: p.fingerprint, key: "k3", approved_by: "Stuart" });
    expect(a.status).toBe(200);
    expect(db.tables.lease_year_assumptions[0]).toMatchObject({ lease_id: "l1", year: 2026, organization_id: ORG });
    await expect(previewAction(ctxOf(db), { action: "set_crop_share_assumptions", params: { lease: "Smith cash", year: 2026, crops: [{ crop: "Corn" }] } })).rejects.toMatchObject({ status: 422 });
  });

  it("corrects a tax statement's delinquent date, and leaves a paid one alone", async () => {
    const db = seed();
    const p = await previewAction(ctxOf(db), { action: "set_tax_statement_dates", params: { statement: "ts1", delinquent_date: "2027-01-01" } });
    expect(p.changes).toBe(1);
    expect(p.rows).toEqual([["Delinquent date", "2026-01-01", "2027-01-01"]]);
    const a = await applyAction(ctxOf(db), { action: p.action, params: p.params, fingerprint: p.fingerprint, key: "k4", approved_by: "Stuart" });
    expect(a.status).toBe(200);
    expect(db.tables.tax_statements.find((s) => s.id === "ts1")!.delinquent_date).toBe("2027-01-01");
    const refused = await applyAction(ctxOf(db), { action: "set_tax_statement_dates", params: { statement: "ts2", delinquent_date: "2026-02-01" }, fingerprint: "x", key: "k5", approved_by: "Stuart" });
    expect(refused.status).toBe(422);
    expect(db.tables.ops_action_log.at(-1)).toMatchObject({ key: "k5", outcome: "refused" });
  });

  it("links land to a lease once, and sets a schedule whose percents add to 100", async () => {
    const db = seed();
    const p = await previewAction(ctxOf(db), { action: "add_land_to_lease", params: { lease: "l1", property: "Long Pond" } });
    expect(p.params).toMatchObject({ property: "p2", leased_acres: 113.2 });
    await applyAction(ctxOf(db), { action: p.action, params: p.params, fingerprint: p.fingerprint, key: "k6", approved_by: "Stuart" });
    await expect(previewAction(ctxOf(db), { action: "add_land_to_lease", params: { lease: "l1", property: "Long Pond" } })).rejects.toMatchObject({ status: 422 });
    await expect(previewAction(ctxOf(db), { action: "set_payment_schedule", params: { lease: "l1", schedule: [{ month: 12, day: 10, percent: 80 }] } })).rejects.toMatchObject({ status: 400 });
    const s = await previewAction(ctxOf(db), { action: "set_payment_schedule", params: { lease: "l1", schedule: [{ label: "Provisional", month: 12, day: 10, percent: 80 }, { label: "Rest", month: 12, day: 31, percent: 20 }] } });
    expect(s.changes).toBe(2);
  });

  it("needs a key, approved_by and a fingerprint to apply", async () => {
    const db = seed();
    expect((await applyAction(ctxOf(db), { action: "set_tax_statement_dates", params: {} })).status).toBe(400);
    expect((await applyAction(ctxOf(db), { action: "set_tax_statement_dates", params: {}, key: "k", fingerprint: "f" })).status).toBe(400);
  });
});
