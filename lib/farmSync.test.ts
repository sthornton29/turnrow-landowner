import { describe, expect, it } from "vitest";
import { buildFarmFieldRow } from "./farmSync";
import type { RemotePlanting, RemoteProduction } from "./farmApi";

// The harvest completion flag must round-trip from the partner API
// payload into the farm_field_data row untouched: a yield presents as
// ACTUAL only when the farm software says the field x crop is complete.

const plantingRow: RemotePlanting = {
  id: "p1",
  field_id: "rf1",
  field_name: "North 40",
  crop: "Corn",
  crop_year: 2026,
  planted_acres: 100,
  irrigated_acres: null,
  dryland_acres: null,
  planting_date: "2026-04-14",
  varieties: [],
  entity_id: "e1",
  entity: "Martin Farms LLC",
};

const prod = (over: Partial<RemoteProduction>): RemoteProduction => ({
  field_id: "rf1",
  crop: "Corn",
  crop_year: 2026,
  planted_acres: 100,
  harvested_acres: 0,
  production_units: 5000,
  unit: "bu",
  ...over,
});

describe("buildFarmFieldRow (harvest status round trip)", () => {
  it("stores each status exactly as the partner API sent it", () => {
    expect(
      buildFarmFieldRow(plantingRow, prod({ harvest_status: "in_progress" }), true)
    ).toMatchObject({ harvest_status: "in_progress", harvested_acres: 0, production_units: 5000 });
    expect(
      buildFarmFieldRow(
        plantingRow,
        prod({ harvest_status: "complete", harvested_acres: 100, production_units: 20000 }),
        true
      )
    ).toMatchObject({ harvest_status: "complete", harvested_acres: 100, production_units: 20000 });
    expect(
      buildFarmFieldRow(plantingRow, prod({ harvest_status: "unharvested", production_units: 0 }), true)
        .harvest_status
    ).toBe("unharvested");
  });

  it("stores null when a pre-addendum farm API sends no status", () => {
    // prod() carries no harvest_status key at all, like the old payload.
    const row = buildFarmFieldRow(plantingRow, prod({}), true);
    expect(row.harvest_status).toBeNull();
  });

  it("stores null status and production when the production pull is unavailable", () => {
    const row = buildFarmFieldRow(plantingRow, null, false);
    expect(row.harvest_status).toBeNull();
    expect(row.harvested_acres).toBeNull();
    expect(row.production_units).toBeNull();
  });

  it("keeps the planting snapshot and entity attribution intact", () => {
    const row = buildFarmFieldRow(plantingRow, prod({ harvest_status: "complete" }), true);
    expect(row).toMatchObject({
      remote_field_id: "rf1",
      crop: "Corn",
      planted_acres: 100,
      remote_entity_id: "e1",
      remote_entity_name: "Martin Farms LLC",
      yield_shared: true,
    });
    expect(row.payload).toMatchObject({ planting: { id: "p1" } });
  });
});
