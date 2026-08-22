import { describe, expect, it } from "vitest";
import { LAND_TYPE_LABELS, landTypeLabel } from "./landLabels";

describe("land type labels", () => {
  it("relabels a stored 'pasture' row as Pasture/Grassland without touching the value", () => {
    const stored = { entity_type: "pasture" as const, name: "North pasture" };
    expect(landTypeLabel(stored.entity_type)).toBe("Pasture/Grassland");
    expect(landTypeLabel(stored.entity_type, "plural")).toBe("Pastures/Grassland");
    expect(stored.entity_type).toBe("pasture");
  });
  it("carries the new mappable categories", () => {
    expect(LAND_TYPE_LABELS.cemetery).toEqual({ singular: "Cemetery", plural: "Cemeteries" });
    expect(LAND_TYPE_LABELS.maintenance_issue.plural).toBe("Maintenance issues");
  });
  it("falls back to the raw key for unknown types", () => {
    expect(landTypeLabel("mystery")).toBe("mystery");
  });
});
