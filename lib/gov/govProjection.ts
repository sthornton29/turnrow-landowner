// Whole-org ARC/PLC projection for the landowner app: per FSA farm x
// commodity at its election, allocated to properties by the farm link
// percentages. Pure; pages and the income engine pass fetched rows in.
// No payment limits anywhere (the tenant's world). Estimates only.

import {
  computeArcCoFlatPayment,
  computeArcCoPayment,
  computePlcPayment,
  effectiveReferencePrice,
  expectedCountyYield,
  resolveMyaPrice,
  revenueCropYearFor,
  type ArcPlcPriceData,
  type CoveredCommodity,
  type ElectionType,
} from './govPayments'
import type { ResolvedProgramConfig } from './programConfig'

export interface FsaFarmRow {
  id: string
  farm_number: string
  state: string | null
  county: string | null
  farmland_acres?: number | string | null
  cropland_acres?: number | string | null
}

export interface BaseAcreRow {
  fsa_farm_id: string
  commodity: string
  base_acres: number | string | null
  plc_yield: number | string | null
}

export interface ElectionRow {
  fsa_farm_id: string
  commodity: string
  program_year: number
  election: ElectionType
}

export interface FarmPropertyLink {
  fsa_farm_id: string
  property_id: string
  allocation_pct: number | string
}

// A resolved county benchmark for one commodity (from fsa_benchmark_cache),
// plus the operator's expected yield vs benchmark (default 0).
export interface BenchmarkRow {
  state_code: string
  county: string // normalized uppercase
  commodity: string // slug
  benchmark_yield: number | null
  benchmark_price: number | null
  data_year: number
  county_yield_vs_benchmark_pct?: number | null
}

export interface ProjectionRow {
  farmId: string
  farmNumber: string
  commodity: string
  baseAcres: number
  plcYield: number
  election: ElectionType
  effectiveReferencePrice: number
  myaPrice: number | null
  myaState: string
  paymentRatePerUnit: number
  grossPerAcre: number
  gross: number
  net: number
  computable: boolean
  flat: boolean // ARC fallback (no benchmark / ARC-IC)
  drivers: Record<string, number | string | boolean | null>
  notes: string[]
}

export function normalizeCountyKey(county: string | null | undefined): string {
  return (county ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '')
    .replace(/\s+(COUNTY|PARISH|BOROUGH|CENSUS AREA)$/i, '')
    .trim()
}

