"use client";

// The Tenant Data panel on the lease page: one row per crop the tenant
// planted on this lease's ground, with planted acres, yield
// (PROJECTED or ACTUAL), and average price (PROJECTED or FINAL), read
// from the local sync cache. Every value is a labeled SUGGESTION: Use
// buttons fill the assumption inputs amber for review; nothing saves
// until the user saves the rows. "Use all" never replaces a saved
// value; replacing takes the explicit per-cell action.

import { matchCrop } from "@/lib/crops";
import { formatAcres, formatDollars, formatNumber } from "@/lib/format";
import type { CropAssumption } from "@/lib/leaseLogic";
import type { TenantCropRow } from "@/lib/tenantData";

// One crop's fill, targeted at the lease crop it matched (or introduced
// under the tenant's own crop name when the lease has no crops yet).
// practice targets the matching practice entry (practice-split fills
// create Corn irrigated and Corn dryland entries).
export interface PanelFill {
  crop: string;
  practice: "irrigated" | "dryland" | null;
  values: Partial<Pick<CropAssumption, "acres" | "expected_yield" | "expected_price">>;
  sources: NonNullable<CropAssumption["sources"]>;
}

function fillFor(
  row: TenantCropRow,
  parts: { acres?: boolean; yield?: boolean; price?: boolean },
  syncedAt: string | null
): PanelFill {
  const fill: PanelFill = {
    crop: row.matchedLeaseCrop ?? row.crop,
    practice: row.practice,
    values: {},
    sources: {},
  };
  if (parts.acres && row.plantedAcres > 0) {
    fill.values.acres = row.plantedAcres;
    fill.sources.acres = { kind: "tenant_actual", as_of: syncedAt };
  }
  if (parts.yield && typeof row.yieldCell === "object" && row.yieldCell) {
    fill.values.expected_yield = row.yieldCell.value;
    fill.sources.expected_yield = {
      kind: row.yieldCell.basis === "actual" ? "tenant_actual" : "tenant_projected",
      as_of: syncedAt,
    };
  }
  if (parts.price && typeof row.priceCell === "object" && row.priceCell) {
    // Always the DOLLARS value (cents per lb pre-converted), so the
    // projection math stays in dollars.
    fill.values.expected_price = row.priceCell.fillValue;
    fill.sources.expected_price = {
      kind: row.priceCell.isFinal ? "tenant_final" : "tenant_projected",
      as_of: row.priceCell.asOf ?? syncedAt,
    };
  }
  return fill;
}

const NOT_SHARED_HINT = "Your farmer controls this in their sharing settings";

function Badge({ kind }: { kind: "projected" | "actual" | "final" }) {
  const classes =
    kind === "final"
      ? "bg-pine-800 text-white"
      : kind === "actual"
        ? "bg-kelly-100 text-pine-900"
        : "bg-amber-100 text-amber-800";
  return (
    <span className={"rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase " + classes}>
      {kind}
    </span>
  );
}

function UseButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded border border-kelly-500 px-1.5 py-0.5 text-[11px] font-medium text-kelly-700 hover:bg-kelly-100"
    >
      {label}
    </button>
  );
}

