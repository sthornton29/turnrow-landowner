import { describe, expect, it } from "vitest";
import type { FarmFieldDataRow, FieldMappingRow } from "./farmDisplay";
import { NO_ENTITY_KEY, propertyRollups, rollups, scopedRollup, tenantKey, type RollupInput } from "./farmRollup";

function planting(p: Partial<FarmFieldDataRow> & { farm_connection_id: string; remote_field_id: string }): FarmFieldDataRow {
  return {
    id: `${p.farm_connection_id}-${p.remote_field_id}-${p.crop ?? ""}`,
    crop_year: 2026,
    crop: "Corn",
    planted_acres: 100,
    irrigated_acres: null,
    dryland_acres: null,
    planting_date: null,
    varieties: [],
    harvested_acres: null,
    production_units: null,
    production_unit: null,
    yield_shared: false,
    synced_at: "2026-08-01",
    ...p,
  };
}

function mapping(m: Partial<FieldMappingRow> & { farm_connection_id: string; remote_field_id: string }): FieldMappingRow {
  return {
    id: `${m.farm_connection_id}-${m.remote_field_id}`,
    remote_name: null,
    remote_farm: null,
    remote_acres: null,
    local_field_id: null,
    local_property_id: null,
    status: "confirmed",
    ...m,
  };
}

// Two entities (LLC holds River Place; Home Place has no entity), two
// tenants: Acme farms both properties, Bravo farms River Place only and
// also has a field not mapped yet.
const base: RollupInput = {
  plantings: [
    planting({ farm_connection_id: "acme", remote_field_id: "a1", crop: "Corn", planted_acres: 100, harvested_acres: 100, production_units: 18000, production_unit: "bu" }),
    planting({ farm_connection_id: "acme", remote_field_id: "a2", crop: "Soybeans", planted_acres: 50 }),
    planting({ farm_connection_id: "acme", remote_field_id: "a3", crop: "Corn", planted_acres: 60, harvested_acres: 30, production_units: 6000, production_unit: "bu" }),
    planting({ farm_connection_id: "bravo", remote_field_id: "b1", crop: "Cotton", planted_acres: 40 }),
    planting({ farm_connection_id: "bravo", remote_field_id: "b9", crop: "Cotton", planted_acres: 25 }),
  ],
  mappings: [
    mapping({ farm_connection_id: "acme", remote_field_id: "a1", local_field_id: "f1" }),
    mapping({ farm_connection_id: "acme", remote_field_id: "a2", local_field_id: "f2" }),
    mapping({ farm_connection_id: "acme", remote_field_id: "a3", local_property_id: "home" }),
    mapping({ farm_connection_id: "bravo", remote_field_id: "b1", local_field_id: "f1" }),
  ],
  fields: [
    { id: "f1", name: "North 40", property_id: "river" },
    { id: "f2", name: "South", property_id: "river" },
  ],
  properties: [
    { id: "river", name: "River Place", entity_id: "llc" },
    { id: "home", name: "Home Place", entity_id: null },
  ],
  entities: [{ id: "llc", name: "Smith Farms LLC" }],
  connections: [
    { id: "acme", label: "Acme", operation_name: "Acme Ag", scopes: { yields: true, projected_prices: true } },
    { id: "bravo", label: "Bravo", operation_name: null, scopes: { projected_yields: true } },
  ],
  projectedYields: [
    { farm_connection_id: "bravo", remote_field_id: "b1", crop: "Cotton", planted_acres: 40, yield_per_acre: 1000, unit: "lbs_per_ac", basis: "expected" },
    { farm_connection_id: "bravo", remote_field_id: "b9", crop: "Cotton", planted_acres: 25, yield_per_acre: 1300, unit: "lbs_per_ac", basis: "expected" },
  ],
  prices: [
    { farm_connection_id: "acme", crop: "Corn", projected_avg_price: 4.5, unit: "usd_per_bu", is_final: false },
    { farm_connection_id: "acme", crop: "Wheat", projected_avg_price: 6, unit: "usd_per_bu", is_final: true },
  ],
};

describe("rollups by entity", () => {
  it("buckets plantings by holding entity with a No entity bucket", () => {
    const { byEntity } = rollups(base);
    expect(byEntity.map((r) => r.key)).toEqual(["llc", NO_ENTITY_KEY]);
    const llc = byEntity[0];
    expect(llc.name).toBe("Smith Farms LLC");
    expect(llc.plantedAcres).toBe(190); // 100 + 50 + 40
    expect(llc.harvestedAcres).toBe(100);
    expect(llc.cropMix).toEqual([
      { crop: "Corn", acres: 100 },
      { crop: "Soybeans", acres: 50 },
      { crop: "Cotton", acres: 40 },
    ]);
    expect(llc.propertyCount).toBe(1);
    expect(llc.connectionIds.sort()).toEqual(["acme", "bravo"]);
    const none = byEntity[1];
    expect(none.name).toBe("No entity");
    expect(none.plantedAcres).toBe(60);
    expect(none.harvestedAcres).toBe(30);
  });

  it("never counts unmapped plantings under an entity", () => {
    const total = rollups(base).byEntity.reduce((s, r) => s + r.plantedAcres, 0);
    expect(total).toBe(250); // 275 minus the unmapped 25
  });
});

