import { describe, expect, it } from "vitest";
import { buildTenantCropRows } from "./tenantData";
import type { FarmFieldDataRow } from "./farmDisplay";

const planting = (over: Partial<FarmFieldDataRow>): FarmFieldDataRow => ({
  id: "x",
  farm_connection_id: "conn1",
  remote_field_id: "f1",
  crop_year: 2026,
  crop: "Wheat",
  planted_acres: 100,
  irrigated_acres: null,
  dryland_acres: null,
  planting_date: null,
  varieties: [],
  harvested_acres: null,
  production_units: null,
  production_unit: null,
  yield_shared: false,
  synced_at: "2026-08-01T00:00:00Z",
  ...over,
});

const projYield = (over: Record<string, unknown>) => ({
  farm_connection_id: "conn1",
  remote_field_id: "f1",
  crop_year: 2026,
  crop: "Wheat",
  planted_acres: 100,
  yield_per_acre: 62,
  basis: "expected",
  unit: "bu_per_ac",
  practices: null,
  ...over,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any;

const base = {
  relevantKeys: new Set(["conn1|f1", "conn1|f2"]),
  relevantConnectionIds: ["conn1"],
  yieldsScope: new Set(["conn1"]),
  projectedYieldScope: new Set(["conn1"]),
  priceScope: new Set(["conn1"]),
  year: 2026,
  leaseCrops: ["Wheat", "Canola"],
};

describe("buildTenantCropRows", () => {
  it("aggregates planted acres per crop across the lease's mapped fields only", () => {
    const rows = buildTenantCropRows({
      ...base,
      farmData: [
        planting({ remote_field_id: "f1", planted_acres: 120.4 }),
        planting({ remote_field_id: "f2", planted_acres: 80.2 }),
        planting({ remote_field_id: "off-lease", planted_acres: 500 }),
        planting({ remote_field_id: "f2", crop: "Canola", planted_acres: 60 }),
      ],
      projectedYields: [],
      prices: [],
    });
    expect(rows.map((r) => [r.crop, r.plantedAcres])).toEqual([
      ["Wheat", 200.6],
      ["Canola", 60],
    ]);
  });

  it("keys yield and price strictly by crop, never cross-attaching", () => {
    const rows = buildTenantCropRows({
      ...base,
      farmData: [planting({ crop: "Wheat" }), planting({ remote_field_id: "f2", crop: "Canola" })],
      projectedYields: [projYield({ crop: "wheat" })],
      prices: [
        { farm_connection_id: "conn1", crop_year: 2026, crop: "Canola", projected_avg_price: 11.25, unit: "usd_per_bu", is_final: true, as_of: "2026-08-01" },
      ],
    });
    const wheat = rows.find((r) => r.crop === "Wheat")!;
    const canola = rows.find((r) => r.crop === "Canola")!;
    expect(wheat.yieldCell).toMatchObject({ value: 62, basis: "projected" });
    expect(wheat.priceCell).toBeNull(); // canola's $11.25 must NOT land here
    expect(canola.priceCell).toMatchObject({ value: 11.25, isFinal: true });
    expect(canola.yieldCell).toBeNull();
  });

  it("converts cents-per-lb prices to dollars for filling (cotton)", () => {
    // The $12M bug: 82.90 c/lb must fill as $0.829/lb, never 82.90.
    const rows = buildTenantCropRows({
      ...base,
      leaseCrops: ["Cotton"],
      farmData: [planting({ crop: "Cotton" })],
      projectedYields: [],
      prices: [
        { farm_connection_id: "conn1", crop_year: 2026, crop: "Cotton", projected_avg_price: 82.9, unit: "cents_per_lb", is_final: false, as_of: "2026-08-17" },
      ],
    });
    expect(rows[0].priceCell).toMatchObject({
      value: 82.9,
      unitLabel: "c/lb",
      fillValue: 0.829,
    });
  });

  it("keeps dollars-per-bushel prices unconverted", () => {
    const rows = buildTenantCropRows({
      ...base,
      farmData: [planting({})],
      projectedYields: [],
      prices: [
        { farm_connection_id: "conn1", crop_year: 2026, crop: "Wheat", projected_avg_price: 5.96, unit: "usd_per_bu", is_final: true, as_of: "2026-08-17" },
      ],
    });
    expect(rows[0].priceCell).toMatchObject({ value: 5.96, fillValue: 5.96 });
  });

  it("prefers actual yield over projected once harvested", () => {
    const rows = buildTenantCropRows({
      ...base,
      farmData: [
        planting({ harvested_acres: 100, production_units: 5900, production_unit: "bu" }),
      ],
      projectedYields: [projYield({ yield_per_acre: 70 })],
      prices: [],
    });
    expect(rows[0].yieldCell).toMatchObject({ value: 59, basis: "actual" });
  });

  it("acre-weights projected yields over the lease's fields", () => {
    const rows = buildTenantCropRows({
      ...base,
      farmData: [
        planting({ remote_field_id: "f1", planted_acres: 60 }),
        planting({ remote_field_id: "f2", planted_acres: 40 }),
      ],
      projectedYields: [
        projYield({ remote_field_id: "f1", planted_acres: 60, yield_per_acre: 220 }),
        projYield({ remote_field_id: "f2", planted_acres: 40, yield_per_acre: 130 }),
      ],
      prices: [],
    });
    expect(rows[0].yieldCell).toMatchObject({ value: 184 });
  });

  it("splits crop rows by practice when the tenant reports the breakout", () => {
    const rows = buildTenantCropRows({
      ...base,
      leaseCrops: ["Corn"],
      farmData: [
        planting({ crop: "Corn", planted_acres: 100, irrigated_acres: 60, dryland_acres: 40 }),
      ],
      projectedYields: [
        projYield({
          crop: "Corn",
          yield_per_acre: 184,
          practices: [
            { practice: "irrigated", acres: 60, yield_per_acre: 220 },
            { practice: "dryland", acres: 40, yield_per_acre: 130 },
          ],
        }),
      ],
      prices: [
        { farm_connection_id: "conn1", crop_year: 2026, crop: "Corn", projected_avg_price: 4.63, unit: "usd_per_bu", is_final: false, as_of: "2026-08-01" },
      ],
    });
    const irrigated = rows.find((r) => r.practice === "irrigated")!;
    const dryland = rows.find((r) => r.practice === "dryland")!;
    expect(irrigated.plantedAcres).toBe(60);
    expect(irrigated.yieldCell).toMatchObject({ value: 220, basis: "projected" });
    expect(dryland.plantedAcres).toBe(40);
    expect(dryland.yieldCell).toMatchObject({ value: 130 });
    // Both practice rows carry the crop's one price.
    expect(irrigated.priceCell).toMatchObject({ value: 4.63 });
    expect(dryland.priceCell).toMatchObject({ value: 4.63 });
  });

  it("never fabricates a practice split for actual yields", () => {
    const rows = buildTenantCropRows({
      ...base,
      leaseCrops: ["Corn"],
      farmData: [
        planting({
          crop: "Corn", planted_acres: 100, irrigated_acres: 60, dryland_acres: 40,
          harvested_acres: 100, production_units: 18400, production_unit: "bu",
        }),
      ],
      projectedYields: [
        projYield({
          crop: "Corn",
          practices: [
            { practice: "irrigated", acres: 60, yield_per_acre: 220 },
            { practice: "dryland", acres: 40, yield_per_acre: 130 },
          ],
        }),
      ],
      prices: [],
    });
    // One blended ACTUAL row, not practice rows.
    expect(rows).toHaveLength(1);
    expect(rows[0].practice).toBeNull();
    expect(rows[0].yieldCell).toMatchObject({ value: 184, basis: "actual" });
  });

  it("renders scope-off cells as not_shared while acres still work", () => {
    const rows = buildTenantCropRows({
      ...base,
      yieldsScope: new Set(),
      projectedYieldScope: new Set(),
      priceScope: new Set(),
      farmData: [planting({})],
      projectedYields: [],
      prices: [],
    });
    expect(rows[0].plantedAcres).toBe(100);
    expect(rows[0].yieldCell).toBe("not_shared");
    expect(rows[0].priceCell).toBe("not_shared");
  });

  it("marks unmatched tenant crops instead of attaching them", () => {
    const rows = buildTenantCropRows({
      ...base,
      leaseCrops: ["Corn"],
      farmData: [planting({ crop: "Winter Wheat" })],
      projectedYields: [],
      prices: [],
    });
    expect(rows[0].matchedLeaseCrop).toBeNull();
  });

  it("matches tenant crops to lease crops through the synonym matcher", () => {
    const rows = buildTenantCropRows({
      ...base,
      leaseCrops: ["Wheat", "beans"],
      farmData: [
        planting({ crop: "Winter Wheat" }),
        planting({ remote_field_id: "f2", crop: "Soybeans" }),
      ],
      projectedYields: [],
      prices: [],
    });
    expect(rows.find((r) => r.crop === "Winter Wheat")?.matchedLeaseCrop).toBe("Wheat");
    expect(rows.find((r) => r.crop === "Soybeans")?.matchedLeaseCrop).toBe("beans");
  });
});
