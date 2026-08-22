import { describe, expect, it } from "vitest";
import { syncTenantsFromEntities } from "./farmSync";

// A tiny in-memory stand-in for the tenants table: enough of the
// supabase query chain for syncTenantsFromEntities.
function fakeTenants(initial: Array<Record<string, unknown>>) {
  const rows = initial.map((r) => ({ ...r }));
  const client = {
    from(table: string) {
      if (table !== "tenants") throw new Error("unexpected table " + table);
      return {
        select() {
          return {
            eq: async () => ({ data: rows.map((r) => ({ ...r })) }),
          };
        },
        update(patch: Record<string, unknown>) {
          return {
            eq: async (_col: string, id: string) => {
              const r = rows.find((x) => x.id === id);
              if (r) Object.assign(r, patch);
              return { data: null };
            },
          };
        },
        insert(row: Record<string, unknown>) {
          const inserted = { id: `t${rows.length + 1}`, ...row };
          rows.push(inserted);
          return { select: () => ({ single: async () => ({ data: { id: inserted.id } }) }) };
        },
      };
    },
  };
  return { client, rows };
}

const conn = { id: "c1", organization_id: "org" };

describe("syncTenantsFromEntities", () => {
  it("creates a tenant per farming entity and links an existing tenant by owner name", async () => {
    const { client, rows } = fakeTenants([
      { id: "t1", name: "The Albemarle Corporation", farm_connection_id: null, farm_entity_id: null },
      { id: "t2", name: "Joe McCullough, LLC", farm_connection_id: null, farm_entity_id: null },
    ]);
    const r = await syncTenantsFromEntities(client as never, conn, [
      { id: "e1", name: "ALBEMARLE CORP" },
      { id: "e2", name: "Sykes Pond Farms LLC" },
    ], "Albemarle Farms");
    expect(r).toEqual({ created: 1, linked: 1 });
    const t1 = rows.find((x) => x.id === "t1")!;
    expect(t1.farm_connection_id).toBe("c1");
    expect(t1.farm_entity_id).toBe("e1");
    expect(t1.name).toBe("The Albemarle Corporation"); // the owner's name stays
    const made = rows.find((x) => x.farm_entity_id === "e2")!;
    expect(made.name).toBe("Sykes Pond Farms LLC");
    expect(made.farm_connection_id).toBe("c1");
    expect(rows.find((x) => x.id === "t2")!.farm_connection_id).toBeNull();
  });
  it("is idempotent and refreshes only the remembered entity name", async () => {
    const { client, rows } = fakeTenants([
      { id: "t1", name: "My name for them", farm_connection_id: "c1", farm_entity_id: "e1", farm_entity_name: "Old" },
    ]);
    const r = await syncTenantsFromEntities(client as never, conn, [{ id: "e1", name: "Renamed Farms" }], null);
    expect(r).toEqual({ created: 0, linked: 0 });
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("My name for them");
    expect(rows[0].farm_entity_name).toBe("Renamed Farms");
  });
  it("a pre-entity connection links or creates one whole-operation tenant", async () => {
    const { client, rows } = fakeTenants([]);
    await syncTenantsFromEntities(client as never, conn, [], "Smith Farms");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Smith Farms", farm_connection_id: "c1", farm_entity_id: null });
    await syncTenantsFromEntities(client as never, conn, [], "Smith Farms");
    expect(rows).toHaveLength(1);
  });
});