describe("rollups by tenant", () => {
  it("rolls a tenant across entities and keeps unmapped acres", () => {
    const { byTenant } = rollups(base);
    const acme = byTenant.find((r) => r.key === tenantKey("acme", null))!;
    expect(acme.name).toBe("Acme Ag");
    expect(acme.plantedAcres).toBe(210);
    expect(acme.propertyCount).toBe(2);
    expect(acme.unmappedAcres).toBe(0);
    const bravo = byTenant.find((r) => r.key === tenantKey("bravo", null))!;
    expect(bravo.name).toBe("Bravo"); // no operation name: label
    expect(bravo.plantedAcres).toBe(65);
    expect(bravo.unmappedAcres).toBe(25);
    expect(bravo.propertyCount).toBe(1);
  });
});

describe("yields and prices", () => {
  it("weights actual yield by harvested acres", () => {
    const acme = rollups(base).byTenant.find((r) => r.key === tenantKey("acme", null))!;
    const corn = acme.yieldByCrop.find((y) => y.crop === "Corn")!;
    // (18000 + 6000) / (100 + 30)
    expect(corn.yieldPerAcre).toBeCloseTo(24000 / 130, 6);
    expect(corn.basis).toBe("actual");
    expect(corn.unit).toBe("bu/ac");
    const soy = acme.yieldByCrop.find((y) => y.crop === "Soybeans")!;
    expect(soy.yieldPerAcre).toBeNull();
    expect(acme.sharedYields).toBe(true);
  });

  it("weights projected yield by planted acres when no production exists", () => {
    const bravo = rollups(base).byTenant.find((r) => r.key === tenantKey("bravo", null))!;
    const cotton = bravo.yieldByCrop.find((y) => y.crop === "Cotton")!;
    // (1000*40 + 1300*25) / 65
    expect(cotton.yieldPerAcre).toBeCloseTo((40000 + 32500) / 65, 6);
    expect(cotton.basis).toBe("projected");
    expect(cotton.unit).toBe("lbs/ac");
  });

  it("returns null yields and no prices when the scopes are off", () => {
    const input: RollupInput = {
      ...base,
      connections: base.connections.map((c) => ({ ...c, scopes: {} })),
      projectedYields: [],
      prices: [],
      plantings: base.plantings.map((p) => ({ ...p, production_units: null })),
    };
    const { byTenant } = rollups(input);
    for (const t of byTenant) {
      expect(t.sharedYields).toBe(false);
      expect(t.sharedPrices).toBe(false);
      expect(t.yieldByCrop.every((y) => y.yieldPerAcre === null)).toBe(true);
      expect(t.prices).toEqual([]);
    }
  });

  it("lists prices only for crops in the mix, labeled by tenant", () => {
    const llc = rollups(base).byEntity[0];
    expect(llc.prices).toEqual([{ crop: "Corn", price: 4.5, unit: "usd_per_bu", isFinal: false, tenant: "Acme Ag" }]);
    expect(llc.sharedPrices).toBe(true);
  });
});

