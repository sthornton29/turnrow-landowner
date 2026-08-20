import { describe, expect, it } from 'vitest'
import { commoditySlug, mergeFsaExtractions, normalizeFsaExtraction } from './fsaImport'

describe('normalizeFsaExtraction', () => {
  it('reads the packet shape and the legacy single-farm shape', () => {
    expect(normalizeFsaExtraction({ farms: [{ farm_number: '1234' }, { farm_number: '1235' }] })).toHaveLength(2)
    const legacy = normalizeFsaExtraction({ farm_number: '99', base_acres: [] })
    expect(legacy).toHaveLength(1)
    expect(legacy[0].farm_number).toBe('99')
    expect(normalizeFsaExtraction({ something: 1 })).toEqual([])
    expect(normalizeFsaExtraction(null)).toEqual([])
  })
})

describe('mergeFsaExtractions (PDF chunks of one packet)', () => {
  it('collapses the same farm across chunks, unions commodities, fills nulls', () => {
    const merged = mergeFsaExtractions([
      {
        farms: [
          { farm_number: '1234', county: 'Lawrence', state: null, tract_numbers: '100',
            cropland_acres: 210.5, base_acres: [{ commodity: 'CORN', base_acres: 100, plc_yield: 150 }] },
          { farm_number: '1235', county: 'Lawrence', base_acres: [] },
        ],
        unsure_fields: ['farms[0].plc_yield'],
        pages_scanned: 90, total_pages: 140,
      },
      {
        farms: [
          { farm_number: '1234', state: 'AL', tract_numbers: '101, 100',
            base_acres: [{ commodity: 'Corn', base_acres: null, plc_yield: null }, { commodity: 'SOYBEANS', base_acres: 50, plc_yield: 40 }] },
          { farm_number: '1240', county: 'Colbert', base_acres: [{ commodity: 'WHEAT', base_acres: 20, plc_yield: 55 }] },
        ],
        unsure_fields: ['farms[1].county'],
        pages_scanned: 50, total_pages: 140,
      },
    ])
    expect(merged.farms.map((f) => f.farm_number)).toEqual(['1234', '1235', '1240'])
    const f = merged.farms[0]
    expect(f.state).toBe('AL')
    expect(f.county).toBe('Lawrence')
    expect(f.cropland_acres).toBe(210.5)
    expect(f.tract_numbers).toBe('100, 101')
    expect(f.base_acres).toHaveLength(2)
    expect(f.base_acres?.[0]).toMatchObject({ base_acres: 100, plc_yield: 150 })
    expect(merged.unsure_fields).toEqual(['farms[0].plc_yield', 'farms[1].county'])
    expect(merged.pages_scanned).toBe(140)
    expect(merged.total_pages).toBe(140)
  })

  it('keeps farms without a number apart rather than merging them together', () => {
    const merged = mergeFsaExtractions([{ farms: [{ farm_number: null }, { farm_number: '' }] }])
    expect(merged.farms).toHaveLength(2)
  })

  it('accepts legacy single-farm chunks', () => {
    const merged = mergeFsaExtractions([{ farm_number: '7', base_acres: [{ commodity: 'PEANUTS', base_acres: 10, plc_yield: 3000 }] }])
    expect(merged.farms[0].farm_number).toBe('7')
    expect(commoditySlug(merged.farms[0].base_acres?.[0].commodity)).toBe('peanuts')
  })
})
