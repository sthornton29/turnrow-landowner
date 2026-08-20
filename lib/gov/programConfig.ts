// Per-program-year ARC/PLC parameters (OBBBA: ARC guarantee %, ARC payment
// cap %, ERP Olympic factor/cap, base-acre payment factors, sequestration),
// ported from the Turnrow farm app's lib/program-config.ts per
// docs/GOV_PAYMENTS_PATHWAYS.md (payment limits and SCO dropped: the
// landowner app never models producer limits). Values live in the global
// program_year_config table; callers fetch rows and resolve the year here.
// When a year has no row we fall back to the most recent configured year
// and flag it so the UI can show a non-blocking notice. Pure (no I/O).

export interface ProgramYearConfig {
  crop_year: number
  sequestration_pct: number | string
  arc_guarantee_pct: number | string | null
  arc_payment_cap_pct: number | string | null
  erp_olympic_factor: number | string | null
  erp_cap_pct: number | string | null
  payment_factor: number | string | null
  arc_ic_payment_factor: number | string | null
  notes?: string | null
}

export const DEFAULT_SEQUESTRATION_PCT = 0.054

// OBBBA rewrote the ARC/PLC parameters starting with the 2025 crop year:
// ARC guarantee 86% -> 90%, ARC payment cap 10% -> 12%, ERP Olympic factor
// 85% -> 88%. The built-in defaults are era-aware so historical years
// compute under the law that actually applied to them.
export const OBBBA_FIRST_YEAR = 2025
export const DEFAULT_ERP_CAP_PCT = 1.15
export const DEFAULT_PAYMENT_FACTOR = 0.85 // ARC-CO and PLC base-acre factor
export const DEFAULT_ARC_IC_PAYMENT_FACTOR = 0.65

export function defaultArcGuaranteePct(cropYear: number): number {
  return cropYear >= OBBBA_FIRST_YEAR ? 0.9 : 0.86
}
export function defaultArcPaymentCapPct(cropYear: number): number {
  return cropYear >= OBBBA_FIRST_YEAR ? 0.12 : 0.1
}
export function defaultErpOlympicFactor(cropYear: number): number {
  return cropYear >= OBBBA_FIRST_YEAR ? 0.88 : 0.85
}

export type ResolvedProgramConfig = {
  requestedYear: number
  // The crop_year the values actually came from. null = built-in defaults
  // (the table had no rows at all).
  sourceYear: number | null
  // true when the values came from a different year than requested (or from
  // the built-in defaults); the UI should surface programConfigNotice().
  isFallback: boolean
  sequestrationPct: number
  arcGuaranteePct: number
  arcPaymentCapPct: number
  erpOlympicFactor: number
  erpCapPct: number
  paymentFactor: number
  arcIcPaymentFactor: number
}

function numOr(v: unknown, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function fromRow(requestedYear: number, row: ProgramYearConfig, isFallback: boolean): ResolvedProgramConfig {
  return {
    requestedYear,
    sourceYear: row.crop_year,
    isFallback,
    sequestrationPct: numOr(row.sequestration_pct, DEFAULT_SEQUESTRATION_PCT),
    arcGuaranteePct: numOr(row.arc_guarantee_pct, defaultArcGuaranteePct(requestedYear)),
    arcPaymentCapPct: numOr(row.arc_payment_cap_pct, defaultArcPaymentCapPct(requestedYear)),
    erpOlympicFactor: numOr(row.erp_olympic_factor, defaultErpOlympicFactor(requestedYear)),
    erpCapPct: numOr(row.erp_cap_pct, DEFAULT_ERP_CAP_PCT),
    paymentFactor: numOr(row.payment_factor, DEFAULT_PAYMENT_FACTOR),
    arcIcPaymentFactor: numOr(row.arc_ic_payment_factor, DEFAULT_ARC_IC_PAYMENT_FACTOR),
  }
}

// Resolve program parameters for a crop year. An exact-year row wins;
// otherwise the most recent configured year at or below the requested
// year, failing that the earliest configured year. With no rows at all,
// the built-in (era-aware) defaults.
export function resolveProgramYearConfig(
  cropYear: number,
  configs: readonly ProgramYearConfig[],
): ResolvedProgramConfig {
  const exact = configs.find((c) => Number(c.crop_year) === cropYear)
  if (exact) return fromRow(cropYear, exact, false)

  const sorted = [...configs].sort((a, b) => Number(a.crop_year) - Number(b.crop_year))
  const atOrBelow = sorted.filter((c) => Number(c.crop_year) <= cropYear)
  const src = atOrBelow.length ? atOrBelow[atOrBelow.length - 1] : sorted[0]

  if (!src) {
    return {
      requestedYear: cropYear,
      sourceYear: null,
      isFallback: true,
      sequestrationPct: DEFAULT_SEQUESTRATION_PCT,
      arcGuaranteePct: defaultArcGuaranteePct(cropYear),
      arcPaymentCapPct: defaultArcPaymentCapPct(cropYear),
      erpOlympicFactor: defaultErpOlympicFactor(cropYear),
      erpCapPct: DEFAULT_ERP_CAP_PCT,
      paymentFactor: DEFAULT_PAYMENT_FACTOR,
      arcIcPaymentFactor: DEFAULT_ARC_IC_PAYMENT_FACTOR,
    }
  }

  return fromRow(cropYear, src, true)
}

// Plain-English fallback notice, or null when the year resolved exactly.
export function programConfigNotice(r: ResolvedProgramConfig): string | null {
  if (!r.isFallback) return null
  if (r.sourceYear == null) {
    return `Program parameters for ${r.requestedYear} are not configured yet; using built-in defaults.`
  }
  return `Program parameters for ${r.requestedYear} are not configured yet; using ${r.sourceYear} values.`
}
