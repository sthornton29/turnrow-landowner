import { describe, expect, it } from "vitest";
import {
  buildPlssWhere,
  cacheKey,
  meridianCode,
  meridiansForState,
  normalizePlssFeature,
  parsePlssId,
  plssIdPattern,
} from "./plss";

const t4s8w = {
  state: "al",
  township: { num: 4, dir: "S" as const },
  range: { num: 8, dir: "W" as const },
  section: 12,
};

describe("PLSS where builder", () => {
  it("pads township and range to three digits and wildcards frac/dup", () => {
    expect(plssIdPattern({ ...t4s8w, meridian: "HU" })).toBe("AL16004_S008_W_");
  });

  it("wildcards the meridian when none is given", () => {
    expect(plssIdPattern(t4s8w)).toBe("AL__004_S008_W_");
  });

  it("accepts a BLM code directly", () => {
    expect(meridianCode("29")).toBe("29");
    expect(meridianCode("ta")).toBe("29");
    expect(meridianCode("nope")).toBeNull();
  });

  it("builds a section-layer clause on PLSSID + FRSTDIVNO", () => {
    expect(buildPlssWhere({ ...t4s8w, meridian: "HU" })).toBe(
      "PLSSID LIKE 'AL16004_S008_W_' AND FRSTDIVNO = '12' AND FRSTDIVTYP = 'SN'"
    );
  });

  it("escapes quotes defensively", () => {
    expect(buildPlssWhere({ ...t4s8w, state: "A'" })).toContain("A''");
  });

  it("lists Alabama's three meridians", () => {
    expect(meridiansForState("AL").sort()).toEqual(["HU", "SS", "TA"]);
  });
});

describe("cache key", () => {
  it("is stable, uppercased, and distinguishes any-meridian from explicit", () => {
    expect(cacheKey("al", "4s", "8w", 12, null)).toBe("AL|4S|8W|12|ANY");
    expect(cacheKey("AL", "4S", "8W", 12, "HU")).toBe("AL|4S|8W|12|16");
    expect(cacheKey("AL", "4S", "8W", 12, "16")).toBe("AL|4S|8W|12|16");
  });
});

describe("PLSSID decoding and feature normalization", () => {
  it("decodes the verified layout", () => {
    expect(parsePlssId("AL160040S0080W0")).toEqual({
      state: "AL", meridian: "16", township: "4S", range: "8W", duplicate: "0",
    });
    expect(parsePlssId("AL290070N0170W0")?.township).toBe("7N");
    expect(parsePlssId("garbage")).toBeNull();
  });

  it("normalizes a section feature", () => {
    const c = normalizePlssFeature({
      geometry: { type: "Polygon", coordinates: [[[-86.0, 34.0], [-85.99, 34.0], [-85.99, 34.01], [-86.0, 34.01], [-86.0, 34.0]]] },
      properties: { PLSSID: "AL160040S0080W0", FRSTDIVNO: "12", FRSTDIVDUP: "0" },
    });
    expect(c?.attrs).toMatchObject({
      state: "AL", township: "4S", range: "8W", section: 12, meridian: "16",
      meridianName: "Huntsville",
    });
    expect(c?.acres).toBeGreaterThan(200);
    expect(c?.key).toBe("AL160040S0080W0|12|0");
  });

  it("drops features without polygon geometry", () => {
    expect(
      normalizePlssFeature({ geometry: null, properties: { PLSSID: "AL160040S0080W0", FRSTDIVNO: "1" } })
    ).toBeNull();
  });
});
