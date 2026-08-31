import { describe, expect, it } from "vitest";
import { leaseFarmScope } from "./leaseFarmScope";

const fieldPropertyById = new Map([
  ["f1", "p1"],
  ["f2", "p1"],
  ["f3", "p2"],
]);

const mappings = [
  { farm_connection_id: "c1", remote_field_id: "r1", local_field_id: "f1", local_property_id: null, remote_entity_id: "e1" },
  { farm_connection_id: "c1", remote_field_id: "r2", local_field_id: "f2", local_property_id: null, remote_entity_id: "e2" },
  { farm_connection_id: "c2", remote_field_id: "r3", local_field_id: null, local_property_id: "p2", remote_entity_id: null },
  { farm_connection_id: "c1", remote_field_id: "r4", local_field_id: "f3", local_property_id: null, remote_entity_id: "e1" },
];

describe("leaseFarmScope", () => {
  it("matches a field-level land link to its mapping", () => {
    const scope = leaseFarmScope({
      lands: [{ property_id: "p1", field_id: "f1" }],
      mappings,
      fieldPropertyById,
      tenantEntity: null,
    });
    expect(scope.keys).toEqual(new Set(["c1|r1"]));
    expect(scope.connectionIds).toEqual(["c1"]);
    expect(scope.scopedToEntity).toBe(false);
  });

  it("a whole-property link covers mapped fields on the property and property-level mappings", () => {
    const scope = leaseFarmScope({
      lands: [{ property_id: "p2", field_id: null }],
      mappings,
      fieldPropertyById,
      tenantEntity: null,
    });
    // r3 maps to the property directly; r4's local field f3 sits on p2.
    expect(scope.keys).toEqual(new Set(["c2|r3", "c1|r4"]));
    expect(new Set(scope.connectionIds)).toEqual(new Set(["c1", "c2"]));
  });

  it("the tenant's entity narrows the mappings when any carry it", () => {
    const scope = leaseFarmScope({
      lands: [{ property_id: "p1", field_id: null }],
      mappings,
      fieldPropertyById,
      tenantEntity: { connectionId: "c1", entityId: "e1" },
    });
    // Both r1 (e1) and r2 (e2) sit on p1; only e1's field counts.
    expect(scope.keys).toEqual(new Set(["c1|r1"]));
    expect(scope.scopedToEntity).toBe(true);
  });

  it("falls back to every on-lease mapping when none carries the entity", () => {
    const scope = leaseFarmScope({
      lands: [{ property_id: "p2", field_id: null }],
      mappings: mappings.filter((m) => m.remote_entity_id === null),
      fieldPropertyById,
      tenantEntity: { connectionId: "c2", entityId: "e9" },
    });
    expect(scope.keys).toEqual(new Set(["c2|r3"]));
    expect(scope.scopedToEntity).toBe(false);
  });

  it("no land or no mappings yields an empty scope", () => {
    expect(
      leaseFarmScope({ lands: [], mappings, fieldPropertyById, tenantEntity: null }).keys.size
    ).toBe(0);
    expect(
      leaseFarmScope({
        lands: [{ property_id: "p9", field_id: null }],
        mappings,
        fieldPropertyById,
        tenantEntity: null,
      }).connectionIds
    ).toEqual([]);
  });
});
