// LIVE entity-scoping test for migration 0034. Provisions a scratch
// organization with two entities in the REAL Supabase project, creates
// an admin and an entity-A-only user, and asserts isolation through
// each user's own session, including the Ask assistant's long-tail SQL
// path (assistant_query). Opt in AFTER 0034 has run:
//   RLS_TEST=1 npx vitest run lib/entityScope.live.test.ts
// Needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and
// SUPABASE_SERVICE_ROLE_KEY (.env.local). Everything it creates is
// deleted at the end (org cascade + both auth users).
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const live = process.env.RLS_TEST === "1";

function loadEnv() {
  for (const name of [".env.local", ".env.vercel.local"]) {
    const p = path.join(process.cwd(), name);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const i = line.indexOf("=");
      if (i < 0 || line.startsWith("#")) continue;
      const k = line.slice(0, i).trim();
      if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
    }
  }
}

// Insert one row and hand back its id, failing loudly with context.
async function insert(
  client: SupabaseClient,
  table: string,
  row: Record<string, unknown>
): Promise<string> {
  const { data, error } = await client.from(table).insert(row).select("id").single();
  if (error || !data) throw new Error(`${table} insert failed: ${error?.message}`);
  return data.id as string;
}

describe.skipIf(!live)("entity scoping (live, migration 0034)", () => {
  it("isolates a user to their granted entity across tables and the assistant path", async () => {
    loadEnv();
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    expect(url && anon && serviceKey, "Supabase env missing").toBeTruthy();

    const service = createClient(url, serviceKey, { auth: { persistSession: false } });
    const stamp = Date.now();
    const adminEmail = `rls-test-admin-${stamp}@example.com`;
    const userEmail = `rls-test-user-${stamp}@example.com`;
    const password = `Rls-test-${stamp}!`;

    let orgId = "";
    let adminId = "";
    let userId = "";
    try {
      // ---- Bootstrap: only the org and the auth users need the
      // service role (the private-schema triggers on parcels etc. are
      // granted to authenticated, not service_role, and the app never
      // seeds those tables via service role either). Everything else
      // is created through the ADMIN'S OWN SESSION, which doubles as
      // the admin write-path test.
      orgId = await insert(service, "organizations", { name: `RLS test org ${stamp}` });
      const mkUser = async (email: string) => {
        const { data, error } = await service.auth.admin.createUser({
          email, password, email_confirm: true,
        });
        if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
        return data.user.id;
      };
      adminId = await mkUser(adminEmail);
      userId = await mkUser(userEmail);
      // The signup trigger created the profiles; attach org + roles.
      const attach = async (id: string, role: string) => {
        const { error } = await service.from("profiles")
          .update({ organization_id: orgId, role }).eq("id", id);
        if (error) throw new Error(`profile attach failed: ${error.message}`);
      };
      await attach(adminId, "admin");
      await attach(userId, "user");

      const signIn = async (email: string) => {
        const c = createClient(url, anon, { auth: { persistSession: false } });
        const { error } = await c.auth.signInWithPassword({ email, password });
        if (error) throw new Error(`sign in failed: ${error.message}`);
        return c;
      };
      const asAdmin = await signIn(adminEmail);
      const asUser = await signIn(userEmail);

      // ---- Seed the two-entity fixture AS THE ADMIN ----
      const entityA = await insert(asAdmin, "entities", {
        organization_id: orgId, name: "Entity A", entity_type: "llc",
      });
      const entityB = await insert(asAdmin, "entities", {
        organization_id: orgId, name: "Entity B", entity_type: "llc",
      });
      const propA = await insert(asAdmin, "properties", {
        organization_id: orgId, name: "A Place", entity_id: entityA,
      });
      const propB = await insert(asAdmin, "properties", {
        organization_id: orgId, name: "B Place", entity_id: entityB,
      });
      await insert(asAdmin, "properties", {
        organization_id: orgId, name: "Unassigned Place", entity_id: null,
      });
      await insert(asAdmin, "parcels", {
        organization_id: orgId, property_id: propA, parcel_number: "11 22 33",
      });
      await insert(asAdmin, "parcels", {
        organization_id: orgId, property_id: propB, parcel_number: "44 55 66",
      });
      await insert(asAdmin, "fields", { organization_id: orgId, property_id: propA, name: "A field" });
      await insert(asAdmin, "fields", { organization_id: orgId, property_id: propB, name: "B field" });
      const tenant = await insert(asAdmin, "tenants", { organization_id: orgId, name: "Test Farmer" });
      const leaseA = await insert(asAdmin, "leases", {
        organization_id: orgId, tenant_id: tenant, lease_type: "agricultural",
        name: "A lease", status: "active", rent_structure: "cash",
      });
      const leaseB = await insert(asAdmin, "leases", {
        organization_id: orgId, tenant_id: tenant, lease_type: "agricultural",
        name: "B lease", status: "active", rent_structure: "cash",
      });
      await insert(asAdmin, "lease_lands", {
        organization_id: orgId, lease_id: leaseA, property_id: propA, leased_acres: 100,
      });
      await insert(asAdmin, "lease_lands", {
        organization_id: orgId, lease_id: leaseB, property_id: propB, leased_acres: 100,
      });
      const docA = await insert(asAdmin, "documents", {
        organization_id: orgId, entity_type: "property", entity_id: propA,
        file_name: "a.pdf", storage_path: `${orgId}/property/a.pdf`, title: "A doc",
      });
      const docOrg = await insert(asAdmin, "documents", {
        organization_id: orgId, entity_type: "organization", entity_id: orgId,
        file_name: "org.pdf", storage_path: `${orgId}/organization/org.pdf`, title: "Org doc",
      });
      await insert(asAdmin, "document_properties", {
        organization_id: orgId, document_id: docA, property_id: propA,
      });
      // The admin grants entity A to the restricted user through the UI path.
      await insert(asAdmin, "entity_access", {
        organization_id: orgId, user_id: userId, entity_id: entityA,
      });

      const names = async (c: SupabaseClient, table: string, col = "name") => {
        const { data, error } = await c.from(table).select(col);
        if (error) throw new Error(`${table} select failed: ${error.message}`);
        return (data ?? []).map((r) => (r as unknown as Record<string, string>)[col]).sort();
      };

      // ---- Read isolation, table by table ----
      expect(await names(asAdmin, "properties")).toEqual(["A Place", "B Place", "Unassigned Place"]);
      expect(await names(asUser, "properties")).toEqual(["A Place"]);
      expect(await names(asAdmin, "parcels", "parcel_number")).toEqual(["11 22 33", "44 55 66"]);
      expect(await names(asUser, "parcels", "parcel_number")).toEqual(["11 22 33"]);
      expect(await names(asUser, "fields")).toEqual(["A field"]);
      expect(await names(asAdmin, "leases")).toEqual(["A lease", "B lease"]);
      expect(await names(asUser, "leases")).toEqual(["A lease"]);
      expect(await names(asAdmin, "documents", "title")).toEqual(["A doc", "Org doc"]);
      expect(await names(asUser, "documents", "title")).toEqual(["A doc"]);
      expect(await names(asAdmin, "entities")).toEqual(["Entity A", "Entity B"]);
      expect(await names(asUser, "entities")).toEqual(["Entity A"]);

      // ---- The assistant's long-tail SQL path (SECURITY INVOKER) ----
      const ask = async (c: SupabaseClient, q: string) => {
        const { data, error } = await c.rpc("assistant_query", { q });
        if (error) throw new Error(`assistant_query failed: ${error.message}`);
        return data as Array<Record<string, unknown>>;
      };
      expect(await ask(asAdmin, "select count(*)::int as n from properties")).toEqual([{ n: 3 }]);
      expect(await ask(asUser, "select count(*)::int as n from properties")).toEqual([{ n: 1 }]);
      const joined = await ask(
        asUser,
        "select l.name from leases l join lease_lands ll on ll.lease_id = l.id join properties p on p.id = ll.property_id order by l.name"
      );
      expect(joined).toEqual([{ name: "A lease" }]);
      // Probing another entity's row by name filters silently: empty,
      // never an error that would signal existence.
      expect(await ask(asUser, "select name from properties where name = 'B Place'")).toEqual([]);

      // ---- Write-side rules ----
      // The user CAN attach a document to their entity's property (and
      // read it back in the same insert - the RETURNING path migration
      // 0037 fixed).
      const userDoc = await insert(asUser, "documents", {
        organization_id: orgId, entity_type: "property", entity_id: propA,
        file_name: "u.pdf", storage_path: `${orgId}/property/u.pdf`, title: "User doc",
      });
      expect(userDoc).toBeTruthy();
      // The user CANNOT graft an admin-only document onto their property
      // (the read-escalation the design review caught).
      const graft = await asUser.from("document_properties").insert({
        organization_id: orgId, document_id: docOrg, property_id: propA,
      });
      expect(graft.error, "document graft must be rejected").toBeTruthy();
      // The user CANNOT create a lease (parent creation is admin work).
      const leaseTry = await asUser.from("leases").insert({
        organization_id: orgId, tenant_id: tenant, lease_type: "agricultural",
        name: "User lease", status: "draft", rent_structure: "cash",
      });
      expect(leaseTry.error, "user lease creation must be rejected").toBeTruthy();
    } finally {
      // ---- Teardown: the org cascade wipes every row; then the users.
      if (orgId) await service.from("organizations").delete().eq("id", orgId);
      if (adminId) await service.auth.admin.deleteUser(adminId);
      if (userId) await service.auth.admin.deleteUser(userId);
    }
  }, 120_000);
});
