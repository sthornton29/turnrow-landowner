import { describe, expect, it } from "vitest";
import {
  DOC_GROUPS,
  DOC_GROUP_LABELS,
  DOC_TYPES,
  DOC_TYPES_BY_GROUP,
  DOC_TYPE_GROUP,
  DOC_TYPE_LABELS,
  EXTRACTED_FIELDS,
  canPlotBoundary,
  documentSearchText,
  extractedHighlights,
  matchesEveryWord,
  scanKindFor,
  unsureNotes,
  unsureSet,
} from "./documents";

// The list migration 0020's check constraint allows, as widened by 0039.
const SQL_TYPES = [
  "deed_warranty", "deed_quitclaim", "deed_timber", "deed_mineral",
  "title_insurance", "title_opinion", "closing_statement", "probate_estate",
  "survey_plat", "legal_description",
  "easement_deed", "mortgage_dot", "lien_release",
  "fsa_156ez", "fsa_map", "crp_contract", "nrcs_conservation_plan",
  "wetland_determination", "hel_determination",
  "appraisal", "timber_cruise", "management_plan", "soil_survey",
  "insurance_policy", "hunting_agreement", "current_use_application",
  "tax_statement", "tax_receipt",
  "other",
];

describe("document taxonomy", () => {
  it("matches the migration check constraint exactly", () => {
    expect([...DOC_TYPES].sort()).toEqual([...SQL_TYPES].sort());
    expect(DOC_TYPES).toHaveLength(29);
  });

  it("labels and groups every type; every group has types and a label", () => {
    for (const t of DOC_TYPES) {
      expect(DOC_TYPE_LABELS[t]).toBeTruthy();
      expect(DOC_GROUPS).toContain(DOC_TYPE_GROUP[t]);
    }
    for (const g of DOC_GROUPS) {
      expect(DOC_GROUP_LABELS[g]).toBeTruthy();
      expect(DOC_TYPES_BY_GROUP[g].length).toBeGreaterThan(0);
    }
    expect(DOC_TYPES_BY_GROUP.other).toEqual(["other"]);
    expect(DOC_TYPES_BY_GROUP.government).toContain("fsa_156ez");
  });

  it("scanKindFor is total and routes as agreed", () => {
    for (const t of DOC_TYPES) {
      const k = scanKindFor(t);
      expect(k).not.toBeNull();
      expect(EXTRACTED_FIELDS[k!]).toBeTruthy();
    }
    expect(scanKindFor("deed_warranty")).toBe("deed");
    expect(scanKindFor("easement_deed")).toBe("deed");
    expect(scanKindFor("survey_plat")).toBe("survey");
    expect(scanKindFor("legal_description")).toBe("survey");
    expect(scanKindFor("title_opinion")).toBe("title_insurance");
    expect(scanKindFor("fsa_156ez")).toBe("fsa_156ez");
    expect(scanKindFor("hel_determination")).toBe("determination");
    expect(scanKindFor("appraisal")).toBe("generic");
    expect(scanKindFor("tax_statement")).toBe("generic");
    expect(scanKindFor("tax_receipt")).toBe("generic");
    expect(scanKindFor("other")).toBe("generic");
  });

  it("only deeds, plats, and legal descriptions plot boundaries", () => {
    const plottable = DOC_TYPES.filter(canPlotBoundary).sort();
    expect(plottable).toEqual(
      [
        "deed_warranty", "deed_quitclaim", "deed_timber", "deed_mineral",
        "survey_plat", "legal_description", "easement_deed",
      ].sort()
    );
  });

  it("review forms carry table columns where tables are declared", () => {
    for (const fields of Object.values(EXTRACTED_FIELDS)) {
      for (const f of fields) {
        if (f.input === "table" || f.input === "farms") expect(f.columns?.length).toBeGreaterThan(0);
        else expect(f.columns).toBeUndefined();
      }
    }
  });
});

