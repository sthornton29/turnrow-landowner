import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "./testUtils/fakeDb";

// Two lessons pinned here, against the in-memory database:
//
// 1. A FAILED /production pull must never blank harvest data. The sync
//    used to turn any production error into an empty list and then write
//    null harvested acres, status, and production over every field, with
//    the connection card still green. Now the production columns are left
//    out of the upsert (what is cached stays) and the failure shows in
//    sync_detail.
//
// 2. The prior crop year keeps syncing. Harvest often finishes in January
//    and final prices arrive the following spring; a sync that only asks
//    for the current calendar year froze each crop year on December 31.

const state = vi.hoisted(() => ({
  scopes: {
    fields: true,
    plantings: true,
    harvest: true,
    yields: true,
    projected_prices: false,
    projected_yields: false,
  } as Record<string, boolean>,
  plantings: {} as Record<number, Array<Record<string, unknown>>>,
  production: {} as Record<number, Array<Record<string, unknown>>>,
  prices: {} as Record<number, Array<Record<string, unknown>>>,
  plantingsError: {} as Record<number, Error>,
  productionError: {} as Record<number, Error>,
  calls: { plantings: [] as number[], production: [] as number[], prices: [] as number[] },
}));

vi.mock("@/lib/farmCrypto", () => ({ decryptSecret: () => "token" }));
vi.mock("@/lib/tenantAutoFill", () => ({
  autoFillTenantAssumptions: vi.fn(async () => ({ leases: 0, values: 0 })),
}));
vi.mock("@/lib/farmApi", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./farmApi")>();
  return {
    ...orig,
    getHandshake: async () => ({
      operation_name: "Turnrow Farm",
      landowner_name: null,
      scopes: { ...state.scopes },
      field_count: 1,
      api_version: "v1",
      entities: [],
    }),
    getFields: async () => [],
    getPlantings: async (_token: string, year: number) => {
      state.calls.plantings.push(year);
      if (state.plantingsError[year]) throw state.plantingsError[year];
      return state.plantings[year] ?? [];
    },
    getProduction: async (_token: string, year: number) => {
      state.calls.production.push(year);
      if (state.productionError[year]) throw state.productionError[year];
      return state.production[year] ?? [];
    },
    getMarketingPrices: async (_token: string, year: number) => {
      state.calls.prices.push(year);
      return { data: state.prices[year] ?? [], by_entity: [] };
    },
    getProjectedYields: async () => [],
  };
});

import { FarmApiError } from "./farmApi";
import { buildPlantingOnlyRow, syncConnection } from "./farmSync";

const connection = { id: "c1", organization_id: "org", api_key_encrypted: "enc", status: "active" };

// Mid-November 2026: the current crop year is 2026, the prior one 2025.
const NOV = new Date("2026-11-14T18:00:00Z");

function freshDb() {
  return fakeDb({
    farm_connections: [{ id: "c1", organization_id: "org", status: "active", scopes: {} }],
    field_mappings: [],
    fields: [],
    farm_field_data: [],
    farm_marketing_prices: [],
    farm_projected_yields: [],
    tenants: [],
  });
}

const planting = (year: number, over: Record<string, unknown> = {}) => ({
  id: `p-${year}`,
  field_id: "r1",
  field_name: "North 40",
  crop: "Corn",
  crop_year: year,
  planted_acres: 100,
  irrigated_acres: null,
  dryland_acres: null,
  planting_date: `${year}-04-14`,
  varieties: [],
  ...over,
});

const produced = (year: number, over: Record<string, unknown> = {}) => ({
  field_id: "r1",
  crop: "Corn",
  crop_year: year,
  planted_acres: 100,
  harvested_acres: 100,
  harvest_status: "complete",
  production_units: 20000,
  unit: "bu",
  entity_id: "e1",
  entity: "Martin Farms LLC",
  ...over,
});

beforeEach(() => {
  state.scopes.projected_prices = false;
  state.scopes.projected_yields = false;
  state.plantings = {};
  state.production = {};
  state.prices = {};
  state.plantingsError = {};
  state.productionError = {};
  state.calls = { plantings: [], production: [], prices: [] };
});

