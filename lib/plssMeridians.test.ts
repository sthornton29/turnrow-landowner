import { describe, expect, it } from "vitest";
import { COUNTY_MERIDIANS, meridiansForCounty, normalizeCounty } from "./plssMeridians";
import { MERIDIANS } from "./plss";

describe("county to meridian", () => {
  it("Tennessee Valley counties are Huntsville only", () => {
    for (const c of ["Lawrence", "Colbert", "Morgan", "Limestone", "Madison"]) {
      const r = meridiansForCounty("AL", c);
      expect(r.primary, c).toBe("HU");
      expect(r.alternates.filter((a) => a !== "CK"), c).toEqual([]);
    }
    expect(meridiansForCounty("AL", "Lawrence").certain).toBe(true);
    expect(meridiansForCounty("AL", "Lawrence County").primary).toBe("HU");
  });

  it("south Alabama is St. Stephens", () => {
    expect(meridiansForCounty("AL", "Baldwin").primary).toBe("SS");
    expect(meridiansForCounty("AL", "Mobile").primary).toBe("SS");
  });

  it("the southeast corner tries Tallahassee as an alternate", () => {
    const h = meridiansForCounty("AL", "Houston");
    expect(h.primary).toBe("SS");
    expect(h.alternates).toContain("TA");
    expect(h.certain).toBe(false);
  });

  it("split counties carry alternates and are not certain", () => {
    const j = meridiansForCounty("AL", "Jefferson");
    expect(j.primary).toBe("HU");
    expect(j.alternates).toContain("SS");
    expect(j.certain).toBe(false);
    expect(meridiansForCounty("AL", "Tuscaloosa").certain).toBe(false);
  });

  it("unknown county or state gives no primary, never a guess", () => {
    expect(meridiansForCounty("AL", "Nowhere").primary).toBeNull();
    expect(meridiansForCounty("AL", "").primary).toBeNull();
    expect(meridiansForCounty("ZZ", "Lawrence").primary).toBeNull();
    expect(meridiansForCounty("AL", "Nowhere").stateMeridians).toEqual(
      expect.arrayContaining(["HU", "SS", "TA"])
    );
  });

  it("every entry points at a verified meridian", () => {
    for (const [state, counties] of Object.entries(COUNTY_MERIDIANS)) {
      for (const [county, v] of Object.entries(counties)) {
        expect(MERIDIANS[v.primary], `${state} ${county}`).toBeTruthy();
        for (const a of v.alternates) expect(MERIDIANS[a], `${state} ${county} alt`).toBeTruthy();
      }
    }
    expect(Object.keys(COUNTY_MERIDIANS.AL)).toHaveLength(67);
  });

  it("normalizes county spellings", () => {
    expect(normalizeCounty("St. Clair County")).toBe("stclair");
    expect(normalizeCounty("DeKalb")).toBe("dekalb");
  });
});