describe("extracted highlights", () => {
  it("formats deed, survey, title, and FSA lines", () => {
    expect(
      extractedHighlights("deed_warranty", {
        grantor: "Smith", grantee: "Jones", recording_ref: "Book 123/45",
        consideration: 125000,
      })
    ).toEqual(["Grantor: Smith", "Grantee: Jones", "Rec.: Book 123/45", "Consideration $125,000.00"]);
    expect(
      extractedHighlights("survey_plat", { surveyor: "Acme", stated_acres: 40.26 })
    ).toEqual(["Surveyor: Acme", "40.3 acres stated"]);
    expect(
      extractedHighlights("title_insurance", {
        insurer: "First American", policy_amount: 250000, exceptions: [{}, {}],
      })
    ).toEqual(["Insurer: First American", "Policy $250,000.00", "2 exceptions"]);
    expect(
      extractedHighlights("fsa_156ez", {
        farm_number: "1234", cropland_acres: 310.04,
        base_acres: [{ commodity: "Corn", base_acres: 100.5 }, { commodity: "Soybeans", base_acres: 50 }],
      })
    ).toEqual(["Farm: 1234", "310.0 cropland acres", "150.5 base acres (2 commodities)"]);
    expect(
      extractedHighlights("fsa_156ez", {
        farms: [
          { farm_number: "1234", base_acres: [{ commodity: "Corn", base_acres: 100 }] },
          { farm_number: "1235", base_acres: [{ commodity: "Wheat", base_acres: 20.5 }] },
        ],
      })
    ).toEqual(["2 farms: 1234, 1235", "120.5 base acres (2 commodities)"]);
  });

  it("returns nothing for empty extractions and skips blank values", () => {
    expect(extractedHighlights("deed_warranty", null)).toEqual([]);
    expect(extractedHighlights("appraisal", { parties: "", amount: null })).toEqual([]);
  });
});

describe("document search", () => {
  it("matches when every word appears, in any order", () => {
    const title = "Warranty Deed - Smith to Jones (2014)";
    expect(matchesEveryWord(title, "smith deed")).toBe(true);
    expect(matchesEveryWord(title, "  JONES   warranty ")).toBe(true);
    expect(matchesEveryWord(title, "smith to jones")).toBe(true);
    expect(matchesEveryWord(title, "smith lease")).toBe(false);
    expect(matchesEveryWord(title, "")).toBe(true);
    expect(matchesEveryWord(title, "   ")).toBe(true);
  });

  it("builds the search line from the type, the read values, and the highlights", () => {
    const text = documentSearchText("deed_warranty", {
      scan_kind: "deed",
      grantor: "John Smith",
      grantee: "Jane Jones",
      consideration: 250000,
      legal_description: "The NW1/4 of SE1/4 lying south of Sandy Branch",
      spatial: {
        reference_label: "Sec 31, T4S R7W, Huntsville PM",
        polygon: { type: "MultiPolygon", coordinates: [[[[-87.4321, 34.5678], [-87.4, 34.5]]]] },
        matches: [{ entity_type: "property", name: "Shop Area", overlap_acres: 399.6 }],
      },
      legal_description_extraction: { source_text: "Beginning at an iron pin", aliquot: { tracts: [{ section: 31 }] } },
    });
    for (const found of [
      "warranty deed",
      "john smith",
      "jane jones",
      "250000",
      "consideration $250,000.00",
      "sandy branch",
      "sec 31, t4s r7w",
      "shop area",
      "beginning at an iron pin",
    ]) {
      expect(text, found).toContain(found);
    }
    // Map coordinates are not sent or searched.
    expect(text).not.toContain("87.4321");
    expect(text).not.toContain("multipolygon");
    expect(text).toBe(text.toLowerCase());
    expect(matchesEveryWord(text, "smith sandy branch deed")).toBe(true);
  });

  it("still names the type when nothing was read", () => {
    expect(documentSearchText("survey_plat", null)).toBe("survey plat survey_plat");
    expect(documentSearchText(null, undefined)).toBe("other");
  });
});

describe("unsure fields", () => {
  it("reduces a path to the field the form knows", () => {
    const set = unsureSet([
      "grantor",
      "fields.grantee",
      "extraction.fields.recording_ref",
      "fields.farms[0].farm_number",
      "farms[1].base_acres",
      "fields.exceptions[2].description",
    ]);
    expect([...set].sort()).toEqual(
      ["exceptions", "farms[0].farm_number", "farms[1].base_acres", "grantee", "grantor", "recording_ref"].sort()
    );
  });

  it("keeps a sentence whole and shows it as a note, not a field", () => {
    const list = [
      "fields.grantor",
      "legal_description",
      "Only the first 90 of 240 pages were read",
      "Only the first 90 of 240 pages were read",
      "notary_name",
    ];
    expect(unsureSet(list).has("Only the first 90 of 240 pages were read")).toBe(true);
    expect(unsureNotes("deed", list)).toEqual([
      "Only the first 90 of 240 pages were read",
      "Unsure about: notary name",
    ]);
    // A field of this form, or a farm card, is never repeated as a note.
    expect(unsureNotes("deed", ["fields.grantor", "consideration"])).toEqual([]);
    expect(unsureNotes("fsa_156ez", ["farms[0].farm_number", "fields.farms[2].county"])).toEqual([]);
    expect(unsureNotes("title_insurance", ["exceptions[2].description"])).toEqual([]);
  });
});
