import { describe, expect, it } from "vitest";
import { mergeUnsureFields } from "./unsureIndex";

describe("mergeUnsureFields", () => {
  it("shifts each part's line paths by the lines before it", () => {
    const parts = [
      { lines: [{}, {}, {}], unsure_fields: ["lines[0].assessed_value", "amount_due"] },
      { lines: [{}, {}], unsure_fields: ["lines[1].tax_due"] },
      { lines: [{}], unsure_fields: ["lines[0].line_type"] },
    ];
    expect(mergeUnsureFields(parts)).toEqual([
      "lines[0].assessed_value",
      "amount_due",
      "lines[4].tax_due",
      "lines[5].line_type",
    ]);
  });

  it("leaves header fields alone and removes exact repeats", () => {
    const parts = [
      { lines: [{}], unsure_fields: ["tax_year", "county"] },
      { lines: [{}], unsure_fields: ["tax_year"] },
    ];
    expect(mergeUnsureFields(parts)).toEqual(["tax_year", "county"]);
  });

  it("copes with parts that have no lines or no unsure list", () => {
    const parts = [
      { unsure_fields: ["lines[0].tax_due"] },
      { lines: [{}, {}] },
      { lines: [{}], unsure_fields: ["lines[0].acres"] },
    ];
    expect(mergeUnsureFields(parts)).toEqual(["lines[0].tax_due", "lines[2].acres"]);
  });

  it("does not touch words that merely contain 'lines'", () => {
    expect(mergeUnsureFields([{ lines: [{}] }, { lines: [{}], unsure_fields: ["outlines[0]"] }])).toEqual([
      "outlines[0]",
    ]);
  });
});
