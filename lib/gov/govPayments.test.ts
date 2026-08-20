import { describe, expect, it } from 'vitest'
import {
  arcBenchmarkPriceFromHistory,
  computeArcCoPayment,
  computeArcCoFlatPayment,
  computeEffectiveReferencePrice,
  computePlcPayment,
  effectiveReferencePrice,
  expectedArcPlcDate,
  expectedCountyYield,
  olympicAverage,
  programYearFor,
  resolveMyaPrice,
  revenueCropYearFor,
  seedCottonMya,
} from './govPayments'
import { resolveProgramYearConfig, programConfigNotice } from './programConfig'
import { estimateMyaBlend, marketingYearMonths } from './myaEstimate'

describe('Olympic average and ERP (handoff doc section 3.3)', () => {
  it('drops the high and low', () => {
    expect(olympicAverage([3, 4, 5, 6, 10])).toBe(5)
    expect(olympicAverage([1, 2])).toBeNull()
  })
  it('ERP = min(1.15 x stat, max(stat, 0.88 x olympic))', () => {
    // corn statutory 4.10; olympic 5.50 -> 0.88*5.5 = 4.84 (under the 4.715 cap? no: cap 1.15*4.10 = 4.715) => 4.715
    expect(computeEffectiveReferencePrice({ statutoryReferencePrice: 4.1, olympicAvgMya: 5.5 })).toBe(4.715)
    // olympic 4.80 -> 4.224 > 4.10 and under cap => 4.224
    expect(computeEffectiveReferencePrice({ statutoryReferencePrice: 4.1, olympicAvgMya: 4.8 })).toBe(4.224)
    // olympic 3.50 -> 3.08 < stat => floor 4.10
    expect(computeEffectiveReferencePrice({ statutoryReferencePrice: 4.1, olympicAvgMya: 3.5 })).toBe(4.1)
    expect(computeEffectiveReferencePrice({ statutoryReferencePrice: 4.1 })).toBe(4.1)
  })
  it('a published ERP on the price row wins over the computed one', () => {
    expect(
      effectiveReferencePrice({ statutory_reference_price: 4.1 }, { effective_reference_price: 4.42 }),
    ).toBe(4.42)
    expect(effectiveReferencePrice({ statutory_reference_price: 4.1 }, null)).toBe(4.1)
  })
  it('ARC benchmark price substitutes the ERP for low years', () => {
    const years = [
      { mya: 6.54, erp: 4.1 },
      { mya: 6.54, erp: 4.1 },
      { mya: 4.55, erp: 4.1 },
      { mya: 4.0, erp: 4.1 }, // counts at 4.10
      { mya: null, erp: 4.42 }, // counts at its ERP
    ]
    // substituted: [6.54, 6.54, 4.55, 4.10, 4.42] -> drop 6.54 and 4.10 -> (6.54+4.55+4.42)/3
    expect(arcBenchmarkPriceFromHistory(years)).toBeCloseTo((6.54 + 4.55 + 4.42) / 3, 6)
  })
})

describe('PLC (handoff doc 4.1)', () => {
  it('corn: ERP 4.42, MYA 4.10, loan 2.42, yield 150, base 100 => rate 0.32, gross 4,800.00, net 3,859.68', () => {
    const r = computePlcPayment({
      effectiveReferencePrice: 4.42, myaPrice: 4.1, nationalLoanRate: 2.42, plcYield: 150, baseAcres: 100,
    })
    expect(r.effectivePrice).toBe(4.1)
    expect(r.paymentRatePerUnit).toBe(0.32)
    expect(r.grossPerAcre).toBe(48)
    expect(r.gross).toBe(4800)
    expect(r.net).toBe(3859.68)
  })
  it('the loan rate floors the effective price', () => {
    const r = computePlcPayment({
      effectiveReferencePrice: 4.42, myaPrice: 2.0, nationalLoanRate: 2.42, plcYield: 100, baseAcres: 10,
    })
    expect(r.effectivePrice).toBe(2.42)
    expect(r.paymentRatePerUnit).toBe(2.0)
  })
  it('no payment when the MYA is above the ERP', () => {
    expect(
      computePlcPayment({ effectiveReferencePrice: 4.42, myaPrice: 5, nationalLoanRate: 2.42, plcYield: 150, baseAcres: 100 }).net,
    ).toBe(0)
  })
  it('per-year factors are honored (pre-OBBBA sequestration only differs via config)', () => {
    const r = computePlcPayment({
      effectiveReferencePrice: 4.42, myaPrice: 4.1, nationalLoanRate: 2.42, plcYield: 150, baseAcres: 100,
      paymentFactor: 0.85, sequestrationPct: 0,
    })
    expect(r.net).toBe(4080)
  })
})

