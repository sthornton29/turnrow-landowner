import { describe, expect, it } from "vitest";
import { fakeDb } from "./testUtils/fakeDb";
import { recomputeOrgDrift } from "./assumptionDriftSync";

// The whole-org recompute against an in-memory database: a committed
// tenant-sourced price whose cache moved produces exactly one drift row,
// reruns are idempotent, a reverted cache reconciles the row away, and
// EVERY read carries the explicit organization filter (the cron client
// is the service role and must never rely on RLS).

function seed() {
  return fakeDb({
    leases: [{ id: "L1", organization_id: "org", tenant_id: "t1", status: "active" }],
    lease_year_assumptions: [
      {
        id: "a1",
        organization_id: "org",
        lease_id: "L1",
        year: 2026,
        data: {
          crops: [
            {
              crop: "Corn",
              practice: null,
              acres: 100,
              expected_yield: 185,
              expected_price: 4.2,
              sources: { expected_price: { kind: "tenant_projected", as_of: "2026-08-01" } },
            },
          ],
        },
      },
    ],
    lease_lands: [
      { organization_id: "org", lease_id: "L1", property_id: "p1", field_id: "f1" },
    ],
    field_mappings: [
      {
        organization_id: "org",
        farm_connection_id: "c1",
        remote_field_id: "r1",
        local_field_id: "f1",
        local_property_id: null,
        remote_entity_id: null,
        status: "confirmed",
      },
    ],
    tenants: [{ id: "t1", organization_id: "org", farm_connection_id: null, farm_entity_id: null, farm_entity_name: null }],
    fields: [{ id: "f1", organization_id: "org", property_id: "p1" }],
    farm_connections: [
      {
        id: "c1",
        organization_id: "org",
        scopes: { yields: true, projected_prices: true, projected_yields: true },
        last_synced_at: "2026-08-31T12:00:00Z",
      },
    ],
    farm_field_data: [
      {
        organization_id: "org",
        farm_connection_id: "c1",
        remote_field_id: "r1",
        crop_year: 2026,
        crop: "Corn",
        planted_acres: 100,
        irrigated_acres: null,
        dryland_acres: null,
        harvested_acres: null,
        harvest_status: null,
        production_units: null,
        production_unit: null,
      },
    ],
    farm_projected_yields: [],
    farm_marketing_prices: [
      {
        organization_id: "org",
        farm_connection_id: "c1",
        crop_year: 2026,
        crop: "Corn",
        projected_avg_price: 4.55,
        unit: "usd_per_bu",
        is_final: false,
        as_of: "2026-08-30",
        remote_entity_id: null,
      },
    ],
    lease_assumption_drift: [],
  });
}

describe("recomputeOrgDrift", () => {
  it("writes one drift row for the moved committed price", async () => {
    const db = seed();
    const r = await recomputeOrgDrift(db.client, "org");
    expect(r).toEqual({ leases: 1, rows: 1 });
    expect(db.tables.lease_assumption_drift).toHaveLength(1);
    expect(db.tables.lease_assumption_drift[0]).toMatchObject({
      organization_id: "org",
      lease_id: "L1",
      year: 2026,
      crop: "Corn",
      practice: "blended",
      field: "expected_price",
      committed_value: 4.2,
      tenant_value: 4.55,
      tenant_kind: "tenant_projected",
      tenant_as_of: "2026-08-30",
      is_final_price: false,
      farm_connection_id: "c1",
    });
  });

  it("is idempotent: a rerun neither duplicates nor refreshes detected_at", async () => {
    const db = seed();
    await recomputeOrgDrift(db.client, "org");
    const first = db.tables.lease_assumption_drift[0].detected_at;
    await recomputeOrgDrift(db.client, "org");
    expect(db.tables.lease_assumption_drift).toHaveLength(1);
    expect(db.tables.lease_assumption_drift[0].detected_at).toBe(first);
  });

  it("reconciles a stale row away when the cache moves back", async () => {
    const db = seed();
    await recomputeOrgDrift(db.client, "org");
    expect(db.tables.lease_assumption_drift).toHaveLength(1);
    db.tables.farm_marketing_prices[0].projected_avg_price = 4.2;
    const r = await recomputeOrgDrift(db.client, "org");
    expect(r.rows).toBe(0);
    expect(db.tables.lease_assumption_drift).toHaveLength(0);
  });

  it("a final price flags is_final_price and tenant_final", async () => {
    const db = seed();
    db.tables.farm_marketing_prices[0].is_final = true;
    await recomputeOrgDrift(db.client, "org");
    expect(db.tables.lease_assumption_drift[0]).toMatchObject({
      is_final_price: true,
      tenant_kind: "tenant_final",
    });
  });

  it("every read filters the organization explicitly (service-role safety)", async () => {
    const db = seed();
    await recomputeOrgDrift(db.client, "org");
    expect(db.reads.length).toBeGreaterThan(0);
    for (const read of db.reads) {
      expect(
        read.filters.some((f) => f.op === "eq" && f.col === "organization_id" && f.value === "org"),
        `read of ${read.table} missing the organization filter`
      ).toBe(true);
    }
  });
});
