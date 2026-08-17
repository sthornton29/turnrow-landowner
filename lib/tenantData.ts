// Pure aggregation for the Tenant Data panel on the lease page: one row
// per crop the tenant planted that crop year on the fields a lease
// covers. Every lookup keys strictly by crop through lib/crops.ts, so a
// yield or price can never attach to the wrong crop. Unit tests in
// tenantData.test.ts.

import { canonicalCrop, matchCrop, sameCrop } from "@/lib/crops";
import type { FarmFieldDataRow } from "@/lib/farmDisplay";
import type { ProjectedYieldRow, TenantPriceRow } from "@/lib/leasePricing";

export interface TenantYieldCell {
  value: number; // per acre, 1 decimal
  unitLabel: string; // "bu/ac" | "lbs/ac"
  basis: "projected" | "actual";
}

export interface TenantPriceCell {
  value: number;
  unitLabel: string; // "$/bu" | "c/lb"
  isFinal: boolean;
  asOf: string | null;
}

// "not_shared": the farmer has not granted the scope that would supply
// this cell (quiet, never an error). null: scope is on but there is no
// number yet.
export interface TenantCropRow {
  crop: string; // tenant's name, verbatim (first seen)
  matchedLeaseCrop: string | null; // lease assumption crop it matches
  plantedAcres: number;
  yieldCell: TenantYieldCell | "not_shared" | null;
  priceCell: TenantPriceCell | "not_shared" | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function yieldUnitLabelOf(unit: string | null): string {
  return unit && unit.startsWith("lbs") ? "lbs/ac" : "bu/ac";
}

export function buildTenantCropRows(args: {
  farmData: FarmFieldDataRow[];
  projectedYields: ProjectedYieldRow[];
  prices: TenantPriceRow[];
  relevantKeys: Set<string>; // `${connection_id}|${remote_field_id}` on this lease
  relevantConnectionIds: string[];
  yieldsScope: Set<string>; // connections sharing actual yields
  projectedYieldScope: Set<string>; // connections sharing projected yields
  priceScope: Set<string>; // connections sharing projected prices
  year: number;
  leaseCrops: Array<string | null | undefined>; // this year's assumption crops
}): TenantCropRow[] {
  const {
    farmData,
    projectedYields,
    prices,
    relevantKeys,
    relevantConnectionIds,
    yieldsScope,
    projectedYieldScope,
    priceScope,
    year,
    leaseCrops,
  } = args;

  const plantings = farmData.filter(
    (d) =>
      d.crop_year === year &&
      relevantKeys.has(`${d.farm_connection_id}|${d.remote_field_id}`)
  );

  // Group plantings by canonical crop, keeping the first verbatim name.
  const byCrop = new Map<string, { crop: string; rows: FarmFieldDataRow[] }>();
  for (const p of plantings) {
    const key = canonicalCrop(p.crop) || "unknown";
    const group = byCrop.get(key) ?? { crop: p.crop || "Unknown", rows: [] };
    group.rows.push(p);
    byCrop.set(key, group);
  }

  const anyYieldScope = relevantConnectionIds.some(
    (id) => yieldsScope.has(id) || projectedYieldScope.has(id)
  );
  const anyPriceScope = relevantConnectionIds.some((id) => priceScope.has(id));

  const result: TenantCropRow[] = [];
  for (const { crop, rows } of byCrop.values()) {
    const plantedAcres = round1(
      rows.reduce((s, r) => s + (r.planted_acres ?? 0), 0)
    );

    // Yield: actual once harvested with shared production, else the
    // tenant's projected yield (acre-weighted over this lease's fields).
    let yieldCell: TenantCropRow["yieldCell"] = null;
    const harvested = rows.filter(
      (r) => r.production_units !== null && (r.harvested_acres ?? 0) > 0
    );
    if (harvested.length > 0) {
      const units = harvested.reduce((s, r) => s + (r.production_units ?? 0), 0);
      const acres = harvested.reduce((s, r) => s + (r.harvested_acres ?? 0), 0);
      if (acres > 0 && units > 0) {
        yieldCell = {
          value: round1(units / acres),
          unitLabel: yieldUnitLabelOf(harvested[0].production_unit),
          basis: "actual",
        };
      }
    }
    if (!yieldCell) {
      const projected = projectedYields.filter(
        (r) =>
          r.crop_year === year &&
          r.basis === "expected" &&
          r.yield_per_acre !== null &&
          sameCrop(r.crop, crop) &&
          projectedYieldScope.has(r.farm_connection_id) &&
          relevantKeys.has(`${r.farm_connection_id}|${r.remote_field_id}`)
      );
      if (projected.length > 0) {
        let acres = 0;
        let weighted = 0;
        for (const r of projected) {
          const a = r.planted_acres ?? 0;
          acres += a;
          weighted += (r.yield_per_acre ?? 0) * a;
        }
        const value =
          acres > 0
            ? weighted / acres
            : projected.reduce((s, r) => s + (r.yield_per_acre ?? 0), 0) /
              projected.length;
        yieldCell = {
          value: round1(value),
          unitLabel: yieldUnitLabelOf(projected[0].unit),
          basis: "projected",
        };
      }
    }
    if (!yieldCell && !anyYieldScope) yieldCell = "not_shared";

    // Price: strictly this crop, prefer final then freshest as-of.
    let priceCell: TenantCropRow["priceCell"] = null;
    if (!anyPriceScope) {
      priceCell = "not_shared";
    } else {
      const row =
        prices
          .filter(
            (p) =>
              p.crop_year === year &&
              p.projected_avg_price !== null &&
              sameCrop(p.crop, crop) &&
              priceScope.has(p.farm_connection_id) &&
              relevantConnectionIds.includes(p.farm_connection_id)
          )
          .sort(
            (a, b) =>
              Number(b.is_final) - Number(a.is_final) ||
              (b.as_of ?? "").localeCompare(a.as_of ?? "")
          )[0] ?? null;
      if (row && row.projected_avg_price !== null) {
        priceCell = {
          value: row.projected_avg_price,
          unitLabel: row.unit === "cents_per_lb" ? "c/lb" : "$/bu",
          isFinal: row.is_final,
          asOf: row.as_of,
        };
      }
    }

    result.push({
      crop,
      matchedLeaseCrop: matchCrop(crop, leaseCrops),
      plantedAcres,
      yieldCell,
      priceCell,
    });
  }
  return result.sort((a, b) => b.plantedAcres - a.plantedAcres);
}
