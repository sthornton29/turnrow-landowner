import { describe, expect, it } from "vitest";
import { countyStateOf, extractPlssReferences, statedAcresOf } from "./legalRefs";

const DLM =
  "A portion of a larger tract of land in Lawrence County, Alabama, south of Courtland, said larger tract once forming the homeplace of David L. Martin, known as View Celeste, said portion of View Celeste described herein lying and being located south and west of Sandy Branch in Section 31, Township 4 South, Range 7 West, containing 120 acres, more or less, and being subject to existing easements for roads and utilities.";

describe("extractPlssReferences", () => {
  it("reads the long form exactly as printed", () => {
    const r = extractPlssReferences(DLM);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ section: 31, township_num: 4, township_dir: "S", range_num: 7, range_dir: "W" });
    expect(r[0].aliquot_text).toContain("south and west of Sandy Branch");
  });
  it("reads short forms and several tracts", () => {
    const r = extractPlssReferences(
      "The NW1/4 of the SE1/4 of Sec. 12, T4S, R8W; also the E1/2 of NE1/4 of Section 13, Township 4 South, Range 8 West."
    );
    expect(r.map((x) => x.section)).toEqual([12, 13]);
    expect(r[0].aliquot_text).toMatch(/NW1\/4 of the SE1\/4/);
    expect(r[1].aliquot_text).toMatch(/E1\/2 of NE1\/4/);
  });
  it("expands 'Sections 29 and 32' sharing one township", () => {
    const r = extractPlssReferences("All of Sections 29 and 32, T4S R7W, Huntsville Meridian.");
    expect(r.map((x) => `${x.section}`)).toEqual(["29", "32"]);
    expect(r[0].range_dir).toBe("W");
  });
  it("never swaps a direction letter", () => {
    const r = extractPlssReferences("Section 6, Township 3 North, Range 2 East");
    expect(r[0]).toMatchObject({ township_dir: "N", range_dir: "E" });
  });
  it("returns nothing without a complete reference", () => {
    expect(extractPlssReferences("Section 31 of the Martin place")).toEqual([]);
    expect(extractPlssReferences(null)).toEqual([]);
  });
});

describe("statedAcresOf and countyStateOf", () => {
  it("reads containing N acres", () => {
    expect(statedAcresOf(DLM)).toBe(120);
    expect(statedAcresOf("a tract of 1,234.5 acres, more or less")).toBe(1234.5);
    expect(statedAcresOf("no acreage here")).toBeNull();
  });
  it("reads county and state", () => {
    expect(countyStateOf(DLM)).toEqual({ county: "Lawrence", state: "AL" });
    expect(countyStateOf("in Colbert County, State of Alabama")).toEqual({ county: "Colbert", state: "AL" });
  });
});
