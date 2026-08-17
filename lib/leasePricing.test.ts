import { describe, expect, it } from "vitest";
import {
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
