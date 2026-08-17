// RMA Price Discovery client (pure parts) for benchmark lease pricing,
// implemented per grain-tracker/docs/RMA_PRICING.md and live-verified
// 2026-08-17 against the .svc feed (Alabama corn 2026: projected $4.42
// Released in the Jan 15 - Feb 14 window, harvest In Discovery Aug 1-31
// against ZCU26 - the September contract, exactly as the doc warns
// against assuming the Midwest DEC benchmark). Public CC0 data, no
// credentials. Fetching/caching lives in /api/rma-price; everything
// here is pure and unit-tested in rma.test.ts.
//
// Fallback if the .svc endpoint ever churns: RMA's ADM (actuarial data
// master) Price dataset - pipe-delimited files with the same fields.
// Same parse-loudly + write-then-swap treatment; only transport differs.

export class RmaParseError extends Error {}

// 4-digit RMA commodity codes for the crops the app maps (same set the
// farm software uses).
export const RMA_COMMODITY_CODES: Record<string, string> = {
  corn: "0041",
  soybeans: "0081",
  wheat: "0011",
  cotton: "0021",
  canola: "0015",
};

export const STATE_FIPS: Record<string, string> = {
  AL: "01", AZ: "04", AR: "05", CA: "06", CO: "08", CT: "09", DE: "10",
  FL: "12", GA: "13", ID: "16", IL: "17", IN: "18", IA: "19", KS: "20",
  KY: "21", LA: "22", ME: "23", MD: "24", MA: "25", MI: "26", MN: "27",
  MS: "28", MO: "29", MT: "30", NE: "31", NV: "32", NH: "33", NJ: "34",
  NM: "35", NY: "36", NC: "37", ND: "38", OH: "39", OK: "40", OR: "41",
  PA: "42", RI: "44", SC: "45", SD: "46", TN: "47", TX: "48", UT: "49",
  VT: "50", VA: "51", WA: "53", WV: "54", WI: "55", WY: "56",
};

export function rmaServiceUrl(year: number, cropKey: string, stateAbbr: string): string {
  const code = RMA_COMMODITY_CODES[cropKey.toLowerCase()];
  const fips = STATE_FIPS[stateAbbr.toUpperCase()];
  if (!code) throw new RmaParseError(`No RMA commodity code for crop "${cropKey}".`);
  if (!fips) throw new RmaParseError(`Unknown state "${stateAbbr}".`);
  const filter = `CommodityYear eq ${year} and CommodityCode eq '${code}' and StateCode eq '${fips}'`;
  return (
    "https://public-rma.fpac.usda.gov/apps/PriceDiscovery/Services/" +
    "RevenuePriceDataService.svc/RevenuePrices?$filter=" +
    encodeURIComponent(filter)
  );
}

export interface RmaOffer {
  typeName: string;
  practiceName: string;
  actuarialDate: string | null;
  projectedPrice: number | null;
  projectedStatus: string;
  projectedBegin: string | null;
  projectedEnd: string | null;
  projectedSymbol: string | null;
  harvestPrice: number | null;
  harvestStatus: string;
  harvestBegin: string | null;
  harvestEnd: string | null;
  harvestSymbol: string | null;
  volatility: number | null;
}

// Extract one property from an entry. The name boundary lookahead
// matters: ProjectedPriceBeginDate extends ProjectedPrice and would
// otherwise shadow it. Null-valued OData properties arrive self-closed:
// treat as null, never zero.
function prop(entry: string, name: string): string | null {
  const re = new RegExp(
    `<d:${name}(?=[ />])[^>]*?(?:/>|>([^<]*)</d:${name}>)`
  );
  const match = entry.match(re);
  if (!match) {
    throw new RmaParseError(
      `RMA feed is missing "${name}"; the service layout may have changed.`
    );
  }
  return match[1] === undefined || match[1] === "" ? null : match[1];
}

