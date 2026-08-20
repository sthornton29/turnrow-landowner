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
  extractedHighlights,
  scanKindFor,
} from "./documents";

// The list migration 0020's check constraint allows.
const SQL_TYPES = [
  "deed_warranty", "deed_quitclaim", "deed_timber", "deed_mineral",
  "title_insurance", "title_opinion", "closing_statement", "probate_estate",
  "survey_plat", "legal_description",
  "easement_deed", "mortgage_dot", "lien_release",
  "fsa_156ez", "fsa_map", "crp_contract", "nrcs_conservation_plan",
  "wetland_determination", "hel_determination",
  "appraisal", "timber_cruise", "management_plan", "soil_survey",
  "insurance_policy", "hunting_agreement", "current_use_application",
  "other",
];

describe("document taxonomy", () => {
  it("matches the migration check constraint exactly", () => {
    expect([...DOC_TYPES].sort()).toEqual([...SQL_TYPES].sort());
    expect(DOC_TYPES).toHaveLength(27);
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
