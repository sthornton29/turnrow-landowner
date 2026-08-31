import { describe, expect, it } from "vitest";
import { fakeDb } from "./testUtils/fakeDb";
import { acceptDriftRow, acceptDriftRows, type DriftRow } from "./acceptDrift";

const drift: DriftRow = {
  id: "d1",
  lease_id: "L1",
  year: 2026,
  crop: "Corn",
  practice: "blended",
  field: "expected_price",
  committed_value: 4.2,
  tenant_value: 4.55,
  tenant_kind: "tenant_projected",
  tenant_as_of: "2026-08-30",
  is_final_price: false,
};

function seed(data: Record<string, unknown>) {
  return fakeDb({
    lease_year_assumptions: [
      { id: "a1", organization_id: "org", lease_id: "L1", year: 2026, data },
    ],
    lease_assumption_drift: [{ ...drift, organization_id: "org" }],
  });
}

describe("acceptDriftRow", () => {
  it("rewrites the value and provenance like a Use fill + Save, then drops the flag", async () => {
    const db = seed({
      crops: [
        {
          crop: "Corn",
          practice: null,
          acres: 100,
          expected_yield: 185,
          expected_price: 4.2,
          expected_shared_expenses: null,
          sources: { expected_price: { kind: "tenant_projected", as_of: "2026-08-01" } },
        },
      ],
    });
    const r = await acceptDriftRow(db.client, drift);
    expect(r).toEqual({ accepted: true, error: null });
    const saved = db.tables.lease_year_assumptions[0].data;
    expect(saved.crops).toHaveLength(1);
    expect(saved.crops[0]).toMatchObject({
      crop: "Corn",
      expected_price: 4.55,
      acres: 100,
      sources: { expected_price: { kind: "tenant_projected", as_of: "2026-08-30" } },
    });
    expect(db.tables.lease_assumption_drift).toHaveLength(0);
  });

  it("a stale flag (the committed value moved) is dropped without writing", async () => {
    const db = seed({
      crops: [{ crop: "Corn", practice: null, expected_price: 4.35 }],
    });
    const r = await acceptDriftRow(db.client, drift);
    expect(r).toEqual({ accepted: false, error: null });
    expect(db.tables.lease_year_assumptions[0].data.crops[0].expected_price).toBe(4.35);
    expect(db.tables.lease_assumption_drift).toHaveLength(0);
  });

  it("upgrades a legacy single-crop row to the crops shape cleanly", async () => {
    const db = seed({
      crop: "Corn",
      acres: 100,
      expected_yield: 185,
      expected_price: 4.2,
    });
    const r = await acceptDriftRow(db.client, drift);
    expect(r.accepted).toBe(true);
    const saved = db.tables.lease_year_assumptions[0].data;
    expect(saved.crop).toBeUndefined();
    expect(saved.crops[0]).toMatchObject({
      crop: "Corn",
      expected_price: 4.55,
      expected_yield: 185,
    });
  });

  it("acceptDriftRows loops the same primitive", async () => {
    const db = seed({
      crops: [
        {
          crop: "Corn",
          practice: null,
          acres: 100,
          expected_yield: 185,
          expected_price: 4.2,
          sources: {
            expected_price: { kind: "tenant_projected", as_of: "2026-08-01" },
            expected_yield: { kind: "tenant_projected", as_of: "2026-08-01" },
          },
        },
      ],
    });
    const second: DriftRow = {
      ...drift,
      id: "d2",
      field: "expected_yield",
      committed_value: 185,
      tenant_value: 192.3,
    };
    db.tables.lease_assumption_drift.push({ ...second, organization_id: "org" });
    const r = await acceptDriftRows(db.client, [drift, second]);
    expect(r).toEqual({ accepted: 2, error: null });
    expect(db.tables.lease_year_assumptions[0].data.crops[0]).toMatchObject({
      expected_price: 4.55,
      expected_yield: 192.3,
    });
    expect(db.tables.lease_assumption_drift).toHaveLength(0);
  });
});
