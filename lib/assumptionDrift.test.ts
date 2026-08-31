import { describe, expect, it } from "vitest";
import { computeLeaseYearDrift, driftSummary } from "./assumptionDrift";
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
  matchedLeaseCrop: "Corn",
  plantedAcres: 150,
  yieldCell: { value: 185, unitLabel: "bu/ac", basis: "projected" },
  priceCell: priceCell(4.2),
  ...over,
});

const entry = (over: Partial<CropAssumption>): CropAssumption => ({
  crop: "Corn",
  practice: null,
  acres: 150,
  expected_yield: 185,
  expected_price: 4.2,
  sources: {
    acres: { kind: "tenant_actual", as_of: "2026-08-01" },
    expected_yield: { kind: "tenant_projected", as_of: "2026-08-01" },
    expected_price: { kind: "tenant_projected", as_of: "2026-08-01" },
  },
  ...over,
});

const compute = (entries: CropAssumption[], rows: TenantCropRow[]) =>
  computeLeaseYearDrift({
    leaseId: "L1",
    year: 2026,
    savedEntries: entries,
    tenantRows: rows,
    connectionId: "c1",
    syncedAt: "2026-08-31T12:00:00Z",
  });

describe("computeLeaseYearDrift", () => {
  it("flags a moved projected price with the fill's provenance", () => {
    const drift = compute([entry({})], [row({ priceCell: priceCell(4.55) })]);
    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatchObject({
      field: "expected_price",
      committed_value: 4.2,
      tenant_value: 4.55,
      tenant_kind: "tenant_projected",
      tenant_as_of: "2026-08-30",
      is_final_price: false,
      crop: "Corn",
      practice: "blended",
    });
  });

  it("a final cache price sets is_final_price (the strongest chip)", () => {
    const drift = compute(
      [entry({})],
      [row({ priceCell: priceCell(4.61, { isFinal: true }) })]
    );
    expect(drift).toHaveLength(1);
    expect(drift[0].is_final_price).toBe(true);
    expect(drift[0].tenant_kind).toBe("tenant_final");
    expect(driftSummary(drift)).toEqual({ count: 1, hasFinalPrice: true });
  });

  it("hand-entered values (no source tag) never drift", () => {
    const drift = compute(
      [entry({ sources: { expected_price: { kind: "tenant_projected", as_of: null } } })],
      [
        row({
          plantedAcres: 999, // differs but acres has no tag
          yieldCell: { value: 250, unitLabel: "bu/ac", basis: "projected" }, // differs, no tag
          priceCell: priceCell(4.2), // tagged but equal
        }),
      ]
    );
    expect(drift).toEqual([]);
  });

  it("equal within epsilon is quiet; a one-cent move flags", () => {
    expect(compute([entry({})], [row({ priceCell: priceCell(4.20005) })])).toEqual([]);
    expect(compute([entry({})], [row({ priceCell: priceCell(4.21) })])).toHaveLength(1);
  });

  it("a vanished or not-shared tenant cell produces no drift", () => {
    expect(compute([entry({})], [])).toEqual([]);
    expect(
      compute(
        [entry({})],
        [row({ priceCell: "not_shared", yieldCell: "not_shared", plantedAcres: 150 })]
      )
    ).toEqual([]);
  });

  it("practice rows only pair with their own practice", () => {
    const irrigated = entry({ practice: "irrigated", expected_yield: 200 });
    const dryland = entry({ practice: "dryland", expected_yield: 120 });
    const drift = compute(
      [irrigated, dryland],
      [
        row({
          practice: "irrigated",
          yieldCell: { value: 210, unitLabel: "bu/ac", basis: "projected" },
          priceCell: null,
        }),
      ]
    );
    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatchObject({ practice: "irrigated", field: "expected_yield", tenant_value: 210 });
  });

  it("matches crop synonyms and keeps the saved entry's crop name", () => {
    const drift = compute(
      [entry({ crop: "Beans", expected_yield: 52 })],
      [
        row({
          crop: "Soybeans",
          yieldCell: { value: 55, unitLabel: "bu/ac", basis: "projected" },
          priceCell: null,
          plantedAcres: 150,
        }),
      ]
    );
    expect(drift).toHaveLength(1);
    expect(drift[0].crop).toBe("Beans");
  });

  it("an actual yield stamps tenant_actual", () => {
    const drift = compute(
      [entry({ expected_yield: 185, sources: { expected_yield: { kind: "tenant_projected", as_of: null } } })],
      [
        row({
          yieldCell: { value: 191.4, unitLabel: "bu/ac", basis: "actual" },
          priceCell: null,
        }),
      ]
    );
    expect(drift).toHaveLength(1);
    expect(drift[0].tenant_kind).toBe("tenant_actual");
    expect(drift[0].tenant_as_of).toBe("2026-08-31T12:00:00Z");
  });

  it("cents-per-lb prices compare in fill dollars", () => {
    const cotton = entry({
      crop: "Cotton",
      expected_price: 0.829,
      sources: { expected_price: { kind: "tenant_projected", as_of: null } },
    });
    const drift = compute(
      [cotton],
      [
        row({
          crop: "Cotton",
          priceCell: {
            value: 84.1,
            unitLabel: "c/lb",
            fillValue: 0.841,
            isFinal: false,
            asOf: "2026-08-30",
            scope: "operation",
            scopeLabel: "whole-operation price",
          },
          yieldCell: null,
        }),
      ]
    );
    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatchObject({ committed_value: 0.829, tenant_value: 0.841 });
  });
});
