// Fetch-all + project helper shared by the Government Payments page, the
// property/entity cards, and the income engine, so every view computes the
// same numbers from the same rows. Session client only (RLS scopes the
// per-org tables; the global tables are read-all).

import { resolveProgramYearConfig, type ProgramYearConfig, type ResolvedProgramConfig } from './programConfig'
import {
  programYearFor,
  type ArcPlcPriceData,
  type CoveredCommodity,
} from './govPayments'
import {
  allocateToProperties,
  projectFarms,
  type BaseAcreRow,
  type BenchmarkRow,
  type ElectionRow,
  type FarmPropertyLink,
  type FsaFarmRow,
  type ProjectionRow,
  type PropertyAllocation,
} from './govProjection'

export interface GovInputs {
  farms: FsaFarmRow[]
  links: FarmPropertyLink[]
  baseAcres: BaseAcreRow[]
  elections: ElectionRow[]
  commodities: CoveredCommodity[]
  priceData: ArcPlcPriceData[]
  configs: ProgramYearConfig[]
  benchmarks: BenchmarkRow[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any

export async function loadGovInputs(supabase: Client): Promise<GovInputs> {
  const [farms, links, base, elections, commodities, prices, configs] = await Promise.all([
    supabase.from('fsa_farms').select('id, farm_number, state, county, farmland_acres, cropland_acres, dcp_cropland_acres, notes').order('farm_number'),
    supabase.from('fsa_farm_properties').select('fsa_farm_id, property_id, allocation_pct'),
    supabase.from('fsa_base_acres').select('fsa_farm_id, commodity, base_acres, plc_yield, tract_numbers'),
    supabase.from('fsa_elections').select('fsa_farm_id, commodity, program_year, election'),
    supabase.from('covered_commodities').select('*'),
    supabase.from('arc_plc_price_data').select('*'),
    supabase.from('program_year_config').select('*'),
  ])
  const farmRows = (farms.data ?? []) as FsaFarmRow[]
  // Benchmarks only for the states/counties the farms sit in.
  const states = Array.from(new Set(farmRows.map((f) => (f.state ?? '').toUpperCase()).filter(Boolean)))
  let benchmarks: BenchmarkRow[] = []
  if (states.length > 0) {
    const { data } = await supabase
      .from('fsa_benchmark_cache')
      .select('data_year, state_code, county, commodity, benchmark_yield, benchmark_price')
      .in('state_code', states)
      .order('data_year', { ascending: false })
    benchmarks = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      state_code: String(r.state_code),
      county: String(r.county),
      commodity: fileCommodityToSlug(String(r.commodity)),
      benchmark_yield: r.benchmark_yield == null ? null : Number(r.benchmark_yield),
      benchmark_price: r.benchmark_price == null ? null : Number(r.benchmark_price),
      data_year: Number(r.data_year),
    }))
  }
  return {
    farms: farmRows,
    links: (links.data ?? []) as FarmPropertyLink[],
    baseAcres: (base.data ?? []) as BaseAcreRow[],
    elections: (elections.data ?? []) as ElectionRow[],
    commodities: (commodities.data ?? []) as CoveredCommodity[],
    priceData: (prices.data ?? []) as ArcPlcPriceData[],
    configs: (configs.data ?? []) as ProgramYearConfig[],
    benchmarks,
  }
}

// The FSA workbook prints commodities like "CORN", "GRAIN SORGHUM",
// "SEED COTTON", "ALL WHEAT"; map to our slugs.
export function fileCommodityToSlug(raw: string): string {
  const s = raw.toUpperCase().trim()
  if (s.includes('WHEAT')) return 'wheat'
  if (s.includes('SORGHUM')) return 'grain_sorghum'
  if (s.includes('COTTON')) return 'seed_cotton'
  if (s.includes('SOYBEAN')) return 'soybeans'
  if (s.includes('PEANUT')) return 'peanuts'
  return s.toLowerCase().replace(/\s+/g, '_')
}

export interface OrgProjection {
  programYear: number
  paymentYear: number
  config: ResolvedProgramConfig
  rows: ProjectionRow[]
  allocations: PropertyAllocation[]
  netByProperty: Map<string, number>
  baseAcresByProperty: Map<string, Map<string, number>> // property -> commodity -> acres
}

// Keep only the newest file year per (state, county, commodity): the
// engine notes when it is older than the program year.
function newestBenchmarks(rows: BenchmarkRow[]): BenchmarkRow[] {
  const seen = new Set<string>()
  const out: BenchmarkRow[] = []
  for (const r of [...rows].sort((a, b) => b.data_year - a.data_year)) {
    const key = `${r.state_code}|${r.county}|${r.commodity}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(r)
  }
  return out
}

export function projectOrg(inputs: GovInputs, programYear: number, liveEstimates?: ReadonlyMap<string, number>): OrgProjection {
  const config = resolveProgramYearConfig(programYear, inputs.configs)
  const rows = projectFarms({
    programYear,
    farms: inputs.farms,
    baseAcres: inputs.baseAcres,
    elections: inputs.elections,
    commodities: inputs.commodities,
    priceData: inputs.priceData,
    benchmarks: newestBenchmarks(inputs.benchmarks).filter((b) => b.data_year <= programYear),
    liveEstimates,
    config,
  })
  const allocations = allocateToProperties(rows, inputs.links)
  const netByProperty = new Map<string, number>()
  const baseAcresByProperty = new Map<string, Map<string, number>>()
  for (const a of allocations) {
    netByProperty.set(a.propertyId, Math.round(((netByProperty.get(a.propertyId) ?? 0) + a.net) * 100) / 100)
    if (!baseAcresByProperty.has(a.propertyId)) baseAcresByProperty.set(a.propertyId, new Map())
    const m = baseAcresByProperty.get(a.propertyId)!
    m.set(a.commodity, Math.round(((m.get(a.commodity) ?? 0) + a.baseAcres) * 100) / 100)
  }
  return { programYear, paymentYear: programYear + 1, config, rows, allocations, netByProperty, baseAcresByProperty }
}

// Projection for the program year that PAYS in the given cash year.
export function projectForPaymentYear(inputs: GovInputs, paymentYear: number): OrgProjection {
  return projectOrg(inputs, programYearFor(paymentYear))
}
