import { describe, expect, it } from "vitest";
import { canonicalCrop, matchCrop, sameCrop } from "./crops";

describe("canonicalCrop", () => {
  it("lowercases, trims, and strips punctuation", () => {
    expect(canonicalCrop("  CORN ")).toBe("corn");
    expect(canonicalCrop("Soy-Beans")).toBe("soybean");
  });

  it("tolerates singular and plural", () => {
    expect(canonicalCrop("Soybeans")).toBe(canonicalCrop("soybean"));
    expect(canonicalCrop("Oats")).toBe(canonicalCrop("oat"));
  });

  it("does not butcher short or double-s words", () => {
    expect(canonicalCrop("grass")).toBe("grass");
    expect(canonicalCrop("rye")).toBe("rye");
  });

  it("applies the synonym map", () => {
    expect(canonicalCrop("Beans")).toBe("soybean");
    expect(canonicalCrop("Winter Wheat")).toBe("wheat");
    expect(canonicalCrop("Rapeseed")).toBe("canola");
    expect(canonicalCrop("Milo")).toBe("sorghum");
    expect(canonicalCrop("Grain Sorghum")).toBe("sorghum");
  });

  it("returns empty for missing names", () => {
    expect(canonicalCrop(null)).toBe("");
    expect(canonicalCrop("  ")).toBe("");
  });
});

describe("sameCrop", () => {
  it("matches across conventions", () => {
    expect(sameCrop("Wheat", "winter wheat")).toBe(true);
    expect(sameCrop("beans", "Soybeans")).toBe(true);
    expect(sameCrop("Canola", "rape")).toBe(true);
  });

  it("never matches different crops", () => {
    expect(sameCrop("Wheat", "Canola")).toBe(false);
    expect(sameCrop("Corn", "Cotton")).toBe(false);
  });

  it("never matches on empty", () => {
    expect(sameCrop("", "")).toBe(false);
    expect(sameCrop(null, "corn")).toBe(false);
  });
});

describe("matchCrop", () => {
  it("returns the matching candidate verbatim", () => {
    expect(matchCrop("winter wheat", ["Corn", "Wheat", "Canola"])).toBe("Wheat");
    expect(matchCrop("Soybeans", ["beans"])).toBe("beans");
  });

  it("returns null when nothing matches confidently", () => {
    expect(matchCrop("Peanuts", ["Corn", "Wheat"])).toBeNull();
    expect(matchCrop(null, ["Corn"])).toBeNull();
    expect(matchCrop("Corn", [])).toBeNull();
  });
});
