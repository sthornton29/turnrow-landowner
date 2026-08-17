// Pure helpers for the lease price method cards on the year assumption
// panel. Deterministic, unit-tested in leasePricing.test.ts.

import type { RmaBenchmarkConfig } from "@/lib/leaseLogic";
import { canonicalCrop, sameCrop } from "@/lib/crops";

// ---------------------------------------------------------------------
// Tenant average price card
// ---------------------------------------------------------------------

export interface TenantPriceRow {
  farm_connection_id: string;
  crop_year: number;
  crop: string;
  projected_avg_price: number | null;
  unit: string | null;
  is_final: boolean;
  as_of: string | null;
}

export type TenantPriceCard =
  | { state: "no_connection" }
  | { state: "scope_off" }
  | { state: "no_crop" }
  | { state: "no_price" }
  | {
      state: "price";
      price: number;
      unitLabel: string;
      isFinal: boolean;
      asOf: string | null;
      crop: string;
    };

// Decide what the tenant-average card shows for one crop. The scope-off
// and no-connection states are quiet explanatory lines, never errors,
// and the app never offers to request the scope (that conversation
// happens off-platform). STRICT crop keying: a card never renders a
// price whose crop does not match its row (no fallback to "any priced
// crop"; that once put a canola price on a wheat row).
export function tenantPriceCard(
  relevantConnectionIds: string[],
  connectionsWithScope: Set<string>,
  prices: TenantPriceRow[],
  year: number,
  crop: string | null
): TenantPriceCard {
  if (relevantConnectionIds.length === 0) return { state: "no_connection" };
  const scoped = relevantConnectionIds.filter((id) => connectionsWithScope.has(id));
  if (scoped.length === 0) return { state: "scope_off" };
  if (!crop || canonicalCrop(crop) === "") return { state: "no_crop" };
  const candidates = prices.filter(
    (p) =>
      scoped.includes(p.farm_connection_id) &&
      p.crop_year === year &&
      p.projected_avg_price !== null &&
      sameCrop(p.crop, crop)
  );
  // Prefer a final settlement number, then the freshest as-of date.
  const row =
    candidates.sort(
      (a, b) =>
        Number(b.is_final) - Number(a.is_final) ||
        (b.as_of ?? "").localeCompare(a.as_of ?? "")
    )[0] ?? null;
  if (!row || row.projected_avg_price === null) return { state: "no_price" };
  return {
    state: "price",
    price: row.projected_avg_price,
    unitLabel: row.unit === "cents_per_lb" ? "c/lb" : "$/bu",
    isFinal: row.is_final,
    asOf: row.as_of,
    crop: row.crop,
  };
}

// ---------------------------------------------------------------------
// Tenant projected yields (rows for the Tenant Data panel live in
// lib/tenantData.ts; this is just the synced row shape)
// ---------------------------------------------------------------------

export interface ProjectedYieldRow {
  farm_connection_id: string;
  remote_field_id: string;
  crop_year: number;
  crop: string;
  planted_acres: number | null;
  yield_per_acre: number | null;
  basis: string | null;
  unit: string | null;
}

// ---------------------------------------------------------------------
// RMA benchmark config resolution
// ---------------------------------------------------------------------

// Pick the benchmark config row for a crop, matched through the crop
// matcher. With a crop entered but no matching config the answer is
// null (the row asks for a benchmark for that crop) rather than a
// wrong-crop card; only a row with no crop yet falls back to the first
// configured entry.
export function rmaConfigForCrop(
  config: RmaBenchmarkConfig[] | null | undefined,
  crop: string | null
): RmaBenchmarkConfig | null {
  if (!config || config.length === 0) return null;
  if (crop && canonicalCrop(crop) !== "") {
    return config.find((c) => sameCrop(c.crop, crop)) ?? null;
  }
  return config[0];
}
