// Pure helpers for the lease price method cards on the year assumption
// panel. Deterministic, unit-tested in leasePricing.test.ts.

import type { RmaBenchmarkConfig } from "@/lib/leaseLogic";

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
  | { state: "no_price" }
  | {
      state: "price";
      price: number;
      unitLabel: string;
      isFinal: boolean;
      asOf: string | null;
      crop: string;
    };

// Decide what the tenant-average card shows for one lease year. The
// scope-off and no-connection states are quiet explanatory lines, never
// errors, and the app never offers to request the scope (that
// conversation happens off-platform).
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
  const candidates = prices.filter(
    (p) =>
      scoped.includes(p.farm_connection_id) &&
      p.crop_year === year &&
      p.projected_avg_price !== null &&
      (!crop || p.crop.toLowerCase() === crop.toLowerCase())
  );
  // Without a crop on the assumption yet, fall back to any priced crop.
  const row = candidates[0] ?? null;
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
// Tenant projected yield (pre-harvest; actuals win once they exist)
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

// Acre-weighted average projected yield over the lease's relevant
// remote fields, dominant crop, expected-basis rows only.
export function projectedYieldForYear(
  rows: ProjectedYieldRow[],
  relevantKeys: Set<string>, // `${connection_id}|${remote_field_id}`
  year: number
): { crop: string; yieldPerAcre: number; unit: string | null } | null {
  const relevant = rows.filter(
    (r) =>
      r.crop_year === year &&
      r.basis === "expected" &&
      r.yield_per_acre !== null &&
      relevantKeys.has(`${r.farm_connection_id}|${r.remote_field_id}`)
  );
  if (relevant.length === 0) return null;
  const acresByCrop = new Map<string, number>();
  for (const r of relevant) {
    acresByCrop.set(r.crop, (acresByCrop.get(r.crop) ?? 0) + (r.planted_acres ?? 0));
  }
  const topCrop = Array.from(acresByCrop.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (topCrop === undefined) return null;
  const cropRows = relevant.filter((r) => r.crop === topCrop);
  let acres = 0;
  let weighted = 0;
  for (const r of cropRows) {
    const a = r.planted_acres ?? 0;
    acres += a;
    weighted += (r.yield_per_acre ?? 0) * a;
  }
  if (acres === 0) {
    // No acre weights shared: plain average.
    const avg =
      cropRows.reduce((s, r) => s + (r.yield_per_acre ?? 0), 0) / cropRows.length;
    return { crop: topCrop, yieldPerAcre: Math.round(avg * 10) / 10, unit: cropRows[0].unit };
  }
  return {
    crop: topCrop,
    yieldPerAcre: Math.round((weighted / acres) * 10) / 10,
    unit: cropRows[0].unit,
  };
}

// ---------------------------------------------------------------------
// RMA benchmark config resolution
// ---------------------------------------------------------------------

// Pick the benchmark config row for a year's crop: exact crop match
// (case-insensitive) first, else the first configured row.
export function rmaConfigForCrop(
  config: RmaBenchmarkConfig[] | null | undefined,
  crop: string | null
): RmaBenchmarkConfig | null {
  if (!config || config.length === 0) return null;
  if (crop) {
    const exact = config.find((c) => c.crop.toLowerCase() === crop.toLowerCase());
    if (exact) return exact;
  }
  return config[0];
}
