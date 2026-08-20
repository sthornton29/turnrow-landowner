// Server-side NASS Quick Stats helpers shared by the gov routes (route
// files may only export handlers). HTTP, params, and the 24 h in-process
// promise cache per docs/GOV_PAYMENTS_PATHWAYS.md section 1.1.

import {
  COTTONSEED_SERIES,
  LINT_SERIES,
  blendSeedCottonMonthly,
  elapsedMarketingMonths,
  extractAnnualPrice,
  extractMonthlyPrices,
  nassSeriesFor,
  toLookupResult,
  type MyaMonthlyLookupResult,
  type NassRow,
  type NassSeriesSpec,
} from "./nassQuickStats";

const NASS_URL = "https://quickstats.nass.usda.gov/api/api_GET/";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type CacheEntry = { expires: number; promise: Promise<NassRow[]> };
const cache = new Map<string, CacheEntry>();

export class NassError extends Error {}

export async function fetchNassRows(apiKey: string, params: Record<string, string>): Promise<NassRow[]> {
  const cacheKey = JSON.stringify(params);
  const now = Date.now();
  const hit = cache.get(cacheKey);
  if (hit && hit.expires > now) return hit.promise;
  const promise = (async () => {
    const qs = new URLSearchParams({ key: apiKey, format: "JSON", ...params });
    let resp: Response;
    try {
      resp = await fetch(`${NASS_URL}?${qs}`, { cache: "no-store" });
    } catch (e) {
      throw new NassError(`Could not reach the NASS Quick Stats API (${(e as Error)?.message ?? "network error"}).`);
    }
    if (resp.status === 401 || resp.status === 403) {
      throw new NassError("The NASS Quick Stats API rejected the key; check NASS_API_KEY.");
    }
    if (resp.status === 429) {
      throw new NassError("The NASS Quick Stats API rate limit was hit; try again in a few minutes.");
    }
    const json = await resp.json().catch(() => null);
    // A parameter combination with NO DATA comes back as "bad request -
    // invalid query": a valid empty result, not a failure.
    if (json && typeof json === "object" && "error" in json) {
      const msg = String((json as { error: unknown }).error);
      if (/no data|invalid query/i.test(msg)) return [];
      throw new NassError(`NASS Quick Stats: ${msg}`);
    }
    if (!resp.ok) throw new NassError(`NASS Quick Stats returned HTTP ${resp.status}.`);
    const data = (json as { data?: unknown } | null)?.data;
    return Array.isArray(data) ? (data as NassRow[]) : [];
  })();
  cache.set(cacheKey, { expires: now + CACHE_TTL_MS, promise });
  promise.catch(() => {
    if (cache.get(cacheKey)?.promise === promise) cache.delete(cacheKey);
  });
  return promise;
}

export function monthlyParams(series: NassSeriesSpec, marketingYear: number): Record<string, string> {
  return {
    ...series.params,
    source_desc: "SURVEY",
    statisticcat_desc: "PRICE RECEIVED",
    freq_desc: "MONTHLY",
    agg_level_desc: "NATIONAL",
    year__GE: String(marketingYear),
    year__LE: String(marketingYear + 1),
  };
}

export interface CommodityRow {
  slug: string;
  name: string;
  unit: "bushel" | "pound";
  marketing_year_start_month: number;
  lint_share: number | string | null;
  cottonseed_share: number | string | null;
}

// Shared with the mya-estimate route.
export async function lookupMonthly(
  apiKey: string,
  commodity: CommodityRow,
  marketingYear: number
): Promise<MyaMonthlyLookupResult> {
  const startMonth = Number(commodity.marketing_year_start_month);
  const elapsed = elapsedMarketingMonths(startMonth, marketingYear, new Date());
  const today = new Date().toISOString().slice(0, 10);
  if (elapsed.length === 0) {
    return { monthly_prices: [], source_description: `The ${marketingYear} marketing year has not started yet.`, confidence: "high" };
  }
  if (commodity.slug === "seed_cotton") {
    const [lintRows, seedRows] = await Promise.all([
      fetchNassRows(apiKey, monthlyParams(LINT_SERIES, marketingYear)),
      fetchNassRows(apiKey, monthlyParams(COTTONSEED_SERIES, marketingYear)),
    ]);
    const lint = extractMonthlyPrices(lintRows, LINT_SERIES, startMonth, marketingYear);
    const seed = extractMonthlyPrices(seedRows, COTTONSEED_SERIES, startMonth, marketingYear);
    let priorYearSeedAnnual: number | null = null;
    if (seed.prices.length === 0 && lint.prices.length > 0) {
      const annualRows = await fetchNassRows(apiKey, {
        ...COTTONSEED_SERIES.params,
        source_desc: "SURVEY",
        statisticcat_desc: "PRICE RECEIVED",
        freq_desc: "ANNUAL",
        agg_level_desc: "NATIONAL",
        year: String(marketingYear - 1),
      });
      priorYearSeedAnnual = extractAnnualPrice(annualRows, "dollars_per_ton");
    }
    const monthly = blendSeedCottonMonthly({
      lint: lint.prices,
      seed: seed.prices,
      elapsed,
      lintShare: commodity.lint_share == null ? null : Number(commodity.lint_share),
      seedShare: commodity.cottonseed_share == null ? null : Number(commodity.cottonseed_share),
      priorYearSeedAnnual,
    });
    return {
      monthly_prices: monthly,
      source_description: `USDA NASS Quick Stats (Agricultural Prices), retrieved ${today}. Seed cotton blended in-app from upland lint and cottonseed. Recent months may be preliminary.`,
      confidence: "high",
    };
  }
  const series = nassSeriesFor(commodity.name, commodity.unit);
  const rows = await fetchNassRows(apiKey, monthlyParams(series, marketingYear));
  const extracted = extractMonthlyPrices(rows, series, startMonth, marketingYear);
  return toLookupResult({
    prices: extracted.prices,
    elapsed,
    startMonth,
    marketingYear,
    sourceDescription: `USDA NASS Quick Stats (Agricultural Prices)${extracted.seriesUsed ? `, series "${extracted.seriesUsed}"` : ""}, retrieved ${today}. Recent months may be preliminary.`,
  });
}

