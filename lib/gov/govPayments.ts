// Government payment engine: pure ARC/PLC math plus the seed cotton MYA
// conversion and payment-year attribution, ported from the Turnrow farm
// app's lib/government-payments.ts per docs/GOV_PAYMENTS_PATHWAYS.md.
// Dropped on purpose: Barchart/futures helpers and every payment-limit
// helper (producer limits are the tenant's world). No I/O. All
// projections are ESTIMATES; FSA determines actual payments after the
// marketing year closes.

import {
  DEFAULT_SEQUESTRATION_PCT,
  DEFAULT_ERP_CAP_PCT,
  DEFAULT_ARC_IC_PAYMENT_FACTOR,
  defaultArcGuaranteePct,
  defaultArcPaymentCapPct,
  defaultErpOlympicFactor,
  OBBBA_FIRST_YEAR,
} from './programConfig'

// ---------- Row shapes (the landowner app's global tables) ----------

export type CommoditySlug =
  | 'corn'
  | 'soybeans'
  | 'wheat'
  | 'seed_cotton'
  | 'grain_sorghum'
  | 'oats'
  | 'barley'
  | 'peanuts'
  | 'canola'
  | 'sesame'

export const COMMODITY_SLUGS: CommoditySlug[] = [
  'corn', 'soybeans', 'wheat', 'seed_cotton', 'grain_sorghum',
  'oats', 'barley', 'peanuts', 'canola', 'sesame',
]

export const COMMODITY_LABELS: Record<CommoditySlug, string> = {
  corn: 'Corn',
  soybeans: 'Soybeans',
  wheat: 'Wheat',
  seed_cotton: 'Seed cotton',
  grain_sorghum: 'Grain sorghum',
  oats: 'Oats',
  barley: 'Barley',
  peanuts: 'Peanuts',
  canola: 'Canola',
  sesame: 'Sesame',
}

export interface CoveredCommodity {
  slug: CommoditySlug | string
  name: string
  unit: 'bushel' | 'pound'
  statutory_reference_price: number | string
  national_loan_rate: number | string
  marketing_year_start_month: number
  lint_share?: number | string | null
  cottonseed_share?: number | string | null
  mya_month_weights?: number[] | null
}

export interface ArcPlcPriceData {
  commodity: string
  program_year: number
  effective_reference_price: number | string | null
  mya_price_estimate: number | string | null
  mya_price_final: number | string | null
  wasde_midpoint: number | string | null
  source: 'usda' | 'manual' | 'wasde' | 'estimate' | string | null
}

export type ElectionType = 'plc' | 'arc_co' | 'arc_ic'

export const ELECTION_LABEL: Record<ElectionType, string> = {
  plc: 'PLC',
  arc_co: 'ARC-CO',
  arc_ic: 'ARC-IC',
}

// The 85% base-acre payment factor applies to ARC-CO and PLC gross
// payments (ARC-IC uses 65%). Per-year values come from program_year_config.
export const PAYMENT_FACTOR = 0.85

// Seed cotton weight shares (lint vs cottonseed) for the MYA conversion.
export const LINT_SHARE = 0.43
export const COTTONSEED_SHARE = 0.57

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6
}

// ---------- Effective Reference Price (ERP) ----------

// 5-year Olympic average: drop the single highest and lowest, average the
// rest. null when there are not enough values to trim (>= 3 accepted).
export function olympicAverage(values: readonly number[]): number | null {
  if (values.length < 3) return null
  const sorted = [...values].sort((a, b) => a - b)
  const trimmed = sorted.slice(1, -1)
  return trimmed.reduce((s, v) => s + v, 0) / trimmed.length
}

// ERP = min(capPct x statutory, max(statutory, olympicFactor x 5-yr Olympic avg MYA))
export function computeEffectiveReferencePrice(args: {
  statutoryReferencePrice: number
  olympicAvgMya?: number | null
  erpOlympicFactor?: number
  erpCapPct?: number
}): number {
  const stat = args.statutoryReferencePrice
  if (args.olympicAvgMya == null) return stat
  const factor = args.erpOlympicFactor ?? defaultErpOlympicFactor(OBBBA_FIRST_YEAR)
  const cap = args.erpCapPct ?? DEFAULT_ERP_CAP_PCT
  return round6(Math.min(cap * stat, Math.max(stat, factor * args.olympicAvgMya)))
}

