// FSA-156EZ scan -> fsa_farms + fsa_base_acres. Called from the documents
// UI after the user CONFIRMS the reviewed extraction (never on raw AI
// output). Upserts by (org, farm number, state, county); base acres rows
// replace the farm's existing rows for the commodities present and leave
// others alone. Manual entry on /gov-payments works without any scan.
//
// A 156EZ PACKET holds several farms (one per page group), and a long
// packet is read in PDF chunks by /api/extract, so the extraction shape
// is { farms: [...] } and chunks are merged by farm number
// (mergeFsaExtractions). The pre-packet single-farm shape (top-level
// farm_number) still reads via normalizeFsaExtraction.

import { canonicalCrop } from '@/lib/crops'
import { COMMODITY_SLUGS, type CommoditySlug } from './govPayments'

export interface FsaBaseAcreEntry {
  commodity: string | null
  base_acres: number | string | null
  plc_yield: number | string | null
}

export interface Fsa156Farm {
  farm_number: string | number | null
  county?: string | null
  state?: string | null
  tract_numbers?: string | string[] | null
  farmland_acres?: number | string | null
  cropland_acres?: number | string | null
  dcp_cropland_acres?: number | string | null
  base_acres?: FsaBaseAcreEntry[] | null
  page_hint?: string | null
}

// Legacy single-farm shape (kept for old stored extractions).
export type Fsa156Extraction = Fsa156Farm

export interface Fsa156PacketExtraction {
  farms: Fsa156Farm[]
  unsure_fields?: string[]
  pages_scanned?: number
  total_pages?: number
}

const SLUG_ALIASES: Record<string, CommoditySlug> = {
  corn: 'corn',
  maize: 'corn',
  soybeans: 'soybeans',
  soybean: 'soybeans',
  beans: 'soybeans',
  wheat: 'wheat',
  'winter wheat': 'wheat',
  'spring wheat': 'wheat',
  'seed cotton': 'seed_cotton',
  'upland cotton': 'seed_cotton',
  cotton: 'seed_cotton',
  'grain sorghum': 'grain_sorghum',
  sorghum: 'grain_sorghum',
  milo: 'grain_sorghum',
  oats: 'oats',
  barley: 'barley',
  peanuts: 'peanuts',
  peanut: 'peanuts',
  canola: 'canola',
  rapeseed: 'canola',
  sesame: 'sesame',
}