// Project one program year for every farm x commodity base-acre record.
export function projectFarms(args: {
  programYear: number
  farms: FsaFarmRow[]
  baseAcres: BaseAcreRow[]
  elections: ElectionRow[]
  commodities: CoveredCommodity[]
  priceData: ArcPlcPriceData[]
  benchmarks?: BenchmarkRow[]
  liveEstimates?: ReadonlyMap<string, number> // commodity slug -> blended MYA
  config: ResolvedProgramConfig
  arcFlatRatePerAcre?: number | null
}): ProjectionRow[] {
  const farmById = new Map(args.farms.map((f) => [f.id, f]))
  const commodityBySlug = new Map(args.commodities.map((c) => [String(c.slug), c]))
  const out: ProjectionRow[] = []
  for (const b of args.baseAcres) {
    const farm = farmById.get(b.fsa_farm_id)
    const commodity = commodityBySlug.get(b.commodity)
    if (!farm || !commodity) continue
    const baseAcres = Number(b.base_acres ?? 0)
    const plcYield = baseAcres > 0 ? Number(b.plc_yield ?? 0) : 0
    const election: ElectionType =
      args.elections.find(
        (e) => e.fsa_farm_id === b.fsa_farm_id && e.commodity === b.commodity && Number(e.program_year) === args.programYear,
      )?.election ?? 'plc'
    const pd = args.priceData.find((p) => p.commodity === b.commodity && Number(p.program_year) === args.programYear) ?? null
    const mya = resolveMyaPrice({ priceData: pd, liveEstimate: args.liveEstimates?.get(b.commodity) ?? null })
    const erp = effectiveReferencePrice(commodity, pd, {
      erpOlympicFactor: args.config.erpOlympicFactor,
      erpCapPct: args.config.erpCapPct,
    })
    const notes: string[] = []
    const base = {
      farmId: farm.id,
      farmNumber: farm.farm_number,
      commodity: b.commodity,
      baseAcres,
      plcYield,
      election,
      effectiveReferencePrice: erp,
      myaPrice: mya.price,
      myaState: mya.state,
    }

    if (election === 'plc') {
      if (mya.price == null) {
        notes.push('No marketing-year average price yet for this commodity and year.')
        out.push({ ...base, paymentRatePerUnit: 0, grossPerAcre: 0, gross: 0, net: 0, computable: false, flat: false, drivers: {}, notes })
        continue
      }
      const r = computePlcPayment({
        effectiveReferencePrice: erp,
        myaPrice: mya.price,
        nationalLoanRate: Number(commodity.national_loan_rate),
        plcYield,
        baseAcres,
        paymentFactor: args.config.paymentFactor,
        sequestrationPct: args.config.sequestrationPct,
      })
      out.push({
        ...base,
        paymentRatePerUnit: r.paymentRatePerUnit,
        grossPerAcre: r.grossPerAcre,
        gross: r.gross,
        net: r.net,
        computable: true,
        flat: false,
        drivers: {
          effective_reference_price: erp,
          mya_price: mya.price,
          national_loan_rate: Number(commodity.national_loan_rate),
          effective_price: r.effectivePrice,
          payment_rate: r.paymentRatePerUnit,
          plc_yield: plcYield,
          payment_factor: args.config.paymentFactor,
          sequestration_pct: args.config.sequestrationPct,
        },
        notes,
      })
      continue
    }

    const bench =
      election === 'arc_co'
        ? (args.benchmarks ?? []).find(
            (x) =>
              x.commodity === b.commodity &&
              x.state_code === (farm.state ?? '').toUpperCase() &&
              normalizeCountyKey(x.county) === normalizeCountyKey(farm.county),
          ) ?? null
        : null
    if (election === 'arc_co' && bench?.benchmark_price != null && bench.benchmark_yield != null && mya.price != null) {
      const vsPct = Number(bench.county_yield_vs_benchmark_pct ?? 0)
      const actual = expectedCountyYield(bench.benchmark_yield, vsPct)
      const r = computeArcCoPayment({
        benchmarkPrice: bench.benchmark_price,
        benchmarkYield: bench.benchmark_yield,
        myaPrice: mya.price,
        actualCountyYield: actual,
        nationalLoanRate: Number(commodity.national_loan_rate),
        baseAcres,
        guaranteePct: args.config.arcGuaranteePct,
        capPct: args.config.arcPaymentCapPct,
        paymentFactor: args.config.paymentFactor,
        sequestrationPct: args.config.sequestrationPct,
      })
      if (bench.data_year !== args.programYear) {
        notes.push(`County benchmark from the ${bench.data_year} FSA file (the ${args.programYear} file is not published yet).`)
      }
      out.push({
        ...base,
        paymentRatePerUnit: r.paymentRatePerUnit,
        grossPerAcre: r.grossPerAcre,
        gross: r.gross,
        net: r.net,
        computable: true,
        flat: false,
        drivers: {
          benchmark_price: bench.benchmark_price,
          benchmark_yield: bench.benchmark_yield,
          county_yield_vs_benchmark_pct: vsPct,
          actual_county_yield: actual,
          benchmark_revenue: r.benchmarkRevenue,
          guarantee: r.guarantee,
          actual_revenue: r.actualRevenue,
          max_rate_per_acre: r.maxRatePerAcre,
          capped: r.capped,
          mya_price: mya.price,
          guarantee_pct: args.config.arcGuaranteePct,
          cap_pct: args.config.arcPaymentCapPct,
        },
        notes,
      })
      continue
    }

    // ARC-CO without a benchmark row, and ARC-IC: flat estimate.
    const rate = args.arcFlatRatePerAcre ?? null
    notes.push(
      election === 'arc_ic'
        ? 'ARC-IC pays on individual farm revenue, which is not modeled; flat estimate.'
        : farm.county
          ? `No FSA county benchmark row for ${farm.county} County; flat estimate.`
          : 'The farm has no county set, so no county benchmark can be looked up; flat estimate.',
    )
    const r = computeArcCoFlatPayment({
      projectedRatePerAcre: rate ?? 0,
      baseAcres,
      paymentFactor: election === 'arc_ic' ? args.config.arcIcPaymentFactor : args.config.paymentFactor,
      sequestrationPct: args.config.sequestrationPct,
    })
    out.push({
      ...base,
      paymentRatePerUnit: r.paymentRatePerUnit,
      grossPerAcre: r.grossPerAcre,
      gross: r.gross,
      net: r.net,
      computable: rate != null,
      flat: true,
      drivers: { projected_rate_per_acre: rate },
      notes,
    })
  }
  return out
}

export interface PropertyAllocation {
  propertyId: string
  farmId: string
  commodity: string
  baseAcres: number // allocated share of base acres
  net: number // allocated share of the projected net payment
  allocationPct: number
}

// Allocate projection rows to properties by the farm-property link
// percentages. A farm with no links lands under UNLINKED_FARM.
export const UNLINKED_FARM = '__unlinked__'

export function allocateToProperties(rows: ProjectionRow[], links: FarmPropertyLink[]): PropertyAllocation[] {
  const out: PropertyAllocation[] = []
  for (const r of rows) {
    const farmLinks = links.filter((l) => l.fsa_farm_id === r.farmId)
    if (farmLinks.length === 0) {
      out.push({ propertyId: UNLINKED_FARM, farmId: r.farmId, commodity: r.commodity, baseAcres: r.baseAcres, net: r.net, allocationPct: 100 })
      continue
    }
    for (const l of farmLinks) {
      const pct = Number(l.allocation_pct)
      if (!(pct > 0)) continue
      out.push({
        propertyId: l.property_id,
        farmId: r.farmId,
        commodity: r.commodity,
        baseAcres: Math.round(r.baseAcres * pct) / 100,
        net: Math.round(r.net * pct) / 100,
        allocationPct: pct,
      })
    }
  }
  return out
}

export function sumNet(rows: Array<{ net: number }>): number {
  return Math.round(rows.reduce((s, r) => s + r.net, 0) * 100) / 100
}

// Payment-year framing helpers (the +1 lives in govPayments.ts).
export function paymentYearLabel(programYear: number): string {
  return `${programYear} program year, paid October ${revenueCropYearFor(programYear)}`
}