// The FSA-published value stored for the year wins; else computed from the
// Olympic average when provided; else the statutory reference price.
export function effectiveReferencePrice(
  commodity: Pick<CoveredCommodity, 'statutory_reference_price'>,
  priceData?: Pick<ArcPlcPriceData, 'effective_reference_price'> | null,
  opts?: { olympicAvgMya?: number | null; erpOlympicFactor?: number; erpCapPct?: number },
): number {
  if (priceData?.effective_reference_price != null) return Number(priceData.effective_reference_price)
  return computeEffectiveReferencePrice({
    statutoryReferencePrice: Number(commodity.statutory_reference_price),
    olympicAvgMya: opts?.olympicAvgMya ?? null,
    erpOlympicFactor: opts?.erpOlympicFactor,
    erpCapPct: opts?.erpCapPct,
  })
}

// ARC benchmark price with ERP substitution: each year counts at
// max(MYA, that year's ERP) (a missing MYA counts at its ERP), then the
// Olympic average.
export function arcBenchmarkPriceFromHistory(
  years: ReadonlyArray<{ mya: number | null; erp: number }>,
): number | null {
  if (years.length < 3) return null
  const substituted = years.map((y) => Math.max(y.mya ?? y.erp, y.erp))
  const avg = olympicAverage(substituted)
  return avg == null ? null : round6(avg)
}

// ---------- MYA precedence ----------
// published FINAL > MANUAL override > WASDE midpoint > blended ESTIMATE > missing

export type MyaState = 'manual' | 'final' | 'wasde' | 'estimate' | 'missing'

export const MYA_STATE_LABEL: Record<MyaState, string> = {
  manual: 'MYA (manual)',
  final: 'MYA (final)',
  wasde: 'MYA (WASDE)',
  estimate: 'MYA (est.)',
  missing: 'MYA not set',
}

export type MyaResolution = {
  price: number | null
  state: MyaState
  live: boolean // 'estimate' from a live blend rather than the stored value
}

export function resolveMyaPrice(args: {
  priceData?: ArcPlcPriceData | null
  liveEstimate?: number | null
}): MyaResolution {
  const pd = args.priceData
  if (pd?.mya_price_final != null) return { price: Number(pd.mya_price_final), state: 'final', live: false }
  if (pd?.source === 'manual' && pd.mya_price_estimate != null) {
    return { price: Number(pd.mya_price_estimate), state: 'manual', live: false }
  }
  if (pd?.wasde_midpoint != null) return { price: Number(pd.wasde_midpoint), state: 'wasde', live: false }
  if (args.liveEstimate != null) return { price: Number(args.liveEstimate), state: 'estimate', live: true }
  if (pd?.mya_price_estimate != null) {
    return { price: Number(pd.mya_price_estimate), state: 'estimate', live: false }
  }
  return { price: null, state: 'missing', live: false }
}

// The MYA to use on a stored row (same ordering as resolveMyaPrice minus
// the live tier).
export function myaPrice(priceData?: ArcPlcPriceData | null): number | null {
  return resolveMyaPrice({ priceData }).price
}

// Seed cotton MYA from a lint price ($/lb) and a cottonseed price ($/ton).
export function seedCottonMya(lintPerLb: number, cottonseedPerTon: number): number {
  const cottonseedPerLb = cottonseedPerTon / 2000
  return round6(LINT_SHARE * lintPerLb + COTTONSEED_SHARE * cottonseedPerLb)
}

// ---------- PLC ----------

export type PaymentResult = {
  effectivePrice: number // PLC only: max(mya, loan rate)
  paymentRatePerUnit: number
  grossPerAcre: number
  gross: number
  net: number
}

export function computePlcPayment(args: {
  effectiveReferencePrice: number
  myaPrice: number
  nationalLoanRate: number
  plcYield: number
  baseAcres: number
  paymentFactor?: number
  sequestrationPct?: number
}): PaymentResult {
  const pf = args.paymentFactor ?? PAYMENT_FACTOR
  const seq = args.sequestrationPct ?? DEFAULT_SEQUESTRATION_PCT
  const effectivePrice = Math.max(args.myaPrice, args.nationalLoanRate)
  const paymentRate = Math.max(0, args.effectiveReferencePrice - effectivePrice)
  const grossPerAcre = paymentRate * args.plcYield
  const gross = grossPerAcre * args.baseAcres
  const net = gross * pf * (1 - seq)
  return {
    effectivePrice: round6(effectivePrice),
    paymentRatePerUnit: round6(paymentRate),
    grossPerAcre: round2(grossPerAcre),
    gross: round2(gross),
    net: round2(net),
  }
}

