// Pure aggregation for the Tenant Data panel on the lease page: one row
// per crop the tenant planted that crop year on the fields a lease
// covers. Every lookup keys strictly by crop through lib/crops.ts, so a
// yield or price can never attach to the wrong crop. Unit tests in
// tenantData.test.ts.

import { canonicalCrop, matchCrop, sameCrop } from "@/lib/crops";
import type { FarmFieldDataRow } from "@/lib/farmDisplay";
import {
  priceScopeLabel,
  selectPriceRows,
  type PriceScope,
  type ProjectedYieldRow,
  type TenantEntityRef,
  type TenantPriceRow,
} from "@/lib/leasePricing";

export interface TenantYieldCell {
  value: number; // per acre, 1 decimal
  unitLabel: string; // "bu/ac" | "lbs/ac"
  basis: "projected" | "actual";
}

export interface TenantPriceCell {
  value: number; // as the tenant tracks it (dollars per bu, or CENTS per lb)
  unitLabel: string; // "$/bu" | "c/lb"
  // What Use fills into the assumption price input: always DOLLARS per
  // the yield's native unit (cents per lb converts to $/lb), so
  // acres x yield x price stays in dollars. A cotton price of 82.90
  // c/lb fills as 0.829, never 82.90.
  fillValue: number;
  isFinal: boolean;
  asOf: string | null;
  // Whose price: the lease tenant's farming entity, or the whole
  // operation (the only kind before migration 0031).
  scope: PriceScope;
  scopeLabel: string;
}

// "not_shared": the farmer has not granted the scope that would supply
// this cell (quiet, never an error). null: scope is on but there is no
// number yet. practice: set when the tenant's data carries the
// irrigated/dryland breakout (one row per crop x practice); null is a
// blended whole-crop row. Actual yields are NEVER split by practice
// (the partner /production payload carries no breakout), so a crop
// with actuals collapses back to one blended ACTUAL row.
export interface TenantCropRow {
  crop: string; // tenant's name, verbatim (first seen)
  practice: "irrigated" | "dryland" | null;
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
  // The lease tenant's farming entity, when linked (tenants.farm_*).
  tenantEntity?: TenantEntityRef | null;
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
    tenantEntity = null,
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

    // Price: strictly this crop, prefer final then freshest as-of.
    // Practice rows of the same crop share it (prices are per crop).
    let priceCell: TenantCropRow["priceCell"] = null;
    if (!anyPriceScope) {
      priceCell = "not_shared";
    } else {
      const selected = selectPriceRows(
        prices.filter(
          (p) =>
            p.crop_year === year &&
            p.projected_avg_price !== null &&
            sameCrop(p.crop, crop) &&
            priceScope.has(p.farm_connection_id) &&
            relevantConnectionIds.includes(p.farm_connection_id)
        ),
        tenantEntity
      );
      const row =
        selected.rows
          .sort(
            (a, b) =>
              Number(b.is_final) - Number(a.is_final) ||
              (b.as_of ?? "").localeCompare(a.as_of ?? "")
          )[0] ?? null;
      if (row && row.projected_avg_price !== null) {
        const cents = row.unit === "cents_per_lb";
        priceCell = {
          value: row.projected_avg_price,
          unitLabel: cents ? "c/lb" : "$/bu",
          fillValue: cents
            ? Math.round((row.projected_avg_price / 100) * 10000) / 10000
            : row.projected_avg_price,
          isFinal: row.is_final,
          asOf: row.as_of,
          scope: selected.scope,
          scopeLabel: priceScopeLabel(selected.scope, selected.entityName),
        };
      }
    }
    const matchedLeaseCrop = matchCrop(crop, leaseCrops);

    // Actual yield once harvested with shared production. Actuals carry
    // no practice breakout on the partner API, so this is always ONE
    // blended row; we never fabricate a split.
    const harvested = rows.filter(
      (r) => r.production_units !== null && (r.harvested_acres ?? 0) > 0
    );
    if (harvested.length > 0) {
      const units = harvested.reduce((s, r) => s + (r.production_units ?? 0), 0);
      const acres = harvested.reduce((s, r) => s + (r.harvested_acres ?? 0), 0);
      if (acres > 0 && units > 0) {
        result.push({
          crop,
          practice: null,
          matchedLeaseCrop,
          plantedAcres,
          yieldCell: {
            value: round1(units / acres),
            unitLabel: yieldUnitLabelOf(harvested[0].production_unit),
            basis: "actual",
          },
          priceCell,
        });
        continue;
      }
    }

    // Pre-harvest: the tenant's projected yields, split by practice
    // when the farm data carries the breakout.
    const projected = projectedYields.filter(
      (r) =>
        r.crop_year === year &&
        r.basis === "expected" &&
        r.yield_per_acre !== null &&
        sameCrop(r.crop, crop) &&
        projectedYieldScope.has(r.farm_connection_id) &&
        relevantKeys.has(`${r.farm_connection_id}|${r.remote_field_id}`)
    );
    const withPractices = projected.filter(
      (r) => r.practices && r.practices.length > 0
    );

    if (withPractices.length > 0) {
      // One row per practice: acres from the plantings' split when
      // present (else the yield rows' practice acres), yield
      // acre-weighted per practice across the lease's fields.
      for (const practice of ["irrigated", "dryland"] as const) {
        let yieldAcres = 0;
        let weighted = 0;
        for (const r of withPractices) {
          const entry = r.practices!.find((p) => p.practice === practice);
          if (!entry || entry.yield_per_acre == null) continue;
          const a = entry.acres ?? 0;
          yieldAcres += a;
          weighted += entry.yield_per_acre * a;
        }
        const plantingAcres = rows.reduce(
          (s, r) =>
            s + ((practice === "irrigated" ? r.irrigated_acres : r.dryland_acres) ?? 0),
          0
        );
        const acresForRow = plantingAcres > 0 ? plantingAcres : yieldAcres;
        if (acresForRow <= 0 && yieldAcres <= 0) continue;
        result.push({
          crop,
          practice,
          matchedLeaseCrop,
          plantedAcres: round1(acresForRow),
          yieldCell:
            yieldAcres > 0
              ? {
                  value: round1(weighted / yieldAcres),
                  unitLabel: yieldUnitLabelOf(withPractices[0].unit),
                  basis: "projected",
                }
              : null,
          priceCell,
        });
      }
      continue;
    }

    // Blended: no practice breakout for this crop.
    let yieldCell: TenantCropRow["yieldCell"] = null;
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
    if (!yieldCell && !anyYieldScope) yieldCell = "not_shared";
    result.push({
      crop,
      practice: null,
      matchedLeaseCrop,
      plantedAcres,
      yieldCell,
      priceCell,
    });
  }
  return result.sort((a, b) => b.plantedAcres - a.plantedAcres);
}