describe("a failed production pull keeps the harvest data already synced", () => {
  it("leaves harvested acres, status, and production untouched and says so in sync_detail", async () => {
    const db = freshDb();
    const row = () => db.tables.farm_field_data.find((r) => r.crop_year === 2026)!;
    state.plantings[2026] = [planting(2026)];
    state.production[2026] = [produced(2026)];

    let r = await syncConnection(db.client, connection, NOV);
    expect(r.ok).toBe(true);
    expect(row()).toMatchObject({
      planted_acres: 100,
      harvested_acres: 100,
      harvest_status: "complete",
      production_units: 20000,
      production_unit: "bu",
      remote_entity_id: "e1",
    });
    expect(db.tables.farm_connections[0].sync_detail.production).toMatchObject({ state: "ok", rows: 1 });

    // Next run: the farm API times out on /production. The planting
    // still syncs (its acres changed), the harvest columns stay.
    state.plantings[2026] = [planting(2026, { planted_acres: 98 })];
    state.productionError[2026] = new FarmApiError("upstream timeout", 504);
    r = await syncConnection(db.client, connection, NOV);
    expect(r.ok).toBe(true);
    expect(db.tables.farm_field_data.filter((x) => x.crop_year === 2026)).toHaveLength(1);
    expect(row()).toMatchObject({
      planted_acres: 98,
      harvested_acres: 100,
      harvest_status: "complete",
      production_units: 20000,
      production_unit: "bu",
      // The entity came from the production row; the planting names
      // none, so it is not blanked either.
      remote_entity_id: "e1",
      remote_entity_name: "Martin Farms LLC",
    });
    expect(row().payload.production).toMatchObject({ production_units: 20000 });

    const conn = db.tables.farm_connections[0];
    expect(conn.status).toBe("active");
    expect(conn.last_error).toBeNull();
    expect(conn.sync_detail.production).toMatchObject({ state: "error", message: "upstream timeout" });
  });

  it("still saves a planting first seen while production is down, with no harvest values", async () => {
    const db = freshDb();
    state.plantings[2026] = [planting(2026)];
    state.productionError[2026] = new FarmApiError("upstream timeout", 504);
    const r = await syncConnection(db.client, connection, NOV);
    expect(r.ok).toBe(true);
    expect(r.plantings).toBe(1);
    const row = db.tables.farm_field_data[0];
    expect(row).toMatchObject({ crop_year: 2026, crop: "Corn", planted_acres: 100 });
    expect(row.harvest_status ?? null).toBeNull();
    expect(row.harvested_acres ?? null).toBeNull();
  });

  it("a production pull that WORKS and finds nothing still clears stale harvest values", async () => {
    // The distinction that matters: an empty answer is the farm
    // software's own word; a failure is not.
    const db = freshDb();
    state.plantings[2026] = [planting(2026)];
    state.production[2026] = [produced(2026)];
    await syncConnection(db.client, connection, NOV);
    state.production[2026] = [];
    const r = await syncConnection(db.client, connection, NOV);
    expect(r.ok).toBe(true);
    const row = db.tables.farm_field_data.find((x) => x.crop_year === 2026)!;
    expect(row.harvest_status).toBeNull();
    expect(row.harvested_acres).toBeNull();
    expect(row.production_units).toBeNull();
  });

  it("a share without harvest data (scope 403) is a quiet off, and cached values stay", async () => {
    const db = freshDb();
    state.plantings[2026] = [planting(2026)];
    state.production[2026] = [produced(2026)];
    await syncConnection(db.client, connection, NOV);
    state.productionError[2026] = new FarmApiError("not shared", 403, "not_in_share_scope");
    const r = await syncConnection(db.client, connection, NOV);
    expect(r.ok).toBe(true);
    expect(db.tables.farm_connections[0].sync_detail.production.state).toBe("off");
    expect(db.tables.farm_field_data.find((x) => x.crop_year === 2026)!.harvest_status).toBe("complete");
  });

  it("a revoked share on the production pull still ends the connection", async () => {
    const db = freshDb();
    state.plantings[2026] = [planting(2026)];
    state.productionError[2026] = new FarmApiError("ended", 403, "share_revoked");
    const r = await syncConnection(db.client, connection, NOV);
    expect(r.ok).toBe(false);
    expect(db.tables.farm_connections[0].status).toBe("revoked");
  });

  it("buildPlantingOnlyRow carries no production column, and the entity only when the planting names it", () => {
    const bare = buildPlantingOnlyRow(planting(2026) as never, true);
    for (const column of ["harvested_acres", "harvest_status", "production_units", "production_unit", "payload", "remote_entity_id", "remote_entity_name"]) {
      expect(column in bare).toBe(false);
    }
    expect(bare).toMatchObject({ remote_field_id: "r1", crop: "Corn", planted_acres: 100, yield_shared: true });
    const named = buildPlantingOnlyRow(planting(2026, { entity_id: "e9", entity: "Other LLC" }) as never, false);
    expect(named).toMatchObject({ remote_entity_id: "e9", remote_entity_name: "Other LLC" });
    expect("harvest_status" in named).toBe(false);
  });
});

