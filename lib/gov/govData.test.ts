import { describe, expect, it } from 'vitest'
import { projectOrg, type GovInputs } from './govData'

// ARC-CO corn on farm 1234 (Lawrence County, AL), 100 base acres, MYA
// 4.10. With the 2025 county benchmark (180 bu x $5.03) the guarantee is
// 814.86 against actual revenue 738.00: 76.86 an acre, 7,686.00 gross.
const inputs = (benchmarks: GovInputs['benchmarks']): GovInputs => ({
  farms: [{ id: 'f1', farm_number: '1234', state: 'AL', county: 'Lawrence' }],
  links: [{ fsa_farm_id: 'f1', property_id: 'p1', allocation_pct: 100 }],
  baseAcres: [{ fsa_farm_id: 'f1', commodity: 'corn', base_acres: 100, plc_yield: 150 }],
  elections: [{ fsa_farm_id: 'f1', commodity: 'corn', program_year: 2025, election: 'arc_co' }],
  commodities: [
    { slug: 'corn', name: 'Corn', unit: 'bushel' as const, statutory_reference_price: 4.1, national_loan_rate: 2.42, marketing_year_start_month: 9 },
  ],
  priceData: [
    { commodity: 'corn', program_year: 2025, effective_reference_price: 4.42, mya_price_estimate: 4.1, mya_price_final: null, wasde_midpoint: null, source: 'estimate' },
  ],
  configs: [
    {
      crop_year: 2025, sequestration_pct: 0.054, arc_guarantee_pct: 0.9, arc_payment_cap_pct: 0.12,
      erp_olympic_factor: 0.88, erp_cap_pct: 1.15, payment_factor: 0.85, arc_ic_payment_factor: 0.65,
    },
  ],
  benchmarks,
})
const bench = (data_year: number, benchmark_yield: number, benchmark_price: number) => ({
  state_code: 'AL', county: 'LAWRENCE', commodity: 'corn', benchmark_yield, benchmark_price, data_year,
})
const net2025 = Math.round(7686 * 0.85 * 0.946 * 100) / 100

describe('projectOrg county benchmarks', () => {
  it('a newer file year in the cache does not hide the program year\'s own benchmark', () => {
    // Caching the 2026 row used to zero the 2025 ARC-CO projection: the
    // newest row per county was kept first, then dropped for being newer
    // than the program year, leaving nothing.
    const p = projectOrg(inputs([bench(2026, 190, 4.6), bench(2025, 180, 5.03)]), 2025)
    expect(p.rows[0].flat).toBe(false)
    expect(p.rows[0].drivers.benchmark_yield).toBe(180)
    expect(p.rows[0].net).toBe(net2025)
    expect(p.netByProperty.get('p1')).toBe(net2025)
    expect(p.rows[0].notes).toEqual([])
  })

  it('falls back to the newest file year that is not newer than the program year', () => {
    const p = projectOrg(inputs([bench(2026, 190, 4.6), bench(2024, 180, 5.03), bench(2023, 170, 5.5)]), 2025)
    expect(p.rows[0].flat).toBe(false)
    expect(p.rows[0].drivers.benchmark_yield).toBe(180)
    expect(p.rows[0].notes.join(' ')).toContain('2024')
  })

  it('only newer file years: no benchmark applies, flat estimate', () => {
    const p = projectOrg(inputs([bench(2026, 190, 4.6)]), 2025)
    expect(p.rows[0].flat).toBe(true)
  })
})