function numProp(entry: string, name: string): number | null {
  const raw = prop(entry, name);
  if (raw === null) return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new RmaParseError(`RMA "${name}" is not numeric: "${raw}".`);
  }
  return value;
}

// Parse the Atom feed defensively: verify it IS a feed, and throw loud,
// specific errors on shape changes so a layout change can never become
// a silently wrong number.
export function parseRmaRevenuePrices(xml: string): RmaOffer[] {
  if (!/<feed[\s>]/.test(xml)) {
    throw new RmaParseError("RMA response is not an Atom feed.");
  }
  const entries = xml.split(/<entry[\s>]/).slice(1);
  return entries.map((entry) => ({
    typeName: prop(entry, "TypeName") ?? "",
    practiceName: prop(entry, "PracticeName") ?? "",
    actuarialDate: prop(entry, "ActuarialDate"),
    projectedPrice: numProp(entry, "ProjectedPrice"),
    projectedStatus: prop(entry, "ProjectedPriceStatus") ?? "",
    projectedBegin: prop(entry, "ProjectedPriceBeginDate"),
    projectedEnd: prop(entry, "ProjectedPriceEndDate"),
    projectedSymbol: prop(entry, "ProjectedPriceMarketSymbolCode"),
    harvestPrice: numProp(entry, "HarvestPrice"),
    harvestStatus: prop(entry, "HarvestPriceStatus") ?? "",
    harvestBegin: prop(entry, "HarvestPriceBeginDate"),
    harvestEnd: prop(entry, "HarvestPriceEndDate"),
    harvestSymbol: prop(entry, "HarvestPriceMarketSymbolCode"),
    volatility: numProp(entry, "ApprovedPriceVolatilityPercent"),
  }));
}

// Preferred type per crop: spring-harvested crops insure the
// fall-planted winter types in the Southeast.
function rmaPreferredType(cropKey: string): string | null {
  if (cropKey.toLowerCase() === "wheat") return "winter";
  return null;
}

// A state lists many offers per commodity; pick the standard reference:
// Conventional practice first, the crop's preferred type when one
// applies (else the catch-all "All ..." type), then earliest actuarial
// date. (This feed carries no SalesClosingDate property; actuarial date
// is the closest stable tiebreak, then feed order.)
export function pickPrimaryRow(offers: RmaOffer[], cropKey: string): RmaOffer | null {
  if (offers.length === 0) return null;
  const preferred = rmaPreferredType(cropKey);
  const score = (offer: RmaOffer): number => {
    let s = 0;
    if (/conventional/i.test(offer.practiceName)) s += 100;
    if (preferred && offer.typeName.toLowerCase().includes(preferred)) s += 50;
    else if (/^all\b/i.test(offer.typeName)) s += 25;
    return s;
  };
  return [...offers].sort((a, b) => {
    const diff = score(b) - score(a);
    if (diff !== 0) return diff;
    return (a.actuarialDate ?? "9999").localeCompare(b.actuarialDate ?? "9999");
  })[0];
}

// The single unit-conversion boundary: convert once at fetch time, use
// app-native units everywhere downstream. Canola: RMA quotes $/lb ->
// x50 -> $/bu (50 lb/bu). Cotton: $/lb kept native. Grains: $/bu native.
export function convertRmaPrice(cropKey: string, price: number | null): number | null {
  if (price === null) return null;
  if (cropKey.toLowerCase() === "canola") {
    return Math.round(price * 50 * 10000) / 10000;
  }
  return price;
}

export function rmaUnitLabel(cropKey: string): string {
  return cropKey.toLowerCase() === "cotton" ? "$/lb" : "$/bu";
}

