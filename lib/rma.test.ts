import { describe, expect, it } from "vitest";
import {
  RmaParseError,
  convertRmaPrice,
  offerToCache,
  parseRmaRevenuePrices,
  pickPrimaryRow,
  resolveBenchmark,
  rmaCacheIsStale,
  rmaServiceUrl,
  windowState,
} from "./rma";

// Fixture mirroring the live feed shape (Alabama corn 2026, verified
// 2026-08-17): note the extended property names that must not shadow
// the short ones, and the self-closed null property.
const entryXml = (practice: string, typeName: string, projected: string) => `
  <m:properties>
    <d:CommodityYear m:type="Edm.Int32">2026</d:CommodityYear>
    <d:CommodityName>Corn</d:CommodityName>
    <d:TypeName>${typeName}</d:TypeName>
    <d:PracticeName>${practice}</d:PracticeName>
    <d:ActuarialDate m:type="Edm.DateTime">2026-02-28T00:00:00</d:ActuarialDate>
    <d:ProjectedPrice m:type="Edm.Decimal">${projected}</d:ProjectedPrice>
    <d:ProjectedPriceStatus>Released</d:ProjectedPriceStatus>
    <d:ProjectedPriceBeginDate m:type="Edm.DateTime">2026-01-15T00:00:00</d:ProjectedPriceBeginDate>
    <d:ProjectedPriceEndDate m:type="Edm.DateTime">2026-02-14T00:00:00</d:ProjectedPriceEndDate>
    <d:ProjectedPriceMarketSymbolCode>ZCU26</d:ProjectedPriceMarketSymbolCode>
    <d:ProjectedPricePreviousMarketSymbolCode m:null="true" />
    <d:HarvestPrice m:type="Edm.Decimal">4.4500</d:HarvestPrice>
    <d:HarvestPriceStatus>In Discovery</d:HarvestPriceStatus>
    <d:HarvestPriceBeginDate m:type="Edm.DateTime">2026-08-01T00:00:00</d:HarvestPriceBeginDate>
    <d:HarvestPriceEndDate m:type="Edm.DateTime">2026-08-31T00:00:00</d:HarvestPriceEndDate>
    <d:HarvestPriceMarketSymbolCode>ZCU26</d:HarvestPriceMarketSymbolCode>
    <d:ApprovedPriceVolatilityPercent m:type="Edm.Decimal">0.1400</d:ApprovedPriceVolatilityPercent>
  </m:properties>`;

const feedXml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>${entryXml("Conventional", "All (Non-High Amylose)", "4.4200")}</entry>
  <entry>${entryXml("Organic", "All (Non-High Amylose)", "5.9000")}</entry>
