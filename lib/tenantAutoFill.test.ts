import { describe, expect, it } from "vitest";
import { fakeDb } from "./testUtils/fakeDb";
import {
  autoFillTenantAssumptions,
  autoFillYearEntries,
  entryIsTenantManaged,
} from "./tenantAutoFill";
import type { CropAssumption } from "./leaseLogic";
import type { TenantCropRow } from "./tenantData";

const priceCell = (fillValue: number, opts: { isFinal?: boolean; asOf?: string | null } = {}) => ({
  value: fillValue,
  unitLabel: "$/bu",
  fillValue,
  isFinal: opts.isFinal ?? false,
  asOf: opts.asOf ?? "2026-08-30",
  scope: "operation" as const,
  scopeLabel: "whole-operation price",
});

const row = (over: Partial<TenantCropRow>): TenantCropRow => ({
  crop: "Corn",
  practice: null,
  matchedLeaseCrop: null,
  plantedAcres: 150,
  yieldCell: { value: 185, unitLabel: "bu/ac", basis: "projected" },
  priceCell: priceCell(4.2),
  ...over,
});

describe("autoFillYearEntries (pure)", () => {
  it("an empty year gets full entries with provenance tags", () => {
    const { entries, filled } = autoFillYearEntries({
      entries: [],
      tenantRows: [row({})],
      syncedAt: "2026-08-31T12:00:00Z",
    });
    expect(filled).toBe(3);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      crop: "Corn",
      acres: 150,
      expected_yield: 185,
      expected_price: 4.2,
      sources: {
        acres: { kind: "tenant_actual", as_of: "2026-08-31T12:00:00Z" },
        expected_yield: { kind: "tenant_projected", as_of: "2026-08-31T12:00:00Z" },
        expected_price: { kind: "tenant_projected", as_of: "2026-08-30" },
      },
    });
  });

  it("refreshes tenant-tagged values and never touches hand-entered ones", () => {
    const existing: CropAssumption = {
      crop: "Corn",
      practice: null,
      acres: 150,
      expected_yield: 200, // hand-entered: no tag
      expected_price: 4.2,
      sources: {
        acres: { kind: "tenant_actual", as_of: "2026-08-01" },
        expected_price: { kind: "tenant_projected", as_of: "2026-08-01" },
      },
    };
    const { entries, filled } = autoFillYearEntries({
      entries: [existing],
      tenantRows: [
        row({
          plantedAcres: 152.5,
          yieldCell: { value: 190, unitLabel: "bu/ac", basis: "projected" },
          priceCell: priceCell(4.55, { isFinal: true, asOf: "2026-09-01" }),
        }),
      ],
      syncedAt: "2026-08-31T12:00:00Z",
    });
    expect(filled).toBe(2); // acres + price; the hand-entered yield stays
    expect(entries[0]).toMatchObject({
      acres: 152.5,
      expected_yield: 200,
      expected_price: 4.55,
    });
    expect(entries[0].sources?.expected_yield).toBeUndefined();
    expect(entries[0].sources?.expected_price).toMatchObject({
      kind: "tenant_final",
      as_of: "2026-09-01",
    });
  });

  it("unchanged values are not rewritten (as-of stays put)", () => {
    const existing: CropAssumption = {
      crop: "Corn",
      acres: 150,
      expected_yield: 185,
      expected_price: 4.2,
      sources: {
        acres: { kind: "tenant_actual", as_of: "2026-08-01" },
        expected_yield: { kind: "tenant_projected", as_of: "2026-08-01" },
        expected_price: { kind: "tenant_projected", as_of: "2026-08-01" },
      },
    };
    const { entries, filled } = autoFillYearEntries({
      entries: [existing],
      tenantRows: [row({ priceCell: priceCell(4.2, { asOf: "2026-08-30" }) })],
      syncedAt: "2026-08-31T12:00:00Z",
    });
    expect(filled).toBe(0);
    expect(entries[0].sources?.expected_price?.as_of).toBe("2026-08-01");
  });

  it("a hand-touched year keeps its crop list (no auto-added crops), tagged values still refresh", () => {
    const handTouched: CropAssumption = {
      crop: "Corn",
      expected_yield: 200, // untagged value: the year is the user's
      expected_price: 4.2,
      sources: { expected_price: { kind: "tenant_projected", as_of: "2026-08-01" } },
    };
    const { entries, filled } = autoFillYearEntries({
      entries: [handTouched],
      tenantRows: [
        row({ priceCell: priceCell(4.55), plantedAcres: 0, yieldCell: null }),
        row({ crop: "Soybeans", priceCell: priceCell(10.1), plantedAcres: 80 }),
      ],
      syncedAt: null,
    });
    expect(entries).toHaveLength(1); // Soybeans NOT added
    expect(entries[0].expected_price).toBe(4.55);
    expect(filled).toBe(1);
  });

  it("practice-split rows become separate irrigated/dryland entries", () => {
    const { entries } = autoFillYearEntries({
      entries: [],
      tenantRows: [
        row({ practice: "irrigated", plantedAcres: 90, yieldCell: { value: 210, unitLabel: "bu/ac", basis: "projected" } }),
        row({ practice: "dryland", plantedAcres: 60, yieldCell: { value: 120, unitLabel: "bu/ac", basis: "projected" } }),
      ],
      syncedAt: null,
    });
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.practice).sort()).toEqual(["dryland", "irrigated"]);
  });

  it("entryIsTenantManaged: shared expenses or any untagged value flips it", () => {
    expect(entryIsTenantManaged({ crop: "Corn" })).toBe(true);
    expect(
      entryIsTenantManaged({ crop: "Corn", acres: 1, sources: { acres: { kind: "tenant_actual", as_of: null } } })
    ).toBe(true);
    expect(entryIsTenantManaged({ crop: "Corn", acres: 1 })).toBe(false);
    expect(entryIsTenantManaged({ crop: "Corn", expected_shared_expenses: 5 })).toBe(false);
  });
});

