import { describe, expect, it } from "vitest";
import { fakeDb } from "./testUtils/fakeDb";
import {
  autoFillTenantAssumptions,
  autoFillYearEntries,
  entryIsTenantManaged,
} from "./tenantAutoFill";
import { annualRent, type CropAssumption, type LeaseLike } from "./leaseLogic";
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

  // The tenant's rows for a crop change shape over the season. The old
  // shape's entries must be replaced, never left to count the crop twice.
  // 25% share at $4.50: 200 ac irrigated x 220 bu + 100 ac dryland x 80 bu
  // projects $58,500; after harvest one blended row (300 ac x 170 bu
  // actual) is $57,375. Left side by side they read $115,875.
  const lease25: LeaseLike = {
    lease_type: "agricultural",
    rent_structure: "crop_share",
    terms: { landowner_share_pct: 25 },
    payment_schedule: [],
    start_date: "2026-01-01",
    end_date: "2026-12-31",
  };
  const tagged = (over: Partial<CropAssumption>): CropAssumption => ({
    crop: "Corn",
    expected_price: 4.5,
    ...over,
    sources: {
      acres: { kind: "tenant_actual", as_of: "2026-08-01" },
      expected_yield: { kind: "tenant_projected", as_of: "2026-08-01" },
      expected_price: { kind: "tenant_projected", as_of: "2026-08-01" },
    },
  });
  const splitEntries = (): CropAssumption[] => [
    tagged({ practice: "irrigated", acres: 200, expected_yield: 220 }),
    tagged({ practice: "dryland", acres: 100, expected_yield: 80 }),
  ];
  const blendedActualRow = row({
    practice: null,
    plantedAcres: 300,
    yieldCell: { value: 170, unitLabel: "bu/ac", basis: "actual" },
    priceCell: priceCell(4.5),
  });

  it("practice-split entries are replaced when harvest collapses the crop to one blended row", () => {
    expect(annualRent(lease25, 300, { crops: splitEntries() })).toBe(58500);
    const { entries, removed } = autoFillYearEntries({
      entries: splitEntries(),
      tenantRows: [blendedActualRow],
      syncedAt: "2026-10-20T12:00:00Z",
    });
    expect(removed).toBe(2);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ crop: "Corn", practice: null, acres: 300, expected_yield: 170 });
    expect(entries[0].sources?.expected_yield?.kind).toBe("tenant_actual");
    expect(annualRent(lease25, 300, { crops: entries })).toBe(57375); // not 115,875
  });

  it("a blended entry is replaced when the tenant's rows gain the irrigated/dryland breakout", () => {
    const blended = tagged({ practice: null, acres: 300, expected_yield: 170 });
    const { entries, removed } = autoFillYearEntries({
      entries: [blended],
      tenantRows: [
        row({ practice: "irrigated", plantedAcres: 200, yieldCell: { value: 220, unitLabel: "bu/ac", basis: "projected" }, priceCell: priceCell(4.5) }),
        row({ practice: "dryland", plantedAcres: 100, yieldCell: { value: 80, unitLabel: "bu/ac", basis: "projected" }, priceCell: priceCell(4.5) }),
      ],
      syncedAt: null,
    });
    expect(removed).toBe(1);
    expect(entries.map((e) => e.practice).sort()).toEqual(["dryland", "irrigated"]);
    expect(annualRent(lease25, 300, { crops: entries })).toBe(58500); // not 115,875
  });

  it("a practice the tenant stops reporting goes, other crops and vanished crops stay", () => {
    const soy = tagged({ crop: "Soybeans", practice: null, acres: 80, expected_yield: 50 });
    const { entries, removed } = autoFillYearEntries({
      entries: [...splitEntries(), soy],
      // Corn now irrigated only; the tenant no longer reports Soybeans at all.
      tenantRows: [row({ practice: "irrigated", plantedAcres: 200, yieldCell: { value: 220, unitLabel: "bu/ac", basis: "projected" }, priceCell: priceCell(4.5) })],
      syncedAt: null,
    });
    expect(removed).toBe(1);
    expect(entries.map((e) => `${e.crop}|${e.practice ?? "blended"}`)).toEqual(["Corn|irrigated", "Soybeans|blended"]);
  });

  it("a hand-edited entry keeps the year's crop list: nothing is added and nothing is removed", () => {
    const handEdited: CropAssumption = { ...splitEntries()[0], expected_yield: 230 };
    handEdited.sources = { ...handEdited.sources, expected_yield: null }; // a hand edit clears the tag
    const before = [handEdited, splitEntries()[1]];
    const { entries, removed, filled } = autoFillYearEntries({
      entries: before,
      tenantRows: [blendedActualRow],
      syncedAt: null,
    });
    expect(removed).toBe(0);
    expect(filled).toBe(0);
    expect(entries.map((e) => e.practice)).toEqual(["irrigated", "dryland"]);
    expect(entries[0].expected_yield).toBe(230);
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

  it("after harvest the practice-split entries are replaced by the one blended actual entry", async () => {
    const db = seed();
    // Harvest complete on the lease's field: 17,000 bu off 100 acres.
    Object.assign(db.tables.farm_field_data[0], {
      harvested_acres: 100,
      harvest_status: "complete",
      production_units: 17000,
      production_unit: "bu",
    });
    const sources = {
      acres: { kind: "tenant_actual", as_of: "2026-08-01" },
      expected_yield: { kind: "tenant_projected", as_of: "2026-08-01" },
      expected_price: { kind: "tenant_projected", as_of: "2026-08-01" },
    };
    const split = [
      { crop: "Corn", practice: "irrigated", acres: 60, expected_yield: 220, expected_price: 4.55, sources },
      { crop: "Corn", practice: "dryland", acres: 40, expected_yield: 95, expected_price: 4.55, sources },
    ];
    db.tables.lease_year_assumptions.push({
      id: "a1",
      organization_id: "org",
      lease_id: "L1",
      year: 2026,
      data: { crops: split },
    });
    await autoFillTenantAssumptions(db.client, "org");
    const crops = db.tables.lease_year_assumptions[0].data.crops;
    expect(crops).toHaveLength(1);
    expect(crops[0]).toMatchObject({ crop: "Corn", practice: null, acres: 100, expected_yield: 170 });
    expect(crops[0].sources.expected_yield.kind).toBe("tenant_actual");

    // A year that already holds both shapes (saved before this rule) is
    // cleaned up on the next sync even though no value changes.
    db.tables.lease_year_assumptions[0].data = { crops: [...split, crops[0]] };
    const again = await autoFillTenantAssumptions(db.client, "org");
    expect(again).toEqual({ leases: 1, values: 0 });
    expect(db.tables.lease_year_assumptions[0].data.crops).toHaveLength(1);
    expect(db.tables.lease_year_assumptions[0].data.crops[0].practice).toBeNull();
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
