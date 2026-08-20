// MYA (marketing-year average) estimation, ported from the Turnrow farm
// app's lib/mya-estimate.ts per docs/GOV_PAYMENTS_PATHWAYS.md. The MYA is
// the national average farm cash price weighted by monthly marketings
// across the marketing year; a single day's quote is not an MYA. The
// landowner app has no futures feed, so the estimate is the weighted
// average of the PUBLISHED months only (the doc's untraded-commodity
// path): missing months drop out and their weight is redistributed.
// Pure functions; the /api/gov/mya-estimate route passes data in.

// Default monthly marketing weights, aligned to the MARKETING YEAR's month
// order (index 0 = the marketing year's first month). The engine
// normalizes, so only the shape matters. Overridable per commodity via
// covered_commodities.mya_month_weights.
const CORN_WEIGHTS = [0.06, 0.115, 0.11, 0.1, 0.115, 0.085, 0.08, 0.075, 0.07, 0.07, 0.065, 0.055] // Sep..Aug
const SOY_WEIGHTS = [0.08, 0.16, 0.14, 0.1, 0.11, 0.08, 0.07, 0.06, 0.05, 0.05, 0.05, 0.05] // Sep..Aug
const WHEAT_WEIGHTS = [0.14, 0.15, 0.13, 0.1, 0.08, 0.07, 0.06, 0.06, 0.055, 0.055, 0.05, 0.05] // Jun..May
const UNIFORM_WEIGHTS = Array.from({ length: 12 }, () => 1 / 12)

export function defaultMonthWeights(commodityName: string | null | undefined): number[] {
  const s = (commodityName ?? '').trim().toLowerCase().replace(/_/g, ' ')
  if (s === 'corn') return [...CORN_WEIGHTS]
  if (s === 'soybeans') return [...SOY_WEIGHTS]
  if (s === 'wheat') return [...WHEAT_WEIGHTS]
  return [...UNIFORM_WEIGHTS]
}

export type MarketingMonth = { month: number; year: number } // calendar month/year

// The 12 calendar months of a marketing year. cropYear is the year the
// marketing year STARTS in (2026 corn = Sep 2026 - Aug 2027).
export function marketingYearMonths(startMonth: number, cropYear: number): MarketingMonth[] {
  return Array.from({ length: 12 }, (_, i) => {
    const m0 = startMonth - 1 + i
    return { month: (m0 % 12) + 1, year: cropYear + Math.floor(m0 / 12) }
  })
}

export type MyaMonthComposition = {
  month: number // calendar month
  year: number
  weight: number // normalized over months with a price (0 when missing)
  price: number | null
  source: 'published' | 'missing'
}

export type MyaBlendResult = {
  estimate: number | null // sum(month price x normalized weight); null when no month has a price
  months: MyaMonthComposition[]
  publishedCount: number
  missingCount: number
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4
}

// The month-by-month MYA blend over published months only.
export function estimateMyaBlend(args: {
  commodityName: string
  marketingYearStartMonth: number
  cropYear: number
  // Published monthly prices keyed by CALENDAR month (each calendar month
  // appears exactly once in a marketing year).
  monthlyPrices: ReadonlyArray<{ month: number; price: number }>
  weights?: readonly number[] | null // 12 weights in marketing-year order; default per commodity
}): MyaBlendResult {
  const rawWeights =
    args.weights && args.weights.length === 12 && args.weights.some((w) => w > 0)
      ? [...args.weights]
      : defaultMonthWeights(args.commodityName)
  const publishedByMonth = new Map(args.monthlyPrices.map((p) => [p.month, Number(p.price)]))

  const months: MyaMonthComposition[] = marketingYearMonths(args.marketingYearStartMonth, args.cropYear).map(
    (m, i) => {
      const published = publishedByMonth.get(m.month)
      if (published != null && Number.isFinite(published)) {
        return { ...m, weight: rawWeights[i], price: published, source: 'published' as const }
      }
      return { ...m, weight: rawWeights[i], price: null, source: 'missing' as const }
    },
  )

  const totalW = months.reduce((s, m) => s + (m.price != null ? m.weight : 0), 0)
  let estimate: number | null = null
  if (totalW > 0) {
    estimate = round4(months.reduce((s, m) => s + (m.price != null ? m.price * (m.weight / totalW) : 0), 0))
  }
  const normalized = months.map((m) => ({
    ...m,
    weight: m.price != null && totalW > 0 ? round4(m.weight / totalW) : 0,
  }))

  return {
    estimate,
    months: normalized,
    publishedCount: normalized.filter((m) => m.source === 'published').length,
    missingCount: normalized.filter((m) => m.source === 'missing').length,
  }
}

// One-line composition summary, e.g. "7 of 12 months USDA-published; 5 not yet published".
export function describeMyaComposition(r: MyaBlendResult): string {
  if (r.publishedCount === 12) return 'All 12 months USDA-published'
  const parts: string[] = [`${r.publishedCount} of 12 months USDA-published`]
  if (r.missingCount > 0) parts.push(`${r.missingCount} not yet published`)
  return parts.join('; ')
}