export default function TenantDataPanel({
  yearBlocks,
  connectionLabel,
  lastSyncedAt,
  canUse,
  savedEntriesByYear,
  onFill,
  onRefresh,
  refreshing,
  scopeNote = null,
}: {
  yearBlocks: Array<{ year: number; rows: TenantCropRow[] }>;
  connectionLabel: string;
  lastSyncedAt: string | null;
  // "Tenant data for <entity> (from <connection>)" when the lease's
  // tenant is one farming entity of the connection.
  scopeNote?: string | null;
  canUse: boolean; // crop share fills; flex shows the panel as reference
  savedEntriesByYear: Map<number, CropAssumption[]>;
  onFill: (year: number, fills: PanelFill[], force: boolean) => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const blocksWithData = yearBlocks.filter((b) => b.rows.length > 0);

  return (
    <div className="rounded-xl border border-kelly-100 bg-kelly-50/50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-pine-900">Tenant data</h3>
        <span className="text-xs text-gray-500">
          {scopeNote ?? `from ${connectionLabel}`}
          {lastSyncedAt
            ? `, last synced ${new Date(lastSyncedAt).toLocaleString()}`
            : ""}
        </span>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="ml-auto rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
        >
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {blocksWithData.length === 0 ? (
        <p className="mt-2 text-xs text-gray-500">
          No tenant plantings are synced for this lease{"'"}s land and years
          yet. The farm software shares the current crop year.
        </p>
      ) : (
        blocksWithData.map(({ year, rows }) => {
          const saved = savedEntriesByYear.get(year) ?? [];
          const savedCrops = saved.map((e) => e.crop ?? null);
          const yearHasCrops = saved.some((e) => e.crop || e.acres || e.expected_price || e.expected_yield);
          const syncedAt = lastSyncedAt;
          const savedFor = (row: TenantCropRow): CropAssumption | null => {
            const match = matchCrop(row.crop, savedCrops);
            return (
              saved.find(
                (e) =>
                  e.crop === match &&
                  (e.practice ?? "blended") === (row.practice ?? "blended")
              ) ?? null
            );
          };
          // Use all fills matched crops (or every crop when the year is
          // still empty) and never touches saved values (force=false).
          const useAllRows = rows.filter(
            (r) => r.matchedLeaseCrop !== null || !yearHasCrops
          );
          return (
            <div key={year} className="mt-2">
              {blocksWithData.length > 1 ? (
                <p className="text-xs font-medium text-gray-700">{year}</p>
              ) : null}
              <div className="overflow-x-auto">
                <table className="mt-1 w-full min-w-[540px] text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500">
                      <th className="py-1 pr-2 font-medium">Crop</th>
                      <th className="py-1 pr-2 font-medium">On leased ground</th>
                      <th className="py-1 pr-2 font-medium">Yield</th>
                      <th className="py-1 pr-2 font-medium">Avg price</th>
                      {canUse ? <th className="py-1 font-medium"></th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const savedEntry = savedFor(row);
                      const conflict = (
                        field: "acres" | "expected_yield" | "expected_price",
                        tenantValue: number
                      ) => {
                        const v = savedEntry?.[field];
                        return v != null && v !== tenantValue ? v : null;
                      };
                      const acresConflict = conflict("acres", row.plantedAcres);
                      const yieldValue =
                        typeof row.yieldCell === "object" && row.yieldCell
                          ? row.yieldCell
                          : null;
                      const yieldConflict = yieldValue
                        ? conflict("expected_yield", yieldValue.value)
                        : null;
                      const priceValue =
                        typeof row.priceCell === "object" && row.priceCell
                          ? row.priceCell
                          : null;
                      const priceConflict = priceValue
                        ? conflict("expected_price", priceValue.fillValue)
                        : null;
                      const use = (parts: { acres?: boolean; yield?: boolean; price?: boolean }) =>
                        onFill(year, [fillFor(row, parts, syncedAt)], true);
                      return (
                        <tr
                          key={`${row.crop}|${row.practice ?? "blended"}`}
                          className="border-t border-kelly-100 align-top"
                        >
                          <td className="py-1.5 pr-2">
                            <span className="font-medium text-gray-900">{row.crop}</span>
                            {row.practice ? (
                              <span className="ml-1 rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-800">
                                {row.practice}
                              </span>
                            ) : null}
                            {row.matchedLeaseCrop === null && yearHasCrops ? (
                              <span
                                className="ml-1 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600"
                                title="The tenant planted this, but no assumption row has this crop"
                              >
                                not in this year{"'"}s crops
                              </span>
                            ) : null}
                          </td>
                          <td className="py-1.5 pr-2">
                            <span className="tabular-nums">{formatAcres(row.plantedAcres)} ac</span>
                            {canUse && acresConflict !== null ? (
                              <span className="ml-1 inline-flex items-center gap-1 text-xs text-gray-500">
                                saved {formatAcres(acresConflict)}
                                <UseButton label="Use" onClick={() => use({ acres: true })} />
                              </span>
                            ) : null}
                          </td>
                          <td className="py-1.5 pr-2">
                            {row.yieldCell === "not_shared" ? (
                              <span className="text-xs text-gray-400" title={NOT_SHARED_HINT}>
                                Not shared
                              </span>
                            ) : yieldValue ? (
                              <span className="inline-flex flex-wrap items-center gap-1">
                                <span className="tabular-nums">
                                  {formatNumber(yieldValue.value)} {yieldValue.unitLabel}
                                </span>
                                <Badge kind={yieldValue.basis} />
                                {canUse && yieldConflict !== null ? (
                                  <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                                    saved {formatNumber(yieldConflict)}
                                    <UseButton label="Use" onClick={() => use({ yield: true })} />
                                  </span>
                                ) : null}
                              </span>
                            ) : (
                              <span className="text-xs text-gray-400">n/a</span>
                            )}
                          </td>
                          <td className="py-1.5 pr-2">
                            {row.priceCell === "not_shared" ? (
                              <span className="text-xs text-gray-400" title={NOT_SHARED_HINT}>
                                Not shared
                              </span>
                            ) : priceValue ? (
                              <span className="inline-flex flex-wrap items-center gap-1">
                                <span className="tabular-nums">
                                  {priceValue.unitLabel === "c/lb"
                                    ? `${formatNumber(priceValue.value)} c/lb (fills as ${formatDollars(priceValue.fillValue)}/lb)`
                                    : `${formatDollars(priceValue.value)} ${priceValue.unitLabel}`}
                                </span>
                                <Badge kind={priceValue.isFinal ? "final" : "projected"} />
                                <span
                                  className="text-[10px] text-gray-500"
                                  title={
                                    priceValue.scope === "entity"
                                      ? "This tenant's farming entity's own price, from the farm connection"
                                      : "The whole operation's price; link the tenant to a farming entity on the tenant page for its own"
                                  }
                                >
                                  {priceValue.scopeLabel}
                                </span>
                                {priceValue.asOf ? (
                                  <span className="text-[10px] text-gray-500">
                                    as of {new Date(priceValue.asOf).toLocaleDateString()}
                                  </span>
                                ) : null}
                                {canUse && priceConflict !== null ? (
                                  <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                                    saved {formatDollars(priceConflict)}
                                    <UseButton label="Use" onClick={() => use({ price: true })} />
                                  </span>
                                ) : null}
                              </span>
                            ) : (
                              <span className="text-xs text-gray-400">n/a</span>
                            )}
                          </td>
                          {canUse ? (
                            <td className="py-1.5 text-right">
                              <UseButton
                                label="Use row"
                                onClick={() => use({ acres: true, yield: true, price: true })}
                              />
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {canUse && useAllRows.length > 0 ? (
                <button
                  onClick={() =>
                    onFill(
                      year,
                      useAllRows.map((r) =>
                        fillFor(r, { acres: true, yield: true, price: true }, syncedAt)
                      ),
                      false
                    )
                  }
                  className="mt-2 rounded-lg border border-kelly-500 px-2.5 py-1 text-xs font-semibold text-kelly-700 hover:bg-kelly-100"
                >
                  Use all{yearHasCrops ? " matched crops" : ""} ({year})
                </button>
              ) : null}
              {canUse ? (
                <p className="mt-1 text-[11px] text-gray-500">
                  Filled values turn amber for your review and save with the
                  row. Use all never replaces a value you already saved.
                </p>
              ) : null}
            </div>
          );
        })
      )}
    </div>
  );
}
