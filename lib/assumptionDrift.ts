// Tenant-data drift: a committed, TENANT-SOURCED assumption value that
// now differs from what the Use helper would fill from the synced cache.
// Hand-entered values carry no source tag and never drift (editing a
// value clears its tag, so a deliberate override stays quiet forever).
// A tenant row that vanished (scope revoked, crop gone) is NOT drift:
// the assumption keeps telling its story through the as-of label.
// Pure; unit tested in assumptionDrift.test.ts.

import { matchCrop } from "@/lib/crops";
import type { CropAssumption, ValueSourceKind } from "@/lib/leaseLogic";
import type { TenantCropRow } from "@/lib/tenantData";

export type DriftField = "acres" | "expected_yield" | "expected_price";

export const DRIFT_FIELDS: DriftField[] = ["acres", "expected_yield", "expected_price"];

export const DRIFT_FIELD_LABELS: Record<DriftField, string> = {
  acres: "acres",
  expected_yield: "yield",
  expected_price: "price",
};

// Float-noise tolerance only. Committed values came through the same
// fill pipeline (prices already converted to dollars and rounded to 4
// decimals), so any real change clears this comfortably.
export const DRIFT_EPSILON = 1e-4;

export interface ComputedDrift {
  lease_id: string;
  year: number;
  crop: string; // the saved entry's crop, verbatim
  practice: "irrigated" | "dryland" | "blended";
  field: DriftField;
  committed_value: number;
  tenant_value: number;
  tenant_kind: ValueSourceKind;
  tenant_as_of: string | null;
  is_final_price: boolean;
  farm_connection_id: string | null;
}

// What a fresh Use fill would put in each field for one tenant row:
// value plus the provenance it would stamp (mirrors fillFor in
// TenantDataPanel.tsx, including the price's own as-of beating the
// connection sync time).
function tenantFillFor(
  row: TenantCropRow,
  field: DriftField,
  syncedAt: string | null
): { value: number; kind: ValueSourceKind; asOf: string | null; isFinal: boolean } | null {
  if (field === "acres") {
    if (!(row.plantedAcres > 0)) return null;
    return { value: row.plantedAcres, kind: "tenant_actual", asOf: syncedAt, isFinal: false };
  }
  if (field === "expected_yield") {
    if (typeof row.yieldCell !== "object" || !row.yieldCell) return null;
    return {
      value: row.yieldCell.value,
      kind: row.yieldCell.basis === "actual" ? "tenant_actual" : "tenant_projected",
      asOf: syncedAt,
      isFinal: false,
    };
  }
  if (typeof row.priceCell !== "object" || !row.priceCell) return null;
  return {
    value: row.priceCell.fillValue,
    kind: row.priceCell.isFinal ? "tenant_final" : "tenant_projected",
    asOf: row.priceCell.asOf ?? syncedAt,
    isFinal: row.priceCell.isFinal,
  };
}

export function computeLeaseYearDrift(args: {
  leaseId: string;
  year: number;
  // cropAssumptions(...) of the SAVED row (never unsaved edits).
  savedEntries: CropAssumption[];
  // buildTenantCropRows(...) for this lease-year.
  tenantRows: TenantCropRow[];
  // The connection whose sync produced the row (display attribution).
  connectionId?: string | null;
  // The relevant connections' freshest last_synced_at.
  syncedAt?: string | null;
}): ComputedDrift[] {
  const { leaseId, year, savedEntries, tenantRows, connectionId = null, syncedAt = null } = args;
  const out: ComputedDrift[] = [];
  const savedCrops = savedEntries.map((e) => e.crop ?? null);
  for (const row of tenantRows) {
    // Same pairing as the panel's savedFor: the tenant row's crop
    // matched into the saved crops, then practice equality.
    const match = matchCrop(row.crop, savedCrops);
    if (!match) continue;
    const entry = savedEntries.find(
      (e) => e.crop === match && (e.practice ?? "blended") === (row.practice ?? "blended")
    );
    if (!entry) continue;
    for (const field of DRIFT_FIELDS) {
      const source = entry.sources?.[field];
      if (!source) continue; // hand-entered or never tenant-filled
      const committed = entry[field];
      if (committed == null) continue;
      const tenant = tenantFillFor(row, field, syncedAt);
      if (!tenant) continue; // vanished or not shared: no drift
      if (Math.abs(committed - tenant.value) <= DRIFT_EPSILON) continue;
      out.push({
        lease_id: leaseId,
        year,
        crop: entry.crop ?? row.crop,
        practice: (entry.practice ?? "blended") as ComputedDrift["practice"],
        field,
        committed_value: committed,
        tenant_value: tenant.value,
        tenant_kind: tenant.kind,
        tenant_as_of: tenant.asOf,
        is_final_price: field === "expected_price" && tenant.isFinal,
        farm_connection_id: connectionId,
      });
    }
  }
  return out;
}

// Chip inputs for a set of drift rows (lease list, lease header).
export function driftSummary(
  rows: Array<{ is_final_price: boolean }>
): { count: number; hasFinalPrice: boolean } {
  return { count: rows.length, hasFinalPrice: rows.some((r) => r.is_final_price) };
}

// The unique identity of one drift row (mirrors the DB constraint).
export function driftKey(d: {
  lease_id: string;
  year: number;
  crop: string;
  practice: string;
  field: string;
}): string {
  return [d.lease_id, d.year, d.crop, d.practice, d.field].join("|");
}