</feed>`;

describe("parseRmaRevenuePrices", () => {
  it("parses entries with extended-name properties present", () => {
    const offers = parseRmaRevenuePrices(feedXml);
    expect(offers).toHaveLength(2);
    expect(offers[0].projectedPrice).toBe(4.42); // not shadowed by BeginDate
    expect(offers[0].projectedStatus).toBe("Released");
    expect(offers[0].harvestPrice).toBe(4.45);
    expect(offers[0].harvestStatus).toBe("In Discovery");
    expect(offers[0].projectedSymbol).toBe("ZCU26");
    expect(offers[0].volatility).toBe(0.14);
  });

  it("treats self-closed null properties as null", () => {
    const nullPrice = feedXml.replace(
      /<d:HarvestPrice m:type="Edm.Decimal">4.4500<\/d:HarvestPrice>/g,
      '<d:HarvestPrice m:null="true" />'
    );
    const offers = parseRmaRevenuePrices(nullPrice);
    expect(offers[0].harvestPrice).toBeNull();
  });

  it("throws loudly on non-feed responses and missing keys", () => {
    expect(() => parseRmaRevenuePrices("<html>maintenance</html>")).toThrow(
      RmaParseError
    );
    const missing = feedXml.replace(/<d:ProjectedPriceStatus>Released<\/d:ProjectedPriceStatus>/g, "");
    expect(() => parseRmaRevenuePrices(missing)).toThrow("ProjectedPriceStatus");
  });
});

describe("pickPrimaryRow", () => {
  it("prefers the Conventional practice", () => {
    const offers = parseRmaRevenuePrices(feedXml);
    expect(pickPrimaryRow(offers, "corn")?.practiceName).toBe("Conventional");
  });

  it("prefers winter types for wheat", () => {
    const offers = parseRmaRevenuePrices(feedXml).map((o, i) => ({
      ...o,
      typeName: i === 0 ? "All Wheat" : "Winter Wheat",
      practiceName: "Conventional",
    }));
    expect(pickPrimaryRow(offers, "wheat")?.typeName).toBe("Winter Wheat");
  });

  it("returns null for zero offers (no_offer is data)", () => {
    expect(pickPrimaryRow([], "corn")).toBeNull();
  });
});

describe("convertRmaPrice (the single unit boundary)", () => {
  it("converts canola from $/lb to $/bu once", () => {
    expect(convertRmaPrice("canola", 0.226)).toBe(11.3);
  });
  it("keeps cotton and grains native", () => {
    expect(convertRmaPrice("cotton", 0.68)).toBe(0.68);
    expect(convertRmaPrice("corn", 4.42)).toBe(4.42);
  });
  it("passes null through", () => {
    expect(convertRmaPrice("canola", null)).toBeNull();
  });
});

describe("windowState", () => {
  it("labels a mid-discovery running average with day N of M", () => {
    expect(
      windowState(
        "In Discovery",
        "2026-08-01T00:00:00",
        "2026-08-31T00:00:00",
        new Date("2026-08-17T12:00:00")
      )
    ).toBe("in discovery, day 17 of 31");
  });
  it("statuses are authoritative", () => {
    expect(windowState("Released", null, null, new Date())).toBe("released");
    expect(windowState("Yet To Start", null, null, new Date())).toBe("yet to start");
  });
});

describe("rmaCacheIsStale", () => {
  const cache = (harvestStatus: string) =>
    offerToCache(
      { ...parseRmaRevenuePrices(feedXml)[0], harvestStatus },
      "corn"
    );
  const hours = (n: number) =>
    new Date(Date.now() - n * 60 * 60 * 1000).toISOString();

  it("refreshes daily while any window is active", () => {
    expect(rmaCacheIsStale(cache("In Discovery"), hours(25), new Date())).toBe(true);
    expect(rmaCacheIsStale(cache("In Discovery"), hours(23), new Date())).toBe(false);
    expect(rmaCacheIsStale(cache("Yet To Start"), hours(25), new Date())).toBe(true);
  });

  it("refreshes weekly when everything is released", () => {
    expect(rmaCacheIsStale(cache("Released"), hours(6 * 24), new Date())).toBe(false);
    expect(rmaCacheIsStale(cache("Released"), hours(8 * 24), new Date())).toBe(true);
  });
});

describe("resolveBenchmark", () => {
  const offers = parseRmaRevenuePrices(feedXml);
  const data = offerToCache(offers[0], "corn");

  it("averages projected and harvest with a moving-average note", () => {
    const resolved = resolveBenchmark(data, "average");
    expect(resolved.result).toBeCloseTo(4.435, 4);
    expect(resolved.note).toContain("running average");
  });

  it("falls back to projected alone when harvest has not started", () => {
    const pending = {
      ...data,
      harvest: { ...data.harvest!, price: null, status: "Yet To Start" },
    };
    const resolved = resolveBenchmark(pending, "average");
    expect(resolved.result).toBe(4.42);
    expect(resolved.note).toContain("projected price alone");
  });

  it("handles no_offer as data", () => {
    const resolved = resolveBenchmark(offerToCache(null, "corn"), "projected");
    expect(resolved.result).toBeNull();
    expect(resolved.note).toContain("no offer");
  });
});

describe("rmaServiceUrl", () => {
  it("keys by year, 4-digit code, and state FIPS", () => {
    const url = rmaServiceUrl(2026, "corn", "AL");
    expect(url).toContain("CommodityYear%20eq%202026");
    expect(url).toContain("'0041'");
    expect(url).toContain("StateCode%20eq%20'01'");
  });
});
