// FSA-156EZ scan -> fsa_farms + fsa_base_acres. Called from the documents
// UI after the user CONFIRMS the reviewed extraction (never on raw AI
// output). Upserts by (org, farm number, state, county); base acres rows
// replace the farm's existing rows for the commodities present and leave
// others alone. Manual entry on /gov-payments works without any scan.

import { canonicalCrop } from '@/lib/crops'
import { COMMODITY_SLUGS, type CommoditySlug } from './govPayments'

export interface Fsa156Extraction {
  farm_number: string | number | null
  county?: string | null
  state?: string | null
  tract_numbers?: string | string[] | null
  farmland_acres?: number | string | null
  cropland_acres?: number | string | null
  dcp_cropland_acres?: number | string | null
  base_acres?: Array<{
    commodity: string | null
    base_acres: number | string | null
    plc_yield: number | string | null
  }> | null
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

export interface FsaImportResult {
  farmId: string
  created: boolean
  baseAcresWritten: number
  skippedCommodities: string[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any

export async function createOrUpdateFarmFromExtraction(
  supabase: Client,
  orgId: string,
  extracted: Fsa156Extraction,
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

  if (opts.propertyId) {
    await supabase
      .from('fsa_farm_properties')
      .upsert(
        { organization_id: orgId, fsa_farm_id: farmId, property_id: opts.propertyId, allocation_pct: 100 },
        { onConflict: 'fsa_farm_id,property_id' },
      )
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
  return { farmId, created, baseAcresWritten: rows.length, skippedCommodities: skipped }
}
