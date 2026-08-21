import { describe, expect, it } from "vitest";
import { STATE_FIPS_TO_ABBR, countyMatches, normalizeCountyName } from "./countyLookup";

describe("county gate normalization", () => {
  it("strips the county word, punctuation, and case", () => {
    expect(normalizeCountyName("Lawrence County")).toBe("lawrence");
    expect(normalizeCountyName("St. Clair")).toBe("stclair");
    expect(normalizeCountyName("DeKalb County, Alabama")).toBe("dekalbalabama");
    expect(normalizeCountyName("East Baton Rouge Parish")).toBe("eastbatonrouge");
  });

  it("matches the same county written differently", () => {
    expect(countyMatches("Lawrence County", "Lawrence")).toBe(true);
    expect(countyMatches("st clair", "St. Clair County")).toBe(true);
  });

  it("flags a different county", () => {
    expect(countyMatches("Lawrence", "Baldwin")).toBe(false);
    expect(countyMatches("Lawrence County", "Houston County")).toBe(false);
  });

  it("has no opinion when either side is unknown", () => {
    expect(countyMatches(null, "Lawrence")).toBe(true);
    expect(countyMatches("Lawrence", "")).toBe(true);
  });

  it("maps the FIPS codes TIGERweb returns", () => {
    expect(STATE_FIPS_TO_ABBR["01"]).toBe("AL");
    expect(STATE_FIPS_TO_ABBR["28"]).toBe("MS");
  });
});
