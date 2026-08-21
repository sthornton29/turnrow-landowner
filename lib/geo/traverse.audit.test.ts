import { describe, expect, it } from "vitest";
import { FEET_PER_UNIT, parseBearing, parseDistance, traverse, unitSupported } from "./traverse";

describe("bearing quadrants (audit)", () => {
  const cases: Array<[string, number]> = [
    ["N 30 E", 30],
    ["N 30 W", 330],
    ["S 30 E", 150],
    ["S 30 W", 210],
    ["N 45°30'00\" E", 45.5],
    ["S 45°30'00\" E", 134.5],
    ["S 45°30'00\" W", 225.5],
    ["N 45°30'00\" W", 314.5],
    ["North 10 degrees 15 minutes East", 10.25],
    ["S 0 E", 180],
    ["due north", 0],
    ["due west", 270],
  ];
  for (const [text, az] of cases) {
    it(`${text} -> ${az}`, () => {
      expect(parseBearing(text)?.azimuthDeg).toBeCloseTo(az, 4);
    });
  }
});

describe("distance units (audit)", () => {
  it("chains are 66 ft and poles/rods 16.5 ft", () => {
    expect(FEET_PER_UNIT.chains).toBe(66);
    expect(FEET_PER_UNIT.poles).toBe(16.5);
    expect(parseDistance("10 chains")).toBe(660);
    expect(parseDistance("4 rods")).toBe(66);
    expect(parseDistance("4 poles")).toBe(66);
    expect(parseDistance("100 links")).toBe(66);
    expect(parseDistance("20 ch")).toBe(1320);
  });

  it("varas are flagged unsupported, never converted", () => {
    expect(unitSupported("varas")).toBe(false);
    expect(unitSupported("chains")).toBe(true);
    expect(parseDistance("100 varas")).toBeNull();
    expect(parseDistance(100, "varas")).toBeNull();
    const r = traverse([
      { bearing: "N 0 E", distance: 100, unit: "varas" },
      { bearing: "N 90 E", distance: 100, unit: "feet" },
      { bearing: "S 0 E", distance: 100, unit: "feet" },
    ]);
    expect(r.warnings.join(" ")).toMatch(/varas/i);
  });

  it("a 40 acre square in chains closes", () => {
    const r = traverse([
      { bearing: "N 0 E", distance: 20, unit: "chains" },
      { bearing: "N 90 E", distance: 20, unit: "chains" },
      { bearing: "S 0 E", distance: 20, unit: "chains" },
      { bearing: "N 90 W", distance: 20, unit: "chains" },
    ]);
    expect(r.areaAcres).toBeCloseTo(40, 1);
    expect(r.closureDistanceFt).toBeLessThan(0.01);
  });
});