describe('ARC-CO engine (handoff doc 4.2)', () => {
  it('benchmark 5.03 x 180 = 905.40; guarantee 814.86; actual 170 x 4.10 = 697.00; shortfall 117.86 capped at 108.648; base 100 => gross 10,864.80, net 8,736.39', () => {
    const r = computeArcCoPayment({
      benchmarkPrice: 5.03, benchmarkYield: 180, myaPrice: 4.1, actualCountyYield: 170,
      nationalLoanRate: 2.42, baseAcres: 100,
    })
    expect(r.benchmarkRevenue).toBe(905.4)
    expect(r.guarantee).toBe(814.86)
    expect(r.actualRevenue).toBe(697)
    expect(r.maxRatePerAcre).toBe(108.65)
    expect(r.capped).toBe(true)
    expect(r.grossPerAcre).toBe(108.65)
    expect(r.gross).toBe(10864.8)
    // 10864.8 * 0.85 * 0.946 = 8736.39 (2 dp)
    expect(r.net).toBe(round2(10864.8 * 0.85 * (1 - 0.054)))
  })
  it('no shortfall, no payment', () => {
    const r = computeArcCoPayment({
      benchmarkPrice: 5.03, benchmarkYield: 180, myaPrice: 5.0, actualCountyYield: 180, baseAcres: 100,
    })
    expect(r.net).toBe(0)
    expect(r.capped).toBe(false)
  })
  it('flat fallback nets the same way; ARC-IC factor 0.65', () => {
    expect(computeArcCoFlatPayment({ projectedRatePerAcre: 20, baseAcres: 50 }).net).toBe(round2(1000 * 0.85 * 0.946))
    expect(computeArcCoFlatPayment({ projectedRatePerAcre: 20, baseAcres: 50, paymentFactor: 0.65 }).net).toBe(
      round2(1000 * 0.65 * 0.946),
    )
  })
  it('expected county yield applies the vs-benchmark percent', () => {
    expect(expectedCountyYield(180, -10)).toBe(162)
    expect(expectedCountyYield(180, 0)).toBe(180)
  })
})

describe('MYA precedence (handoff doc 1.3)', () => {
  const row = (over: Partial<Parameters<typeof resolveMyaPrice>[0]['priceData'] & object>) => ({
    commodity: 'corn', program_year: 2025, effective_reference_price: null,
    mya_price_estimate: null, mya_price_final: null, wasde_midpoint: null, source: 'estimate',
    ...over,
  })
  it('final > manual > wasde > live estimate > stored estimate > missing', () => {
    expect(resolveMyaPrice({ priceData: row({ mya_price_final: 4.5, mya_price_estimate: 4.0, source: 'manual' }) }).state).toBe('final')
    expect(resolveMyaPrice({ priceData: row({ mya_price_estimate: 4.0, source: 'manual', wasde_midpoint: 4.3 }) })).toMatchObject({ price: 4.0, state: 'manual' })
    expect(resolveMyaPrice({ priceData: row({ wasde_midpoint: 4.3, mya_price_estimate: 4.0 }), liveEstimate: 4.2 })).toMatchObject({ price: 4.3, state: 'wasde' })
    expect(resolveMyaPrice({ priceData: row({ mya_price_estimate: 4.0 }), liveEstimate: 4.2 })).toMatchObject({ price: 4.2, state: 'estimate', live: true })
    expect(resolveMyaPrice({ priceData: row({ mya_price_estimate: 4.0 }) })).toMatchObject({ price: 4.0, state: 'estimate', live: false })
    expect(resolveMyaPrice({ priceData: null }).state).toBe('missing')
  })
  it('seed cotton composite: 0.43 x lint + 0.57 x seed/2000', () => {
    expect(seedCottonMya(0.65, 240)).toBe(round6(0.43 * 0.65 + 0.57 * 0.12))
  })
})

describe('payment-year attribution (handoff doc 5)', () => {
  it('program year N pays October N+1, and the +1 lives in one place', () => {
    expect(revenueCropYearFor(2025)).toBe(2026)
    expect(programYearFor(2026)).toBe(2025)
    expect(expectedArcPlcDate(2025)).toBe('2025-10-01'.replace('2025', '2026'))
  })
})

describe('program config resolution', () => {
  const cfg = (year: number) => ({
    crop_year: year, sequestration_pct: 0.054, arc_guarantee_pct: 0.9, arc_payment_cap_pct: 0.12,
    erp_olympic_factor: 0.88, erp_cap_pct: 1.15, payment_factor: 0.85, arc_ic_payment_factor: 0.65,
  })
  it('exact year, fallback to the most recent at or below, built-ins when empty', () => {
    expect(resolveProgramYearConfig(2026, [cfg(2025), cfg(2026)]).isFallback).toBe(false)
    const fb = resolveProgramYearConfig(2028, [cfg(2025), cfg(2026)])
    expect(fb.isFallback).toBe(true)
    expect(fb.sourceYear).toBe(2026)
    expect(programConfigNotice(fb)).toContain('2026')
    const none = resolveProgramYearConfig(2024, [])
    expect(none.arcGuaranteePct).toBe(0.86)
    expect(resolveProgramYearConfig(2025, []).arcGuaranteePct).toBe(0.9)
  })
})

describe('MYA blend over published months only', () => {
  it('marketing year months and weights normalize over published months', () => {
    expect(marketingYearMonths(9, 2025)[0]).toEqual({ month: 9, year: 2025 })
    expect(marketingYearMonths(9, 2025)[11]).toEqual({ month: 8, year: 2026 })
    // Corn Sep 4.00 (w .06) and Oct 4.20 (w .115): (4*.06 + 4.2*.115)/(.175) = 4.1314
    const r = estimateMyaBlend({
      commodityName: 'corn', marketingYearStartMonth: 9, cropYear: 2025,
      monthlyPrices: [{ month: 9, price: 4.0 }, { month: 10, price: 4.2 }],
    })
    expect(r.publishedCount).toBe(2)
    expect(r.missingCount).toBe(10)
    expect(r.estimate).toBeCloseTo((4 * 0.06 + 4.2 * 0.115) / 0.175, 3)
    expect(estimateMyaBlend({ commodityName: 'oats', marketingYearStartMonth: 6, cropYear: 2025, monthlyPrices: [] }).estimate).toBeNull()
  })
})

function round2(n: number) {
  return Math.round(n * 100) / 100
}
function round6(n: number) {
  return Math.round(n * 1e6) / 1e6
}