// Human window label: the STATUS is authoritative (RMA sets it; dates
// only decorate). In Discovery carries the day-N-of-M running-average
// framing so the number is never mistaken for final.
export function windowState(
  status: string,
  begin: string | null,
  end: string | null,
  today: Date
): string {
  if (status === "Released") return "released";
  if (status === "Yet To Start") return "yet to start";
  if (status === "In Discovery" && begin && end) {
    const start = new Date(begin);
    const finish = new Date(end);
    const msPerDay = 24 * 60 * 60 * 1000;
    const total = Math.max(1, Math.round((finish.getTime() - start.getTime()) / msPerDay) + 1);
    const day = Math.min(
      total,
      Math.max(1, Math.floor((today.getTime() - start.getTime()) / msPerDay) + 1)
    );
    return `in discovery, day ${day} of ${total}`;
  }
  return status.toLowerCase() || "unknown";
}

// The cached shape stored in rma_price_cache.data. no_offer is data
// (RMA lists nothing for that crop x state), distinct from fetch
// failure, which never overwrites this.
export interface RmaCachedData {
  no_offer: boolean;
  projected: { price: number | null; status: string; begin: string | null; end: string | null; symbol: string | null } | null;
  harvest: { price: number | null; status: string; begin: string | null; end: string | null; symbol: string | null } | null;
  volatility: number | null;
  unit_label: string;
}

export function offerToCache(offer: RmaOffer | null, cropKey: string): RmaCachedData {
  if (!offer) {
    return { no_offer: true, projected: null, harvest: null, volatility: null, unit_label: rmaUnitLabel(cropKey) };
  }
  return {
    no_offer: false,
    projected: {
      price: convertRmaPrice(cropKey, offer.projectedPrice),
      status: offer.projectedStatus,
      begin: offer.projectedBegin,
      end: offer.projectedEnd,
      symbol: offer.projectedSymbol,
    },
    harvest: {
      price: convertRmaPrice(cropKey, offer.harvestPrice),
      status: offer.harvestStatus,
      begin: offer.harvestBegin,
      end: offer.harvestEnd,
      symbol: offer.harvestSymbol,
    },
    volatility: offer.volatility,
    unit_label: rmaUnitLabel(cropKey),
  };
}

// Staleness: any window In Discovery or Yet To Start refreshes daily
// (pending windows too, so the flip to in-discovery is seen promptly);
// everything Released/idle weekly (released values are immutable facts).
export function rmaCacheIsStale(
  data: RmaCachedData,
  fetchedAt: string,
  now: Date
): boolean {
  const ageMs = now.getTime() - new Date(fetchedAt).getTime();
  const day = 24 * 60 * 60 * 1000;
  const active =
    !data.no_offer &&
    [data.projected?.status, data.harvest?.status].some(
      (s) => s === "In Discovery" || s === "Yet To Start"
    );
  return ageMs > (active ? day : 7 * day);
}

// Resolve the lease's benchmark formula against the cached offer.
export type RmaFormula = "projected" | "harvest" | "average";

export interface ResolvedBenchmark {
  result: number | null;
  note: string | null; // honest label when the result is partial or moving
}

export function resolveBenchmark(
  data: RmaCachedData,
  formula: RmaFormula
): ResolvedBenchmark {
  if (data.no_offer) return { result: null, note: "RMA lists no offer for this crop and state." };
  const projected = data.projected?.price ?? null;
  const harvest = data.harvest?.price ?? null;
  const harvestMoving = data.harvest?.status === "In Discovery";
  switch (formula) {
    case "projected":
      return projected !== null
        ? { result: projected, note: null }
        : { result: null, note: "The projected price has not been set yet." };
    case "harvest":
      return harvest !== null
        ? {
            result: harvest,
            note: harvestMoving
              ? "Running average; this number will move until discovery ends."
              : null,
          }
        : { result: null, note: "The harvest price has not started discovery yet." };
    case "average": {
      if (projected !== null && harvest !== null) {
        return {
          result: Math.round(((projected + harvest) / 2) * 10000) / 10000,
          note: harvestMoving
            ? "Harvest side is a running average; the result will move until discovery ends."
            : null,
        };
      }
      if (projected !== null) {
        return {
          result: projected,
          note: "Harvest discovery has not started; using the projected price alone for now.",
        };
      }
      return { result: null, note: "Neither price has been set yet." };
    }
  }
}
