import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "./testUtils/fakeDb";

// The scope-flip fixture: one connection whose farm-side scopes change
// between sync runs proves grant-later and revoke-later both take
// effect on the very next sync, with no reconnect, and that endpoint
// failures surface instead of vanishing (the Martin Trusts lesson).

const state = vi.hoisted(() => ({
  scopes: {
    fields: true,
    plantings: true,
    harvest: true,
    yields: true,
    projected_prices: false,
    projected_yields: false,
  } as Record<string, boolean>,
  priceError: null as Error | null,
  prices: {
    data: [
      {
        crop: "Corn",
        crop_year: 2026,
        unit: "usd_per_bu",
        projected_avg_price: 4.55,
        is_final: false,
        as_of: "2026-08-30",
      },
    ],
    by_entity: [] as Array<Record<string, unknown>>,
  },
  yields: [
    {
      field_id: "r1",
      crop: "Corn",
      crop_year: 2026,
      planted_acres: 100,
      yield_per_acre: 185,
      unit: "bu_per_acre",
      basis: "expected",
      practices: null,
    },
  ],
  priceCalls: 0,
  yieldCalls: 0,
}));

vi.mock("@/lib/farmCrypto", () => ({ decryptSecret: () => "token" }));
vi.mock("@/lib/assumptionDriftSync", () => ({
  recomputeOrgDrift: vi.fn(async () => ({ leases: 0, rows: 0 })),
}));
vi.mock("@/lib/farmApi", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./farmApi")>();
  return {
    ...orig,
    getHandshake: async () => ({
      operation_name: "Turnrow Farm",
      landowner_name: null,
      scopes: { ...state.scopes },
      field_count: 0,
      api_version: "v1",
      entities: [],
    }),
    getFields: async () => [],
    getPlantings: async () => [],
    getProduction: async () => [],
    getMarketingPrices: async () => {
      state.priceCalls++;
      if (state.priceError) throw state.priceError;
      return state.prices;
    },
    getProjectedYields: async () => {
      state.yieldCalls++;
      return state.yields;
    },
  };
});

import { FarmApiError } from "./farmApi";
import { syncConnection } from "./farmSync";

const connection = {
  id: "c1",
  organization_id: "org",
  api_key_encrypted: "enc",
  status: "active",
};

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

beforeEach(() => {
  state.scopes.projected_prices = false;
  state.scopes.projected_yields = false;
  state.priceError = null;
  state.priceCalls = 0;
  state.yieldCalls = 0;
});

describe("syncConnection live scope gating", () => {
  it("grant-later takes effect on the next sync; revoke-later keeps cached rows", async () => {
    const db = freshDb();
    const conn = () => db.tables.farm_connections[0];

    // Run 1: scopes off. No fetch, stored scopes cached off with a
    // checked time, prices area recorded as a quiet "off".
    let r = await syncConnection(db.client, connection);
    expect(r.ok).toBe(true);
    expect(state.priceCalls).toBe(0);
    expect(conn().scopes.projected_prices).toBe(false);
    expect(conn().scopes_checked_at).toBeTruthy();
    expect(conn().sync_detail.prices.state).toBe("off");
    expect(db.tables.farm_marketing_prices).toHaveLength(0);

    // Run 2: the farmer grants both scopes. Same connection, no
    // reconnect: the fetches run and the cache fills.
    state.scopes.projected_prices = true;
    state.scopes.projected_yields = true;
    r = await syncConnection(db.client, connection);
    expect(r.ok).toBe(true);
    expect(state.priceCalls).toBe(1);
    expect(state.yieldCalls).toBe(1);
    expect(conn().scopes.projected_prices).toBe(true);
    expect(conn().sync_detail.prices).toMatchObject({ state: "ok", rows: 1 });
    expect(db.tables.farm_marketing_prices).toHaveLength(1);
    expect(db.tables.farm_marketing_prices[0]).toMatchObject({
      crop: "Corn",
      projected_avg_price: 4.55,
      organization_id: "org",
    });
    expect(db.tables.farm_projected_yields).toHaveLength(1);

    // Run 3: revoked again. The stored scopes flip off next sync, the
    // cached rows STAY (labeled by their as-of in the UI).
    state.scopes.projected_prices = false;
    state.scopes.projected_yields = false;
    r = await syncConnection(db.client, connection);
    expect(r.ok).toBe(true);
    expect(state.priceCalls).toBe(1); // no new fetch
    expect(conn().scopes.projected_prices).toBe(false);
    expect(db.tables.farm_marketing_prices).toHaveLength(1);
  });

  it("a scope 403 that contradicts the handshake corrects the display cache", async () => {
    const db = freshDb();
    state.scopes.projected_prices = true;
    state.priceError = new FarmApiError("not shared", 403, "not_in_share_scope");
    const r = await syncConnection(db.client, connection);
    expect(r.ok).toBe(true);
    const conn = db.tables.farm_connections[0];
    expect(conn.scopes.projected_prices).toBe(false);
    expect(conn.sync_detail.prices.state).toBe("scope_off");
  });

  it("a non-scope fetch failure is recorded on the card, never swallowed, never fatal", async () => {
    const db = freshDb();
    state.scopes.projected_prices = true;
    state.priceError = new FarmApiError("upstream timeout", 500);
    const r = await syncConnection(db.client, connection);
    expect(r.ok).toBe(true);
    const conn = db.tables.farm_connections[0];
    expect(conn.scopes.projected_prices).toBe(true); // handshake stands
    expect(conn.sync_detail.prices).toMatchObject({ state: "error", message: "upstream timeout" });
    expect(conn.last_error).toBeNull();
  });

  it("a rejected database write fails the sync loudly into last_error", async () => {
    const db = freshDb();
    state.scopes.projected_prices = true;
    db.failOn("farm_marketing_prices", "insert", "row level security");
    const r = await syncConnection(db.client, connection);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("row level security");
    const conn = db.tables.farm_connections[0];
    expect(conn.status).toBe("error");
    expect(conn.last_error).toContain("row level security");
  });
});
