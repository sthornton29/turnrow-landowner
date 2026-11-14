import { describe, expect, it } from "vitest";
import { cleanDetails, detailsLostOnTypeChange } from "./assetTypes";

// Saving an asset after changing its Type keeps only the new type's
// fields, so the old type's saved details vanish. The form warns first,
// with the list this function returns.
describe("detailsLostOnTypeChange", () => {
  const well = { total_depth_ft: 320, pump_type: "submersible", driller: "Acme Drilling", pump_hp: null, permit_number: "" };

  it("names the saved details the new type has no place for", () => {
    expect(detailsLostOnTypeChange("well", "shop", well)).toEqual(["Total depth", "Pump type", "Driller"]);
  });

  it("is empty when the type did not change or nothing is saved", () => {
    expect(detailsLostOnTypeChange("well", "well", well)).toEqual([]);
    expect(detailsLostOnTypeChange("well", "shop", {})).toEqual([]);
    expect(detailsLostOnTypeChange("well", "shop", null)).toEqual([]);
    expect(detailsLostOnTypeChange("well", "shop", { pump_hp: null, driller: "", end_gun: false })).toEqual([]);
  });

  it("does not list a detail both types share", () => {
    // Shop, shed, and barn record the same building details.
    expect(detailsLostOnTypeChange("shop", "barn", { dimensions: "40x60", concrete_floor: true })).toEqual([]);
    // A shop and a house share only the insured value.
    expect(detailsLostOnTypeChange("shop", "house", { dimensions: "40x60", insured_value: 90000 })).toEqual(["Dimensions or sq ft"]);
  });

  it("includes what the map editor saved (a pivot's coverage circle)", () => {
    const pivot = { make: "valley", full_circle: true, add_polygons: [{ type: "Polygon" }], center_lon: -87.3, center_lat: 34.5 };
    // The footprint center exists on every type and is kept.
    expect(detailsLostOnTypeChange("irrigation_pivot", "other", pivot)).toEqual(["Make", "Full circle", "Added areas"]);
  });

  it("agrees with what cleanDetails actually drops", () => {
    const lost = detailsLostOnTypeChange("well", "shop", well);
    const saved = cleanDetails("shop", {}, well);
    expect(Object.keys(saved)).toEqual([]);
    expect(lost.length).toBe(3);
  });
});
