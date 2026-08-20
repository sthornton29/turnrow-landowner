import { describe, expect, it } from 'vitest'
import { resolveProgramYearConfig } from './programConfig'
import {
  UNLINKED_FARM,
  allocateToProperties,
  normalizeCountyKey,
  projectFarms,
  sumNet,
} from './govProjection'

const config = resolveProgramYearConfig(2025, [
  {
    crop_year: 2025, sequestration_pct: 0.054, arc_guarantee_pct: 0.9, arc_payment_cap_pct: 0.12,
    erp_olympic_factor: 0.88, erp_cap_pct: 1.15, payment_factor: 0.85, arc_ic_payment_factor: 0.65,
  },
])
const corn = {
  slug: 'corn', name: 'Corn', unit: 'bushel' as const, statutory_reference_price: 4.1,
  national_loan_rate: 2.42, marketing_year_start_month: 9,
}
const farms = [{ id: 'f1', farm_number: '1234', state: 'AL', county: 'Lawrence' }]

describe('projectFarms', () => {
  it('PLC corn on farm 1234: 100 base x 150 yield, ERP 4.42, MYA 4.10 => net 3,859.68', () => {
    const rows = projectFarms({
      programYear: 2025,
      farms,
      baseAcres: [{ fsa_farm_id: 'f1', commodity: 'corn', base_acres: 100, plc_yield: 150 }],
      elections: [],
      commodities: [corn],
      priceData: [{ commodity: 'corn', program_year: 2025, effective_reference_price: 4.42, mya_price_estimate: 4.1, mya_price_final: null, wasde_midpoint: null, source: 'estimate' }],
      config,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].election).toBe('plc')
    expect(rows[0].net).toBe(3859.68)
    expect(rows[0].computable).toBe(true)
  })

  it('defaults to PLC and reports not computable without an MYA', () => {
    const rows = projectFarms({
      programYear: 2025, farms,
      baseAcres: [{ fsa_farm_id: 'f1', commodity: 'corn', base_acres: 100, plc_yield: 150 }],
      elections: [], commodities: [corn], priceData: [], config,
    })
    expect(rows[0].computable).toBe(false)
    expect(rows[0].net).toBe(0)
  })

  it('ARC-CO uses the county benchmark and notes an older file year', () => {
    const rows = projectFarms({
      programYear: 2025, farms,
      baseAcres: [{ fsa_farm_id: 'f1', commodity: 'corn', base_acres: 100, plc_yield: 150 }],
      elections: [{ fsa_farm_id: 'f1', commodity: 'corn', program_year: 2025, election: 'arc_co' }],
      commodities: [corn],
      priceData: [{ commodity: 'corn', program_year: 2025, effective_reference_price: 4.42, mya_price_estimate: 4.1, mya_price_final: null, wasde_midpoint: null, source: 'estimate' }],
      benchmarks: [{ state_code: 'AL', county: 'LAWRENCE', commodity: 'corn', benchmark_yield: 180, benchmark_price: 5.03, data_year: 2024 }],
      config,
    })
    expect(rows[0].flat).toBe(false)
    // guarantee 814.86 - actual 180 x 4.10 = 738.00 => shortfall 76.86/acre (under the 108.648 cap)
    expect(rows[0].drivers.capped).toBe(false)
    expect(rows[0].net).toBe(Math.round(7686 * 0.85 * 0.946 * 100) / 100)
    expect(rows[0].notes.join(' ')).toContain('2024')
  })

  it('ARC-CO without a benchmark falls back to a flat estimate', () => {
    const rows = projectFarms({
      programYear: 2025, farms,
      baseAcres: [{ fsa_farm_id: 'f1', commodity: 'corn', base_acres: 100, plc_yield: 150 }],
      elections: [{ fsa_farm_id: 'f1', commodity: 'corn', program_year: 2025, election: 'arc_co' }],
      commodities: [corn], priceData: [], config, arcFlatRatePerAcre: 20,
    })
    expect(rows[0].flat).toBe(true)
    expect(rows[0].net).toBe(Math.round(2000 * 0.85 * 0.946 * 100) / 100)
  })

  it('allocates to properties by link percent, unlinked farms are flagged', () => {
    const rows = projectFarms({
      programYear: 2025, farms,
      baseAcres: [{ fsa_farm_id: 'f1', commodity: 'corn', base_acres: 100, plc_yield: 150 }],
      elections: [], commodities: [corn],
      priceData: [{ commodity: 'corn', program_year: 2025, effective_reference_price: 4.42, mya_price_estimate: 4.1, mya_price_final: null, wasde_midpoint: null, source: 'estimate' }],
      config,
    })
    const alloc = allocateToProperties(rows, [
      { fsa_farm_id: 'f1', property_id: 'pA', allocation_pct: 60 },
      { fsa_farm_id: 'f1', property_id: 'pB', allocation_pct: 40 },
    ])
    expect(alloc.map((a) => a.net)).toEqual([2315.81, 1543.87])
    expect(alloc.map((a) => a.baseAcres)).toEqual([60, 40])
    expect(sumNet(alloc)).toBe(3859.68)
    expect(allocateToProperties(rows, [])[0].propertyId).toBe(UNLINKED_FARM)
  })

  it('county keys normalize like the FSA file', () => {
    expect(normalizeCountyKey('St. Clair County')).toBe('ST CLAIR')
    expect(normalizeCountyKey('lawrence')).toBe('LAWRENCE')
  })
})