describe("the prior crop year syncs on every run", () => {
  it("asks for the prior and the current crop year and stores each under its own year", async () => {
    const db = freshDb();
    state.scopes.projected_prices = true;
    state.plantings[2025] = [planting(2025)];
    state.production[2025] = [produced(2025, { harvest_status: "in_progress", harvested_acres: 0, production_units: 9000 })];
    state.plantings[2026] = [planting(2026)];
    state.prices[2025] = [{ crop: "Corn", crop_year: 2025, unit: "usd_per_bu", projected_avg_price: 4.4, is_final: false, as_of: "2026-01-10" }];
    state.prices[2026] = [{ crop: "Corn", crop_year: 2026, unit: "usd_per_bu", projected_avg_price: 4.6, is_final: false, as_of: "2026-11-01" }];

    let r = await syncConnection(db.client, connection, NOV);
    expect(r.ok).toBe(true);
    expect(r.plantings).toBe(1); // the current year's count
    // The current year goes first: it matters most if a run is cut short.
    expect(state.calls.plantings).toEqual([2026, 2025]);
    expect(state.calls.production).toEqual([2026, 2025]);
    expect(state.calls.prices).toEqual([2026, 2025]);
    expect(db.tables.farm_field_data.map((x) => x.crop_year).sort()).toEqual([2025, 2026]);
    const y2025 = () => db.tables.farm_field_data.find((x) => x.crop_year === 2025)!;
    expect(y2025().harvest_status).toBe("in_progress");

    // The next run (harvest wrapped up, sales complete): the 2025 row
    // and the 2025 price both move on, a year after planting.
    state.production[2025] = [produced(2025)];
    state.prices[2025] = [{ crop: "Corn", crop_year: 2025, unit: "usd_per_bu", projected_avg_price: 4.52, is_final: true, as_of: "2026-11-10" }];
    r = await syncConnection(db.client, connection, NOV);
    expect(r.ok).toBe(true);
    expect(y2025()).toMatchObject({ harvest_status: "complete", harvested_acres: 100, production_units: 20000 });
    const price2025 = db.tables.farm_marketing_prices.find((x) => x.crop_year === 2025)!;
    expect(price2025).toMatchObject({ projected_avg_price: 4.52, is_final: true });
    expect(db.tables.farm_marketing_prices).toHaveLength(2);

    const detail = db.tables.farm_connections[0].sync_detail;
    expect(detail.year).toBe(2026);
    expect(detail.prices).toMatchObject({ state: "ok", rows: 1 });
    expect(detail.prior).toMatchObject({ year: 2025, production: { state: "ok" }, prices: { state: "ok", rows: 1 } });
  });

  it("in January the year just ended is still synced (harvest finishing after December 31)", async () => {
    const db = freshDb();
    state.plantings[2026] = [planting(2026)];
    state.production[2026] = [produced(2026)];
    const r = await syncConnection(db.client, connection, new Date("2027-01-15T18:00:00Z"));
    expect(r.ok).toBe(true);
    expect(state.calls.plantings).toEqual([2027, 2026]);
    expect(r.plantings).toBe(0); // nothing planted for 2027 yet
    expect(db.tables.farm_field_data[0]).toMatchObject({ crop_year: 2026, harvest_status: "complete" });
  });

  it("turns the crop year over at midnight Central, not at midnight UTC", async () => {
    const db = freshDb();
    // 9 pm on December 31 in Alabama is already January 1 in UTC.
    await syncConnection(db.client, connection, new Date("2027-01-01T03:00:00Z"));
    expect(state.calls.plantings).toEqual([2026, 2025]);
    expect(db.tables.farm_connections[0].sync_detail.year).toBe(2026);
  });

  it("a failed prior-year fetch is noted and does not block the current year", async () => {
    const db = freshDb();
    state.plantingsError[2025] = new FarmApiError("upstream timeout", 504);
    state.plantings[2026] = [planting(2026)];
    const r = await syncConnection(db.client, connection, NOV);
    expect(r.ok).toBe(true);
    expect(r.plantings).toBe(1);
    expect(db.tables.farm_field_data).toHaveLength(1);
    expect(db.tables.farm_field_data[0].crop_year).toBe(2026);
    const conn = db.tables.farm_connections[0];
    expect(conn.status).toBe("active");
    expect(conn.last_error).toBeNull();
    expect(conn.sync_detail.prior).toMatchObject({ year: 2025, plantings: { state: "error", message: "upstream timeout" } });
  });

  it("a failed current-year fetch still fails the sync loudly, but the prior year is saved first", async () => {
    const db = freshDb();
    state.plantings[2025] = [planting(2025)];
    state.production[2025] = [produced(2025)];
    state.plantingsError[2026] = new FarmApiError("upstream timeout", 504);
    const r = await syncConnection(db.client, connection, NOV);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("upstream timeout");
    expect(db.tables.farm_field_data).toHaveLength(1);
    expect(db.tables.farm_field_data[0]).toMatchObject({ crop_year: 2025, harvest_status: "complete" });
    const conn = db.tables.farm_connections[0];
    expect(conn.status).toBe("error");
    expect(conn.last_error).toBe("upstream timeout");
    expect(conn.sync_detail.prior).toMatchObject({ year: 2025, production: { state: "ok" } });
  });

  it("a revoked share ends the run at once, whichever year meets it", async () => {
    let db = freshDb();
    state.plantingsError[2026] = new FarmApiError("ended", 403, "share_revoked");
    let r = await syncConnection(db.client, connection, NOV);
    expect(r.ok).toBe(false);
    expect(db.tables.farm_connections[0].status).toBe("revoked");
    expect(state.calls.plantings).toEqual([2026]); // the prior year is not asked for

    db = freshDb();
    state.plantingsError = { 2025: new FarmApiError("ended", 403, "share_revoked") };
    state.plantings[2026] = [planting(2026)];
    r = await syncConnection(db.client, connection, NOV);
    expect(r.ok).toBe(false);
    expect(db.tables.farm_connections[0]).toMatchObject({
      status: "revoked",
      last_error: "Your farmer has ended or changed this share.",
    });
  });
});
