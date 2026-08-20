import { normalizeStumpageRate, type StumpageRate } from "./leaseLogic";
import {
  CLUSTER_THRESHOLD,
  normalizeOwnerName,
  ownerSimilarity,
} from "./ownerNames";

// Deterministic suggestion helpers for the timber uploads. Suggestions
// only: the user always confirms (standing convention).

export interface MatchableStand {
  id: string;
  name: string;
  acres: number | null;
  propertyName?: string | null;
}

// Words too generic to link a tract description to a stand by name.
const GENERIC_TOKENS = new Set([
  "stand", "tract", "the", "of", "and", "on", "in", "at", "a", "an",
  "acres", "acre", "county", "farm", "road", "rd", "cr", "hwy",
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0 && !GENERIC_TOKENS.has(t));
}

// Match the contract's tract/stand description against the property's
// stands: a stand whose name (or property name) shares a distinctive
// word or number with the description is suggested. With no name
// evidence at all, a single stand whose acres sit within 15% of the
// contract acres is suggested on acreage alone.
export function suggestStandIds(
  tractDescription: string | null | undefined,
  saleAcres: number | null | undefined,
  stands: MatchableStand[]
): string[] {
  const suggested = new Set<string>();
  const tract = (tractDescription ?? "").toLowerCase();
  if (tract.trim()) {
    for (const stand of stands) {
      const candidates = [
        ...tokens(stand.name),
        ...(stand.propertyName ? tokens(stand.propertyName) : []),
      ];
      const hit = candidates.some((t) =>
        new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(tract)
      );
      if (hit) suggested.add(stand.id);
    }
  }
  if (suggested.size === 0 && saleAcres && saleAcres > 0) {
    const byAcres = stands.filter(
      (s) =>
        s.acres !== null &&
        s.acres > 0 &&
        Math.abs(s.acres - saleAcres) / saleAcres <= 0.15
    );
    if (byAcres.length === 1) suggested.add(byAcres[0].id);
  }
  return Array.from(suggested);
}

export interface MatchableSale {
  id: string;
  sale_name: string;
  buyer_name: string | null;
  sale_type: string;
  status?: string | null;
  stumpage_rates?: unknown;
}

// Which sale does an unmatched settlement belong to? Buyer name
// similarity (the same normalizer the rent upload uses) plus product
// overlap with the contract's rates. Active pay-as-cut sales rank
// first; null when nothing scores at all.
export function suggestSaleId(
  payerName: string | null | undefined,
  productSlugs: string[],
  sales: MatchableSale[]
): string | null {
  const payer = payerName
    ? normalizeOwnerName(payerName).normalized
    : null;
  let best: { id: string; score: number } | null = null;
  for (const sale of sales) {
    let score = 0;
    if (payer && sale.buyer_name) {
      const sim = ownerSimilarity(
        payer,
        normalizeOwnerName(sale.buyer_name).normalized
      );
      if (sim >= CLUSTER_THRESHOLD) score += 2 * sim;
    }
    const rates: StumpageRate[] = Array.isArray(sale.stumpage_rates)
      ? (sale.stumpage_rates as Array<Record<string, unknown>>).map((r) =>
          normalizeStumpageRate(r as Partial<StumpageRate>)
        )
      : [];
    if (productSlugs.length > 0 && rates.length > 0) {
      const overlap = productSlugs.filter((p) =>
        rates.some((r) => r.product === p)
      ).length;
      score += overlap / productSlugs.length;
    }
    if (sale.sale_type === "pay_as_cut") score += 0.25;
    if (sale.status === "active") score += 0.25;
    // A sale with zero evidence beyond type/status never suggests.
    const hasEvidence =
      score > 0.5 ||
      (payer !== null && score > 0.5) ||
      productSlugs.some((p) => rates.some((r) => r.product === p));
    if (!hasEvidence) continue;
    if (!best || score > best.score) best = { id: sale.id, score };
  }
  return best?.id ?? null;
}