// ---------------------------------------------------------------- sync pass

function seed() {
  return fakeDb({
    leases: [
      {
        id: "L1",
        organization_id: "org",
        tenant_id: "t1",
        status: "active",
        lease_type: "agricultural",
        rent_structure: "crop_share",
        start_date: "2026-01-01",
        end_date: "2026-12-31",
      },
    ],
    lease_year_assumptions: [],
    lease_lands: [{ organization_id: "org", lease_id: "L1", property_id: "p1", field_id: "f1" }],
    field_mappings: [
      {
        organization_id: "org",
        farm_connection_id: "c1",
        remote_field_id: "r1",
        local_field_id: "f1",
        local_property_id: null,
        remote_entity_id: null,
        status: "confirmed",
      },
    ],
    tenants: [{ id: "t1", organization_id: "org", farm_connection_id: null, farm_entity_id: null, farm_entity_name: null }],
    fields: [{ id: "f1", organization_id: "org", property_id: "p1" }],
    farm_connections: [
      {
        id: "c1",
        organization_id: "org",
        scopes: { yields: true, projected_prices: true, projected_yields: true },
        last_synced_at: "2026-08-31T12:00:00Z",
      },
    ],
    farm_field_data: [
      {
        organization_id: "org",
        farm_connection_id: "c1",
        remote_field_id: "r1",
        crop_year: 2026,
        crop: "Corn",
        planted_acres: 100,
        irrigated_acres: null,
        dryland_acres: null,
        harvested_acres: null,
        harvest_status: null,
        production_units: null,
        production_unit: null,
      },
    ],
    farm_projected_yields: [
      {
        organization_id: "org",
        farm_connection_id: "c1",
        remote_field_id: "r1",
        crop_year: 2026,
        crop: "Corn",
        planted_acres: 100,
        yield_per_acre: 185,
        unit: "bu_per_acre",
        basis: "expected",
        practices: null,
      },
    ],
    farm_marketing_prices: [
      {
        organization_id: "org",
        farm_connection_id: "c1",
        crop_year: 2026,
        crop: "Corn",
        projected_avg_price: 4.55,
        unit: "usd_per_bu",
        is_final: false,
        as_of: "2026-08-30",
        remote_entity_id: null,
      },
    ],
  });
}

describe("autoFillTenantAssumptions", () => {
  it("creates the assumption row for a bare lease so projections work with zero taps", async () => {
    const db = seed();
    const r = await autoFillTenantAssumptions(db.client, "org");
    expect(r.leases).toBe(1);
    expect(r.values).toBe(3);
    const rows = db.tables.lease_year_assumptions;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ organization_id: "org", lease_id: "L1", year: 2026 });
    expect(rows[0].data.crops[0]).toMatchObject({
      crop: "Corn",
      acres: 100,
      expected_yield: 185,
      expected_price: 4.55,
    });
    expect(rows[0].data.crops[0].sources.expected_price.kind).toBe("tenant_projected");
  });

  it("is idempotent, then refreshes when the cache moves", async () => {
    const db = seed();
    await autoFillTenantAssumptions(db.client, "org");
    const r2 = await autoFillTenantAssumptions(db.client, "org");
    expect(r2).toEqual({ leases: 0, values: 0 });
    db.tables.farm_marketing_prices[0].projected_avg_price = 4.61;
    db.tables.farm_marketing_prices[0].is_final = true;
    const r3 = await autoFillTenantAssumptions(db.client, "org");
    expect(r3.values).toBe(1);
    const entry = db.tables.lease_year_assumptions[0].data.crops[0];
    expect(entry.expected_price).toBe(4.61);
    expect(entry.sources.expected_price.kind).toBe("tenant_final");
  });

  it("never replaces a hand-edited value", async () => {
    const db = seed();
    db.tables.lease_year_assumptions.push({
      id: "a1",
      organization_id: "org",
      lease_id: "L1",
      year: 2026,
      data: { crops: [{ crop: "Corn", expected_price: 5.0 }] }, // hand-entered, no tag
    });
    await autoFillTenantAssumptions(db.client, "org");
    const entry = db.tables.lease_year_assumptions[0].data.crops[0];
    expect(entry.expected_price).toBe(5.0);
    // Empty fields on the same entry still filled with tags.
    expect(entry.acres).toBe(100);
    expect(entry.sources.acres.kind).toBe("tenant_actual");
  });

  it("every read filters the organization explicitly (service-role safety)", async () => {
    const db = seed();
    await autoFillTenantAssumptions(db.client, "org");
    expect(db.reads.length).toBeGreaterThan(0);
    for (const read of db.reads) {
      expect(
        read.filters.some((f) => f.op === "eq" && f.col === "organization_id" && f.value === "org"),
        `read of ${read.table} missing the organization filter`
      ).toBe(true);
    }
  });
});