// Map a commodity as printed on a 156EZ ("CORN", "Seed Cotton", "Wheat-Winter")
// to a slug; null when it is not a covered commodity we model.
export function commoditySlug(raw: string | null | undefined): CommoditySlug | null {
  const cleaned = (raw ?? '').toLowerCase().replace(/[-_/]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!cleaned) return null
  if ((COMMODITY_SLUGS as string[]).includes(cleaned.replace(/ /g, '_'))) {
    return cleaned.replace(/ /g, '_') as CommoditySlug
  }
  if (SLUG_ALIASES[cleaned]) return SLUG_ALIASES[cleaned]
  const canon = canonicalCrop(cleaned)
  if (canon && SLUG_ALIASES[canon]) return SLUG_ALIASES[canon]
  for (const [alias, slug] of Object.entries(SLUG_ALIASES)) {
    if (cleaned.includes(alias)) return slug
  }
  return null
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

function tracts(v: string | string[] | null | undefined): string[] | null {
  if (!v) return null
  const list = Array.isArray(v) ? v : String(v).split(/[,;\s]+/)
  const out = list.map((t) => String(t).trim()).filter(Boolean)
  return out.length > 0 ? out : null
}

function farmKey(f: Fsa156Farm): string {
  return String(f.farm_number ?? '').trim()
}

// Either shape -> the list of farms (empty farm numbers dropped only
// when another farm exists; a single unnamed farm is kept so the review
// can fix its number).
export function normalizeFsaExtraction(
  extracted: Record<string, unknown> | Fsa156Farm | Fsa156PacketExtraction | null | undefined,
): Fsa156Farm[] {
  if (!extracted || typeof extracted !== 'object') return []
  const e = extracted as Record<string, unknown>
  if (Array.isArray(e.farms)) {
    return (e.farms as unknown[])
      .filter((f) => f && typeof f === 'object')
      .map((f) => ({ ...(f as Fsa156Farm) }))
  }
  if ('farm_number' in e || 'base_acres' in e) return [{ ...(e as unknown as Fsa156Farm) }]
  return []
}

function mergeFarm(a: Fsa156Farm, b: Fsa156Farm): Fsa156Farm {
  const fill = <T,>(x: T | null | undefined, y: T | null | undefined): T | null | undefined =>
    x === null || x === undefined || x === '' ? y : x
  const base = new Map<string, FsaBaseAcreEntry>()
  for (const row of [...(a.base_acres ?? []), ...(b.base_acres ?? [])]) {
    const key = (commoditySlug(row.commodity) ?? String(row.commodity ?? '').toLowerCase().trim()) || `row${base.size}`
    const prev = base.get(key)
    base.set(
      key,
      prev
        ? {
            commodity: prev.commodity ?? row.commodity,
            base_acres: fill(prev.base_acres, row.base_acres) ?? null,
            plc_yield: fill(prev.plc_yield, row.plc_yield) ?? null,
          }
        : { ...row },
    )
  }
  const tractA = tracts(a.tract_numbers) ?? []
  const tractB = tracts(b.tract_numbers) ?? []
  const tractAll = [...new Set([...tractA, ...tractB])]
  return {
    farm_number: fill(a.farm_number, b.farm_number) ?? null,
    county: fill(a.county, b.county) ?? null,
    state: fill(a.state, b.state) ?? null,
    tract_numbers: tractAll.length > 0 ? tractAll.join(', ') : null,
    farmland_acres: fill(a.farmland_acres, b.farmland_acres) ?? null,
    cropland_acres: fill(a.cropland_acres, b.cropland_acres) ?? null,
    dcp_cropland_acres: fill(a.dcp_cropland_acres, b.dcp_cropland_acres) ?? null,
    base_acres: [...base.values()],
    page_hint: [a.page_hint, b.page_hint].filter(Boolean).join('; ') || null,
  }
}

// Merge the per-chunk extractions of one packet: farms with the same
// farm number collapse into one (later chunks fill nulls and add
// commodities), unsure fields union, page counts sum.
export function mergeFsaExtractions(
  chunks: Array<Record<string, unknown> | Fsa156PacketExtraction | null | undefined>,
): Fsa156PacketExtraction {
  const byFarm = new Map<string, Fsa156Farm>()
  const order: string[] = []
  const unsure = new Set<string>()
  let pagesScanned = 0
  let totalPages = 0
  let anon = 0
  for (const chunk of chunks) {
    if (!chunk) continue
    const c = chunk as Record<string, unknown>
    for (const u of Array.isArray(c.unsure_fields) ? (c.unsure_fields as unknown[]) : []) unsure.add(String(u))
    pagesScanned += num(c.pages_scanned) ?? 0
    totalPages = Math.max(totalPages, num(c.total_pages) ?? 0)
    for (const farm of normalizeFsaExtraction(c)) {
      const key = farmKey(farm) || `__anon_${anon++}`
      const prev = byFarm.get(key)
      if (prev) byFarm.set(key, mergeFarm(prev, farm))
      else {
        byFarm.set(key, farm)
        order.push(key)
      }
    }
  }
  const out: Fsa156PacketExtraction = {
    farms: order.map((k) => byFarm.get(k)!),
    unsure_fields: [...unsure],
  }
  if (pagesScanned > 0) out.pages_scanned = pagesScanned
  if (totalPages > 0) out.total_pages = totalPages
  return out
}

export interface FsaImportResult {
  farmNumber: string
  farmId: string
  created: boolean
  baseAcresWritten: number
  skippedCommodities: string[]
  // Names of the properties the farm was linked to (FSA numbers on the
  // property matched the farm number, else the page it came from).
  linkedProperties: string[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any

export async function createOrUpdateFarmFromExtraction(
  supabase: Client,
  orgId: string,
  extracted: Fsa156Farm,
  opts: { sourceDocumentId?: string | null; propertyId?: string | null } = {},
): Promise<FsaImportResult> {
  const farmNumber = String(extracted.farm_number ?? '').trim()
  if (!farmNumber) throw new Error('The 156EZ has no farm number.')
  const state = (extracted.state ?? '').toString().trim().toUpperCase().slice(0, 2) || null
  const county = (extracted.county ?? '').toString().trim() || null

  let query = supabase
    .from('fsa_farms')
    .select('id')
    .eq('organization_id', orgId)
    .eq('farm_number', farmNumber)
  query = state ? query.eq('state', state) : query.is('state', null)
  query = county ? query.eq('county', county) : query.is('county', null)
  const { data: existing } = await query.maybeSingle()

  const farmPatch = {
    organization_id: orgId,
    farm_number: farmNumber,
    state,
    county,
    farmland_acres: num(extracted.farmland_acres),
    cropland_acres: num(extracted.cropland_acres),
    dcp_cropland_acres: num(extracted.dcp_cropland_acres),
    source_document_id: opts.sourceDocumentId ?? null,
  }
  let farmId: string
  let created = false
  if (existing?.id) {
    farmId = existing.id as string
    const { error } = await supabase.from('fsa_farms').update(farmPatch).eq('id', farmId)
    if (error) throw new Error(error.message)
  } else {
    const { data, error } = await supabase.from('fsa_farms').insert(farmPatch).select('id').single()
    if (error || !data) throw new Error(error?.message ?? 'Could not create the FSA farm.')
    farmId = data.id as string
    created = true
  }

  // Link the farm to its land. Properties whose FSA numbers include this
  // farm number win (several properties split the allocation evenly);
  // otherwise the page the 156EZ was uploaded from, if any.
  const linkedProperties: string[] = []
  const { data: props } = await supabase
    .from('properties')
    .select('id, name, fsa_numbers')
    .eq('organization_id', orgId)
  const digits = farmNumber.replace(/\D/g, '')
  const byNumber = ((props ?? []) as Array<{ id: string; name: string; fsa_numbers: string[] | null }>).filter(
    (p) => (p.fsa_numbers ?? []).some((n) => String(n).replace(/\D/g, '') === digits && digits !== ''),
  )
  const targets = byNumber.length > 0
    ? byNumber
    : opts.propertyId
      ? ((props ?? []) as Array<{ id: string; name: string }>).filter((p) => p.id === opts.propertyId)
      : []
  if (targets.length > 0) {
    const share = Math.floor((100 / targets.length) * 100) / 100
    const links = targets.map((p, i) => ({
      organization_id: orgId,
      fsa_farm_id: farmId,
      property_id: p.id,
      allocation_pct: i === targets.length - 1 ? Math.round((100 - share * (targets.length - 1)) * 100) / 100 : share,
    }))
    const { error } = await supabase
      .from('fsa_farm_properties')
      .upsert(links, { onConflict: 'fsa_farm_id,property_id' })
    if (error) throw new Error(error.message)
    linkedProperties.push(...targets.map((p) => p.name))
  }

  const tractList = tracts(extracted.tract_numbers)
  const skipped: string[] = []
  const rows: Array<Record<string, unknown>> = []
  for (const b of extracted.base_acres ?? []) {
    const slug = commoditySlug(b.commodity)
    if (!slug) {
      if (b.commodity) skipped.push(String(b.commodity))
      continue
    }
    rows.push({
      organization_id: orgId,
      fsa_farm_id: farmId,
      commodity: slug,
      base_acres: num(b.base_acres),
      plc_yield: num(b.plc_yield),
      tract_numbers: tractList,
    })
  }
  if (rows.length > 0) {
    const { error } = await supabase
      .from('fsa_base_acres')
      .upsert(rows, { onConflict: 'fsa_farm_id,commodity' })
    if (error) throw new Error(error.message)
  }
  return { farmNumber, farmId, created, baseAcresWritten: rows.length, skippedCommodities: skipped, linkedProperties }
}

// Every farm in a reviewed packet (either shape). Farms without a
// number are reported as failures, never silently skipped.
export async function createOrUpdateFarmsFromExtraction(
  supabase: Client,
  orgId: string,
  extracted: Record<string, unknown> | Fsa156Farm | Fsa156PacketExtraction,
  opts: { sourceDocumentId?: string | null; propertyId?: string | null } = {},
): Promise<{ results: FsaImportResult[]; failures: Array<{ farmNumber: string; error: string }> }> {
  const results: FsaImportResult[] = []
  const failures: Array<{ farmNumber: string; error: string }> = []
  for (const farm of normalizeFsaExtraction(extracted)) {
    const farmNumber = farmKey(farm) || '(no number)'
    try {
      results.push(await createOrUpdateFarmFromExtraction(supabase, orgId, farm, opts))
    } catch (e) {
      failures.push({ farmNumber, error: e instanceof Error ? e.message : 'unknown error' })
    }
  }
  return { results, failures }
}
