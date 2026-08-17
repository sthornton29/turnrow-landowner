import { describe, expect, it } from "vitest";
import {
  projectedYieldForYear,
  rmaConfigForCrop,
  tenantPriceCard,
  type TenantPriceRow,
} from "./leasePricing";

const price = (over: Partial<TenantPriceRow>): TenantPriceRow => ({
  farm_connection_id: "conn1",
  crop_year: 2026,
  crop: "Corn",
  projected_avg_price: 4.63,
  unit: "usd_per_bu",
  is_final: false,
  as_of: "2026-08-17T12:00:00Z",
  ...over,
});

describe("tenantPriceCard", () => {
  it("shows a projected price when scoped and present", () => {
    const card = tenantPriceCard(
      ["conn1"],
      new Set(["conn1"]),
      [price({})],
      2026,
      "corn"
    );
    expect(card).toMatchObject({ state: "price", price: 4.63, isFinal: false });
  });

  it("flags the final settlement number", () => {
    const card = tenantPriceCard(
      ["conn1"],
      new Set(["conn1"]),
      [price({ is_final: true })],
      2026,
      "Corn"
    );
    expect(card).toMatchObject({ state: "price", isFinal: true });
  });

  it("is a quiet scope-off state when the farmer has not shared prices", () => {
    expect(
      tenantPriceCard(["conn1"], new Set(), [price({})], 2026, "corn")
    ).toEqual({ state: "scope_off" });
  });

  it("is a no-connection state without mapped connections", () => {
    expect(tenantPriceCard([], new Set(["conn1"]), [], 2026, "corn")).toEqual({
      state: "no_connection",
    });
  });

  it("ignores other years and null prices", () => {
    expect(
      tenantPriceCard(
        ["conn1"],
        new Set(["conn1"]),
        [price({ crop_year: 2025 }), price({ projected_avg_price: null })],
        2026,
        "corn"
      )
    ).toEqual({ state: "no_price" });
  });
});

describe("projectedYieldForYear", () => {
  const rows = [
    { farm_connection_id: "c", remote_field_id: "f1", crop_year: 2026, crop: "Corn", planted_acres: 60, yield_per_acre: 220, basis: "expected", unit: "bu_per_ac" },
    { farm_connection_id: "c", remote_field_id: "f2", crop_year: 2026, crop: "Corn", planted_acres: 40, yield_per_acre: 130, basis: "expected", unit: "bu_per_ac" },
    { farm_connection_id: "c", remote_field_id: "f3", crop_year: 2026, crop: "Soybeans", planted_acres: 10, yield_per_acre: 55, basis: "expected", unit: "bu_per_ac" },
    { farm_connection_id: "c", remote_field_id: "f4", crop_year: 2026, crop: "Corn", planted_acres: 100, yield_per_acre: 250, basis: "actual", unit: "bu_per_ac" },
  ];
  const keys = new Set(["c|f1", "c|f2", "c|f3", "c|f4"]);

  it("acre-weights the dominant crop, expected basis only", () => {
    const result = projectedYieldForYear(rows, keys, 2026);
    // (220*60 + 130*40) / 100 = 184
    expect(result).toEqual({ crop: "Corn", yieldPerAcre: 184, unit: "bu_per_ac" });
  });

  it("returns null when nothing relevant exists", () => {
    expect(projectedYieldForYear(rows, new Set(["c|other"]), 2026)).toBeNull();
    expect(projectedYieldForYear(rows, keys, 2027)).toBeNull();
  });
});

describe("rmaConfigForCrop", () => {
  const config = [
    { crop: "Corn", state: "AL", formula: "average" as const },
    { crop: "Soybeans", state: "AL", formula: "projected" as const },
  ];
  it("matches the crop case-insensitively", () => {
    expect(rmaConfigForCrop(config, "soybeans")?.formula).toBe("projected");
  });
  it("falls back to the first configured row", () => {
    expect(rmaConfigForCrop(config, "cotton")?.crop).toBe("Corn");
    expect(rmaConfigForCrop(config, null)?.crop).toBe("Corn");
  });
  it("handles missing config", () => {
    expect(rmaConfigForCrop(null, "corn")).toBeNull();
    expect(rmaConfigForCrop([], "corn")).toBeNull();
  });
});