describe("drill-in", () => {
  it("lists properties under an entity", () => {
    const rows = propertyRollups(base, { entityId: "llc" });
    expect(rows.map((r) => r.name)).toEqual(["River Place"]);
    expect(rows[0].plantedAcres).toBe(190);
  });

  it("lists properties under a tenant, dropping unmapped plantings", () => {
    const rows = propertyRollups(base, { connectionId: "bravo" });
    expect(rows.map((r) => r.name)).toEqual(["River Place"]);
    expect(rows[0].plantedAcres).toBe(40);
  });

  it("lists every property with no filter, sorted by name", () => {
    expect(propertyRollups(base).map((r) => r.name)).toEqual(["Home Place", "River Place"]);
  });

  it("scopes a header card to entity plus property", () => {
    const card = scopedRollup(base, { entityId: "llc", propertyId: "river" }, "River Place");
    expect(card.plantedAcres).toBe(190);
    const tenantOnly = scopedRollup(base, { connectionId: "bravo" }, "Bravo");
    expect(tenantOnly.plantedAcres).toBe(65);
    expect(tenantOnly.unmappedAcres).toBe(25);
  });
});
describe("tenants are the farming entities (migration 0031)", () => {
  const ent = (p: Partial<FarmFieldDataRow> & { farm_connection_id: string; remote_field_id: string }) => planting(p);
  const multi: RollupInput = {
    ...base,
    plantings: [
      ent({ farm_connection_id: "acme", remote_field_id: "a1", crop: "Corn", planted_acres: 100, remote_entity_id: "e1", remote_entity_name: "Acme Farms Inc" }),
      ent({ farm_connection_id: "acme", remote_field_id: "a2", crop: "Soybeans", planted_acres: 50, remote_entity_id: "e2", remote_entity_name: "Acme Land LLC" }),
      ent({ farm_connection_id: "acme", remote_field_id: "a3", crop: "Corn", planted_acres: 60, remote_entity_id: null }),
      ent({ farm_connection_id: "bravo", remote_field_id: "b1", crop: "Cotton", planted_acres: 40, remote_entity_id: "b-only", remote_entity_name: "Bravo" }),
    ],
    prices: [
      { farm_connection_id: "acme", crop: "Corn", projected_avg_price: 4.5, unit: "usd_per_bu", is_final: false, remote_entity_id: null },
      { farm_connection_id: "acme", crop: "Corn", projected_avg_price: 4.8, unit: "usd_per_bu", is_final: false, remote_entity_id: "e1" },
      { farm_connection_id: "acme", crop: "Soybeans", projected_avg_price: 11, unit: "usd_per_bu", is_final: true, remote_entity_id: "e2" },
    ],
    tenants: [{ id: "t1", name: "Acme Farms (renamed)", farm_connection_id: "acme", farm_entity_id: "e1" }],
  };

  it("makes one tenant card per farming entity, plus one for plantings without an entity", () => {
    const { byTenant } = rollups(multi);
    expect(byTenant.map((t) => [t.key, t.plantedAcres])).toEqual([
      [tenantKey("acme", "e1"), 100],
      [tenantKey("acme", null), 60],
      [tenantKey("acme", "e2"), 50],
      [tenantKey("bravo", "b-only"), 40],
    ]);
    expect(byTenant.reduce((s, t) => s + t.plantedAcres, 0)).toBe(250);
  });

  it("names a card after the linked tenants row, else the farm data's entity name, else the operation", () => {
    const { byTenant } = rollups(multi);
    const e1 = byTenant.find((t) => t.key === tenantKey("acme", "e1"))!;
    expect(e1.name).toBe("Acme Farms (renamed)");
    expect(e1.tenantId).toBe("t1");
    expect(e1.subtitle).toBe("Acme Ag");
    const e2 = byTenant.find((t) => t.key === tenantKey("acme", "e2"))!;
    expect(e2.name).toBe("Acme Land LLC");
    expect(e2.tenantId).toBeNull();
    const none = byTenant.find((t) => t.key === tenantKey("acme", null))!;
    expect(none.name).toBe("Acme Ag");
    expect(none.remoteEntityId).toBeNull();
    expect(none.connectionId).toBe("acme");
  });

  it("gives each entity card its own prices and the no-entity card the whole-operation prices", () => {
    const { byTenant } = rollups(multi);
    expect(byTenant.find((t) => t.key === tenantKey("acme", "e1"))!.prices.map((p) => [p.crop, p.price])).toEqual([["Corn", 4.8]]);
    expect(byTenant.find((t) => t.key === tenantKey("acme", "e2"))!.prices.map((p) => [p.crop, p.price, p.isFinal])).toEqual([["Soybeans", 11, true]]);
    expect(byTenant.find((t) => t.key === tenantKey("acme", null))!.prices.map((p) => [p.crop, p.price])).toEqual([["Corn", 4.5]]);
  });

  it("names an entity from the connection's list when the planting carries only the id", () => {
    const input: RollupInput = {
      ...multi,
      plantings: multi.plantings.map((p) => (p.remote_entity_id === "e2" ? { ...p, remote_entity_name: null } : p)),
      connections: multi.connections.map((c) => (c.id === "acme" ? { ...c, entities: [{ id: "e2", name: "Acme Land LLC" }] } : c)),
    };
    expect(rollups(input).byTenant.find((t) => t.key === tenantKey("acme", "e2"))!.name).toBe("Acme Land LLC");
  });

  it("pre-entity data still yields one card per connection, named after the tenant row or the operation", () => {
    const r = rollups({ ...base, tenants: [{ id: "tb", name: "Bravo Brothers", farm_connection_id: "bravo", farm_entity_id: null }] });
    expect(r.byTenant.map((t) => [t.key, t.name])).toEqual([
      [tenantKey("acme", null), "Acme Ag"],
      [tenantKey("bravo", null), "Bravo Brothers"],
    ]);
    expect(r.byEntity[0].prices).toEqual([{ crop: "Corn", price: 4.5, unit: "usd_per_bu", isFinal: false, tenant: "Acme Ag" }]);
  });

  it("scopes the drill-in card and property rows to one farming entity", () => {
    const card = scopedRollup(multi, { connectionId: "acme", remoteEntityId: "e1" }, "Acme Farms Inc");
    expect(card.plantedAcres).toBe(100);
    expect(card.prices.map((p) => p.price)).toEqual([4.8]);
    expect(card.tenantId).toBe("t1");
    const none = scopedRollup(multi, { connectionId: "acme", remoteEntityId: null }, "Acme Ag");
    expect(none.plantedAcres).toBe(60);
    expect(propertyRollups(multi, { connectionId: "acme", remoteEntityId: "e2" }).map((p) => [p.name, p.plantedAcres])).toEqual([["River Place", 50]]);
  });
});
