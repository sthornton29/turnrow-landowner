import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "@/lib/testUtils/fakeDb";
import { NO_ACCESS_MESSAGE } from "@/lib/dbErrors";

// Merging an entity used to move only its properties, county spellings,
// and documents, then delete it. By foreign key that delete also cleared
// the entity on tax statements, timber basis accounts, cost-share awards,
// and income records, and removed its registered tax accounts and its
// members' access. These tests pin the full move, against the in-memory
// database (which, like the app before the delete, does no cascading).

const session = vi.hoisted(() => ({
  db: null as unknown as { client: unknown },
  isAdmin: true,
}));

vi.mock("@/lib/auth", () => ({
  requireOrg: async () => ({
    supabase: session.db.client,
    profile: { organization_id: "org", role: session.isAdmin ? "admin" : "user" },
    isAdmin: session.isAdmin,
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
// The real redirect() throws to leave the action; so does this one.
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));

import { createEntity, mergeEntity } from "./actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};
const none = { error: null };

function seed(): FakeDb {
  return fakeDb({
    entities: [
      { id: "old", organization_id: "org", name: "Thornton Farms" },
      { id: "new", organization_id: "org", name: "Thornton Family Farms LLC" },
    ],
    properties: [
      { id: "p1", organization_id: "org", entity_id: "old" },
      { id: "p2", organization_id: "org", entity_id: "new" },
    ],
    entity_aliases: [{ id: "a1", organization_id: "org", entity_id: "old", alias: "THORNTON FARMS" }],
    documents: [
      { id: "d1", organization_id: "org", entity_type: "entity", entity_id: "old" },
      // A property's document that happens to share the id is not touched.
      { id: "d2", organization_id: "org", entity_type: "property", entity_id: "old" },
    ],
    tax_statements: [
      { id: "s1", organization_id: "org", entity_id: "old", tax_year: 2025 },
      { id: "s2", organization_id: "org", entity_id: null, tax_year: 2025 },
    ],
    entity_accounts: [{ id: "ea1", organization_id: "org", entity_id: "old", county: "Lawrence", state: "AL", account_number: "1001" }],
    timber_accounts: [{ id: "t1", organization_id: "org", entity_id: "old", property_id: "p1" }],
    cost_share_awards: [{ id: "c1", organization_id: "org", entity_id: "old", property_id: "p1" }],
    income_records: [
      { id: "i1", organization_id: "org", entity_id: "old", year: 2019, income_type: "tower", amount: 15000 },
      { id: "i2", organization_id: "org", entity_id: "new", year: 2019, income_type: "solar", amount: 100 },
    ],
    entity_access: [
      { id: "g1", organization_id: "org", user_id: "ann", entity_id: "old" }, // only the old entity
      { id: "g2", organization_id: "org", user_id: "bob", entity_id: "old" }, // both
      { id: "g3", organization_id: "org", user_id: "bob", entity_id: "new" },
      { id: "g4", organization_id: "org", user_id: "cy", entity_id: "new" }, // only the new entity
    ],
  });
}

beforeEach(() => {
  session.isAdmin = true;
});

describe("mergeEntity", () => {
  it("moves everything that hangs on the source to the target, then removes the source", async () => {
    const db = seed();
    session.db = db;
    await expect(mergeEntity(none, form({ source_id: "old", target_id: "new" }))).rejects.toThrow("REDIRECT /entities/new");

    const t = db.tables;
    expect(t.entities.map((e) => e.id)).toEqual(["new"]);
    expect(t.properties.every((p) => p.entity_id === "new")).toBe(true);
    expect(t.entity_aliases[0].entity_id).toBe("new");
    expect(t.documents.find((d) => d.id === "d1")!.entity_id).toBe("new");
    expect(t.documents.find((d) => d.id === "d2")!.entity_id).toBe("old");
    expect(t.tax_statements.map((s) => s.entity_id)).toEqual(["new", null]);
    expect(t.entity_accounts[0]).toMatchObject({ entity_id: "new", account_number: "1001" });
    expect(t.timber_accounts[0].entity_id).toBe("new");
    expect(t.cost_share_awards[0].entity_id).toBe("new");
    expect(t.income_records.map((r) => r.entity_id)).toEqual(["new", "new"]);
  });

  it("gives each member who had the source the target instead, once", async () => {
    const db = seed();
    session.db = db;
    await expect(mergeEntity(none, form({ source_id: "old", target_id: "new" }))).rejects.toThrow("REDIRECT");
    const onTarget = db.tables.entity_access.filter((g) => g.entity_id === "new").map((g) => g.user_id).sort();
    // Ann is added; Bob already had it and is not doubled; Cy is untouched.
    expect(onTarget).toEqual(["ann", "bob", "cy"]);
    expect(db.tables.entity_access.find((g) => g.user_id === "ann" && g.entity_id === "new")).toMatchObject({ organization_id: "org" });
  });

  it("stops before the delete when a move fails, and running it again finishes the job", async () => {
    const db = seed();
    session.db = db;
    db.failOn("tax_statements", "update", "connection reset");
    const result = await mergeEntity(none, form({ source_id: "old", target_id: "new" }));
    expect(result.error).toMatch(/^The merge stopped at the tax statements, and nothing was deleted\./);
    expect(result.error).not.toContain("connection reset");
    // The source is still there, with everything not yet moved on it.
    expect(db.tables.entities.map((e) => e.id)).toEqual(["old", "new"]);
    expect(db.tables.tax_statements[0].entity_id).toBe("old");
    expect(db.tables.income_records[0].entity_id).toBe("old");
    expect(db.tables.entity_access.filter((g) => g.entity_id === "new")).toHaveLength(2);

    await expect(mergeEntity(none, form({ source_id: "old", target_id: "new" }))).rejects.toThrow("REDIRECT /entities/new");
    expect(db.tables.entities.map((e) => e.id)).toEqual(["new"]);
    expect(db.tables.tax_statements[0].entity_id).toBe("new");
    expect(db.tables.income_records[0].entity_id).toBe("new");
  });

  it("stops before the delete when member access cannot be moved", async () => {
    const db = seed();
    session.db = db;
    db.failOn("entity_access", "insert", "new row violates row-level security policy");
    const result = await mergeEntity(none, form({ source_id: "old", target_id: "new" }));
    expect(result.error).toContain("The merge stopped at member access, and nothing was deleted.");
    expect(result.error).not.toContain("row-level security");
    expect(db.tables.entities.map((e) => e.id)).toEqual(["old", "new"]);
  });

  it("says so when the old entity itself cannot be removed", async () => {
    const db = seed();
    session.db = db;
    db.failOn("entities", "delete", "boom");
    const result = await mergeEntity(none, form({ source_id: "old", target_id: "new" }));
    expect(result.error).toBe("Everything was moved, but the old entity could not be removed. Try the merge again to finish it.");
    expect(db.tables.entities).toHaveLength(2);
  });

  it("changes nothing for a member who is not an admin, a missing target, or the same entity twice", async () => {
    const db = seed();
    session.db = db;
    const before = JSON.stringify(db.tables);
    session.isAdmin = false;
    expect(await mergeEntity(none, form({ source_id: "old", target_id: "new" }))).toEqual({ error: NO_ACCESS_MESSAGE });
    session.isAdmin = true;
    expect((await mergeEntity(none, form({ source_id: "old", target_id: "gone" }))).error).toMatch(/was not found, so nothing was changed/);
    expect((await mergeEntity(none, form({ source_id: "old", target_id: "old" }))).error).toBe("Pick the entity to merge into.");
    expect(JSON.stringify(db.tables)).toBe(before);
  });
});

describe("createEntity", () => {
  it("creates the entity and says ok", async () => {
    const db = fakeDb({ entities: [] });
    session.db = db;
    expect(await createEntity(none, form({ name: "  River Trust  ", entity_type: "trust" }))).toEqual({ error: null, ok: true });
    expect(db.tables.entities[0]).toMatchObject({ organization_id: "org", name: "River Trust", entity_type: "trust" });
  });

  it("hands a refused or failed insert back to the form in plain words", async () => {
    const db = fakeDb({ entities: [] });
    session.db = db;
    db.failOn("entities", "insert", "new row violates row-level security policy for table \"entities\"");
    expect(await createEntity(none, form({ name: "River Trust", entity_type: "trust" }))).toEqual({ error: NO_ACCESS_MESSAGE });
    db.failOn("entities", "insert", "some database text");
    expect(await createEntity(none, form({ name: "River Trust", entity_type: "trust" }))).toEqual({
      error: "The entity was not created. Please try again.",
    });
    expect(await createEntity(none, form({ name: "   " }))).toEqual({ error: "Give the entity a name." });
    expect(db.tables.entities).toHaveLength(0);
  });
});
