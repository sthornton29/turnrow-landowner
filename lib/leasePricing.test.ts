import { describe, expect, it } from "vitest";
import {
  rmaConfigForCrop,
  roundPriceForUse,
  tenantPriceCard,
  tenantPriceDollars,
  type TenantPriceRow,
} from "./leasePricing";
import { buildTenantCropRows } from "./tenantData";

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

  it("NEVER falls back to a different crop's price", () => {
    // The wheat/canola bug: a Wheat row must not show the Canola price.
    const card = tenantPriceCard(
      ["conn1"],
      new Set(["conn1"]),
      [price({ crop: "Canola", projected_avg_price: 11.25 })],
      2026,
      "Wheat"
    );
    expect(card).toEqual({ state: "no_price" });
  });

  it("waits for a crop instead of showing any priced crop", () => {
    const card = tenantPriceCard(
      ["conn1"],
      new Set(["conn1"]),
      [price({ crop: "Canola" })],
      2026,
      null
    );
    expect(card).toEqual({ state: "no_crop" });
  });

  it("matches crops through the synonym matcher", () => {
    const card = tenantPriceCard(
      ["conn1"],
      new Set(["conn1"]),
      [price({ crop: "Soybeans", projected_avg_price: 10.4 })],
      2026,
      "beans"
    );
    expect(card).toMatchObject({ state: "price", price: 10.4 });
  });

  it("prefers the final number, then the freshest as-of", () => {
    const card = tenantPriceCard(
      ["conn1"],
      new Set(["conn1"]),
      [
        price({ projected_avg_price: 4.2, as_of: "2026-07-01" }),
        price({ projected_avg_price: 4.8, as_of: "2026-08-01" }),
      ],
      2026,
      "corn"
    );
    expect(card).toMatchObject({ state: "price", price: 4.8 });
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

describe("rmaConfigForCrop", () => {
  const config = [
    { crop: "Corn", state: "AL", formula: "average" as const },
    { crop: "Soybeans", state: "AL", formula: "projected" as const },
  ];
  it("matches the crop through the matcher", () => {
    expect(rmaConfigForCrop(config, "soybeans")?.formula).toBe("projected");
    expect(rmaConfigForCrop(config, "beans")?.formula).toBe("projected");
  });
  it("returns null for an entered crop with no configured benchmark", () => {
    // Never show a Corn benchmark on a Cotton row.
    expect(rmaConfigForCrop(config, "cotton")).toBeNull();
  });
  it("falls back to the first row only when no crop is entered yet", () => {
    expect(rmaConfigForCrop(config, null)?.crop).toBe("Corn");
  });
  it("handles missing config", () => {
    expect(rmaConfigForCrop(null, "corn")).toBeNull();
    expect(rmaConfigForCrop([], "corn")).toBeNull();
  });
});

describe("tenant prices in dollars (cotton is tracked in cents per lb)", () => {
  const cotton = price({ crop: "Cotton", projected_avg_price: 82.9, unit: "cents_per_lb" });

  it("the card carries the dollars value a formula or a fill must use", () => {
    // 82.90 c/lb is $0.829/lb. A custom pricing recipe used to read the
    // 82.90 as dollars (100 times the price).
    const card = tenantPriceCard(["conn1"], new Set(["conn1"]), [cotton], 2026, "cotton");
    expect(card).toMatchObject({ state: "price", price: 82.9, unitLabel: "c/lb", fillValue: 0.829 });
    const corn = tenantPriceCard(["conn1"], new Set(["conn1"]), [price({})], 2026, "corn");
    expect(corn).toMatchObject({ state: "price", price: 4.63, fillValue: 4.63 });
  });

  it("is the same rule the Tenant Data panel fills with", () => {
    const rows = buildTenantCropRows({
      farmData: [
        {
          farm_connection_id: "conn1", remote_field_id: "f1", crop_year: 2026, crop: "Cotton",
          planted_acres: 100, irrigated_acres: null, dryland_acres: null, harvested_acres: null,
          harvest_status: null, production_units: null, production_unit: null,
        } as never,
      ],
      projectedYields: [],
      prices: [cotton],
      relevantKeys: new Set(["conn1|f1"]),
      relevantConnectionIds: ["conn1"],
      yieldsScope: new Set(),
      projectedYieldScope: new Set(),
      priceScope: new Set(["conn1"]),
      year: 2026,
      leaseCrops: ["Cotton"],
    });
    const cell = rows[0].priceCell;
    const card = tenantPriceCard(["conn1"], new Set(["conn1"]), [cotton], 2026, "cotton");
    expect(typeof cell === "object" && cell ? cell.fillValue : null).toBe(
      card.state === "price" ? card.fillValue : undefined
    );
    expect(tenantPriceDollars(82.9, "cents_per_lb")).toBe(0.829);
    expect(tenantPriceDollars(71.256, "cents_per_lb")).toBe(0.7126); // four decimals
    expect(tenantPriceDollars(4.63, "usd_per_bu")).toBe(4.63);
  });

  it("per-lb prices keep four decimals, per-bushel prices keep cents", () => {
    expect(roundPriceForUse(0.82904, "Cotton")).toBe(0.829);
    expect(roundPriceForUse(0.71256, "upland cotton")).toBe(0.7126); // two decimals would say 0.71
    expect(roundPriceForUse(4.6349, "Corn")).toBe(4.63);
    expect(roundPriceForUse(11.256, null)).toBe(11.26);
  });
});

describe("tenantPriceCard with a tenant farming entity", () => {
  it("prefers the entity row and labels the scope", () => {
    const card = tenantPriceCard(
      ["conn1"],
      new Set(["conn1"]),
      [price({}), price({ projected_avg_price: 4.9, remote_entity_id: "ent-a", remote_entity_name: "Albemarle Farms" })],
      2026,
      "Corn",
      { connectionId: "conn1", entityId: "ent-a" }
    );
    expect(card).toMatchObject({ state: "price", price: 4.9, scope: "entity", scopeLabel: "Albemarle Farms entity price" });
  });
  it("uses the operation row when the entity has none", () => {
    const card = tenantPriceCard(["conn1"], new Set(["conn1"]), [price({})], 2026, "Corn", { connectionId: "conn1", entityId: "ent-a" });
    expect(card).toMatchObject({ state: "price", price: 4.63, scope: "operation" });
  });
});