// ---------- ARC-CO county-revenue engine ----------

export type ArcCoEngineResult = PaymentResult & {
  benchmarkRevenue: number // benchmark price x benchmark county yield, $/acre
  guarantee: number // guaranteePct x benchmark revenue, $/acre
  actualRevenue: number // actual county yield x max(MYA, loan rate), $/acre
  maxRatePerAcre: number // capPct x benchmark revenue
  capped: boolean // the revenue shortfall exceeded the cap
}

export function computeArcCoPayment(args: {
  benchmarkPrice: number
  benchmarkYield: number
  myaPrice: number
  actualCountyYield: number
  nationalLoanRate?: number
  baseAcres: number
  guaranteePct?: number
  capPct?: number
  paymentFactor?: number
  sequestrationPct?: number
}): ArcCoEngineResult {
  const pf = args.paymentFactor ?? PAYMENT_FACTOR
  const seq = args.sequestrationPct ?? DEFAULT_SEQUESTRATION_PCT
  const guaranteePct = args.guaranteePct ?? defaultArcGuaranteePct(OBBBA_FIRST_YEAR)
  const capPct = args.capPct ?? defaultArcPaymentCapPct(OBBBA_FIRST_YEAR)
  const effectivePrice = Math.max(args.myaPrice, args.nationalLoanRate ?? 0)
  const benchmarkRevenue = args.benchmarkPrice * args.benchmarkYield
  const guarantee = guaranteePct * benchmarkRevenue
  const actualRevenue = args.actualCountyYield * effectivePrice
  const shortfall = Math.max(0, guarantee - actualRevenue)
  const maxRatePerAcre = capPct * benchmarkRevenue
  const ratePerAcre = Math.min(shortfall, maxRatePerAcre)
  const gross = ratePerAcre * args.baseAcres
  const net = gross * pf * (1 - seq)
  return {
    effectivePrice: round6(effectivePrice),
    paymentRatePerUnit: round6(ratePerAcre),
    grossPerAcre: round2(ratePerAcre),
    gross: round2(gross),
    net: round2(net),
    benchmarkRevenue: round2(benchmarkRevenue),
    guarantee: round2(guarantee),
    actualRevenue: round2(actualRevenue),
    maxRatePerAcre: round2(maxRatePerAcre),
    capped: shortfall > maxRatePerAcre,
  }
}

// Fallback ARC payment from a projected rate per base acre: counties with
// no benchmark row, and ARC-IC (individual farm revenue is not modeled).
export function computeArcCoFlatPayment(args: {
  projectedRatePerAcre: number
  baseAcres: number
  paymentFactor?: number
  sequestrationPct?: number
}): PaymentResult {
  const pf = args.paymentFactor ?? PAYMENT_FACTOR
  const seq = args.sequestrationPct ?? DEFAULT_SEQUESTRATION_PCT
  const gross = args.projectedRatePerAcre * args.baseAcres
  const net = gross * pf * (1 - seq)
  return {
    effectivePrice: 0,
    paymentRatePerUnit: round6(args.projectedRatePerAcre),
    grossPerAcre: round2(args.projectedRatePerAcre),
    gross: round2(gross),
    net: round2(net),
  }
}

// actual county yield = benchmark x (1 + pct/100)
export function expectedCountyYield(benchmarkYield: number, vsBenchmarkPct: number): number {
  return round2(benchmarkYield * (1 + vsBenchmarkPct / 100))
}

export { DEFAULT_ARC_IC_PAYMENT_FACTOR }

// ---------- Program year vs payment year ----------
// ARC/PLC for PROGRAM year N is paid in October of N+1. All the math is
// keyed to the program year; cash attributes to the year it arrives.
// These functions are the ONE place the +1 lives.

export function revenueCropYearFor(programYear: number): number {
  return programYear + 1
}

export function programYearFor(revenueCropYear: number): number {
  return revenueCropYear - 1
}

// ISO date (Oct 1 of program year + 1).
export function expectedArcPlcDate(programYear: number): string {
  return `${revenueCropYearFor(programYear)}-10-01`
}
