import type Anthropic from "@anthropic-ai/sdk";
import { DOC_TYPES } from "@/lib/documents";

// Forced-tool schemas for the document vault: classification, per-type
// extraction (keys match lib/documents.ts EXTRACTED_FIELDS exactly so
// unsure_fields maps 1:1 onto amber inputs), and the legal description
// parse that feeds the boundary plotter.

const nullable = (type: "string" | "number" | "integer", description: string) => ({
  type: [type, "null"] as [typeof type, "null"],
  description,
});

const unsure = {
  type: "array" as const,
  items: { type: "string" as const },
  description: "Field names you are not confident about (blurry, ambiguous, partially visible)",
};

export const CLASSIFY_TOOL: Anthropic.Tool = {
  name: "classify_document",
  description:
    "Classify a landowner's document into one document type. Choose 'other' when none fits.",
  input_schema: {
    type: "object",
    properties: {
      doc_type: { type: "string", enum: [...DOC_TYPES], description: "The best-fitting type" },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
      title: nullable("string", "A short human title for the document, e.g. 'Warranty deed, Smith to Jones, 2014'"),
      reason: { type: "string", description: "One sentence on why" },
    },
    required: ["doc_type", "confidence", "title", "reason"],
    additionalProperties: false,
  },
};

export const DEED_TOOL: Anthropic.Tool = {
  name: "record_deed_extraction",
  description:
    "Record the details of a recorded deed (warranty, quitclaim, timber, mineral, or easement deed). Use null for anything not stated.",
  input_schema: {
    type: "object",
    properties: {
      grantor: nullable("string", "Grantor(s) exactly as written (the party conveying)"),
      grantee: nullable("string", "Grantee(s) exactly as written (the party receiving)"),
      execution_date: nullable("string", "Date signed, YYYY-MM-DD"),
      recording_date: nullable("string", "Date recorded, YYYY-MM-DD"),
      recording_ref: nullable("string", "Book/page or instrument number exactly as stamped"),
      consideration: nullable("number", "Consideration in dollars if stated (not 'ten dollars and other')"),
      county: nullable("string", "County of recording (without the word County)"),
      state: nullable("string", "Two-letter state"),
      parcel_refs: nullable("string", "Parcel / PIN numbers referenced, comma separated"),
      legal_description: nullable("string", "The FULL legal description VERBATIM, every call and exception, line breaks kept"),
      unsure_fields: unsure,
    },
    required: ["unsure_fields"],
    additionalProperties: false,
  },
};

export const SURVEY_TOOL: Anthropic.Tool = {
  name: "record_survey_extraction",
  description:
    "Record the details of a survey plat or a standalone legal description. Use null for anything not stated.",
  input_schema: {
    type: "object",
    properties: {
      surveyor: nullable("string", "Surveyor or firm name and license number if shown"),
      survey_date: nullable("string", "Survey date, YYYY-MM-DD"),
      stated_acres: nullable("number", "Acreage stated on the document"),
      recording_ref: nullable("string", "Plat book/page or instrument number if recorded"),
      legal_description: nullable("string", "The FULL legal description VERBATIM (calls, bearings, distances, exceptions), line breaks kept"),
      unsure_fields: unsure,
    },
    required: ["unsure_fields"],
    additionalProperties: false,
  },
};

export const TITLE_INSURANCE_TOOL: Anthropic.Tool = {
  name: "record_title_insurance_extraction",
  description:
    "Record a title insurance policy or title opinion: insurer, amount, date, and EVERY Schedule B exception (owners need these findable). Use null for anything not stated.",
  input_schema: {
    type: "object",
    properties: {
      insurer: nullable("string", "Insurer or attorney/firm"),
      policy_number: nullable("string", "Policy or file number"),
      policy_amount: nullable("number", "Amount of insurance in dollars"),
      policy_date: nullable("string", "Policy or opinion date, YYYY-MM-DD"),
      exceptions: {
        type: "array",
        description: "Schedule B exceptions, one per item, in order",
        items: {
          type: "object",
          properties: {
            item: nullable("string", "Item number or letter as printed"),
            description: { type: "string", description: "The exception text, condensed but complete (recording refs kept)" },
          },
          required: ["item", "description"],
          additionalProperties: false,
        },
      },
      unsure_fields: unsure,
    },
    required: ["exceptions", "unsure_fields"],
    additionalProperties: false,
  },
};

export const FSA_156EZ_TOOL: Anthropic.Tool = {
  name: "record_fsa_156ez_extraction",
  description:
    "Record an FSA-156EZ (Abbreviated 156 Farm Record): farm number, county, tracts, acres, and the base acres table. Use null for anything not shown.",
  input_schema: {
    type: "object",
    properties: {
      farm_number: nullable("string", "FSA farm number exactly as printed"),
      county: nullable("string", "Administrative county (without the word County)"),
      state: nullable("string", "Two-letter state"),
      tract_numbers: nullable("string", "Tract numbers, comma separated"),
      farmland_acres: nullable("number", "Farmland acres"),
      cropland_acres: nullable("number", "Cropland acres"),
      dcp_cropland_acres: nullable("number", "DCP cropland acres"),
      base_acres: {
        type: "array",
        description: "One row per crop in the base acres table (farm level, not per tract, when both appear)",
        items: {
          type: "object",
          properties: {
            commodity: { type: "string", description: "Crop name as printed, e.g. CORN, SOYBEANS, WHEAT, SEED COTTON, PEANUTS" },
            base_acres: nullable("number", "Base acres"),
            plc_yield: nullable("number", "PLC yield"),
          },
          required: ["commodity", "base_acres", "plc_yield"],
          additionalProperties: false,
        },
      },
      unsure_fields: unsure,
    },
    required: ["base_acres", "unsure_fields"],
    additionalProperties: false,
  },
};

export const DETERMINATION_TOOL: Anthropic.Tool = {
  name: "record_determination_extraction",
  description:
    "Record a wetland (NRCS-CPA-026 style) or highly erodible land determination. Use null for anything not shown.",
  input_schema: {
    type: "object",
    properties: {
      tract: nullable("string", "Tract and farm numbers as printed"),
      determination_codes: nullable("string", "Determination labels/codes with their acres, e.g. 'W 3.2 ac; PC 12.0 ac; NW 40.1 ac'"),
      determination_date: nullable("string", "Determination date, YYYY-MM-DD"),
      notes: nullable("string", "Anything the owner must act on (appeal deadline, restrictions, minimal effect)"),
      unsure_fields: unsure,
    },
    required: ["unsure_fields"],
    additionalProperties: false,
  },
};

export const GENERIC_TOOL: Anthropic.Tool = {
  name: "record_document_extraction",
  description:
    "Record the key facts of a land-related document (appraisal, cruise, plan, policy, agreement, application, closing statement, estate record). Keep it light. Use null for anything not shown.",
  input_schema: {
    type: "object",
    properties: {
      title: nullable("string", "A short human title"),
      parties: nullable("string", "Parties or issuer"),
      document_date: nullable("string", "Document date, YYYY-MM-DD"),
      amount: nullable("number", "The headline dollar amount if there is one (appraised value, premium, price)"),
      reference: nullable("string", "Policy, contract, or file number"),
      summary: nullable("string", "Two or three sentences on what it is and any dates or obligations the owner must track"),
      unsure_fields: unsure,
    },
    required: ["unsure_fields"],
    additionalProperties: false,
  },
};

export const LEGAL_DESCRIPTION_TOOL: Anthropic.Tool = {
  name: "record_legal_description",
  description:
    "Parse the legal description in this deed, plat, or description into structured form for plotting. Copy text verbatim where asked; never invent a call or a section number.",
  input_schema: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: ["aliquot", "metes_bounds", "mixed", "unknown"],
        description: "aliquot = PLSS quarter/section chains; metes_bounds = bearing and distance calls; mixed = both (e.g. an aliquot tract with a metes-and-bounds exception)",
      },
      source_text: { type: "string", description: "The FULL legal description VERBATIM" },
      aliquot: {
        type: ["object", "null"],
        description: "Present when kind is aliquot or mixed",
        properties: {
          tracts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                description: { type: "string", description: "This tract's text verbatim" },
                section: nullable("integer", "Section number 1-36"),
                township_num: nullable("integer", "Township number"),
                township_dir: { type: ["string", "null"], enum: ["N", "S", null] },
                range_num: nullable("integer", "Range number"),
                range_dir: { type: ["string", "null"], enum: ["E", "W", null] },
                meridian: nullable("string", "Principal meridian if named (e.g. Huntsville, St. Stephens, Tallahassee)"),
                aliquot_text: { type: "string", description: "Only the aliquot chain, normalized like 'NW1/4 of SE1/4' or 'S1/2 of NE1/4' or 'Lot 3'; 'ALL' for a whole section" },
                exceptions: { type: "array", items: { type: "string" }, description: "Each 'less and except' parcel's text verbatim" },
              },
              required: ["description", "section", "township_num", "township_dir", "range_num", "range_dir", "meridian", "aliquot_text", "exceptions"],
              additionalProperties: false,
            },
          },
        },
        required: ["tracts"],
        additionalProperties: false,
      },
      metes_bounds: {
        type: ["object", "null"],
        description: "Present when kind is metes_bounds or mixed",
        properties: {
          pob_description: nullable("string", "How the point of beginning is described (monument, ties to a section corner), verbatim"),
          basis_of_bearing: nullable("string", "Stated basis of bearing (grid, magnetic, assumed, a prior plat)"),
          calls: {
            type: "array",
            description: "Every course in order from the point of beginning",
            items: {
              type: "object",
              properties: {
                seq: { type: "integer" },
                bearing_text: nullable("string", "Bearing exactly as written, e.g. N 45°30'15\" E, S 12-15-00 W, N 89.5 E, or an azimuth"),
                distance: nullable("number", "Distance as a number"),
                unit: { type: ["string", "null"], enum: ["feet", "chains", "poles", "links", "varas", "meters", null] },
                curve: {
                  type: ["object", "null"],
                  properties: {
                    direction: { type: ["string", "null"], enum: ["left", "right", null] },
                    radius: nullable("number", "Radius in the call's unit"),
                    arc_length: nullable("number", "Arc length in the call's unit"),
                    chord_bearing: nullable("string", "Chord bearing as written"),
                    chord_length: nullable("number", "Chord length"),
                    delta: nullable("string", "Central angle as written"),
                  },
                  required: ["direction", "radius", "arc_length", "chord_bearing", "chord_length", "delta"],
                  additionalProperties: false,
                },
                note: nullable("string", "Monument or remark on this course"),
              },
              required: ["seq", "bearing_text", "distance", "unit", "curve", "note"],
              additionalProperties: false,
            },
          },
        },
        required: ["pob_description", "basis_of_bearing", "calls"],
        additionalProperties: false,
      },
      unsure_fields: unsure,
    },
    required: ["kind", "source_text", "aliquot", "metes_bounds", "unsure_fields"],
    additionalProperties: false,
  },
};

export const VAULT_KINDS = [
  "classify",
  "deed",
  "survey",
  "title_insurance",
  "fsa_156ez",
  "determination",
  "generic",
  "legal_description",
] as const;
export type VaultKind = (typeof VAULT_KINDS)[number];

export const VAULT_TOOLS: Record<VaultKind, Anthropic.Tool> = {
  classify: CLASSIFY_TOOL,
  deed: DEED_TOOL,
  survey: SURVEY_TOOL,
  title_insurance: TITLE_INSURANCE_TOOL,
  fsa_156ez: FSA_156EZ_TOOL,
  determination: DETERMINATION_TOOL,
  generic: GENERIC_TOOL,
  legal_description: LEGAL_DESCRIPTION_TOOL,
};

export const VAULT_PROMPTS: Record<VaultKind, string> = {
  classify:
    "Classify this document for a rural landowner's records. Look at the heading, the first page, and any recording stamps. Pick exactly one type; 'other' when nothing fits. Suggest a short title.",
  deed:
    "Extract this recorded deed. Only record what it actually states; use null for anything absent. Keep names exactly as written. Dates as YYYY-MM-DD. Copy the legal description VERBATIM and complete, including every 'less and except'. List every field you are unsure about in unsure_fields.",
  survey:
    "Extract this survey plat or legal description (it may be a photo or a scan of a drawing; read the notes and the certification block). Only record what it states; use null for anything absent. Copy the legal description VERBATIM and complete. List every field you are unsure about in unsure_fields.",
  title_insurance:
    "Extract this title insurance policy or title opinion. Record the insurer, amount, date, and EVERY Schedule B exception in order, keeping recording references. Use null for anything absent. List every field you are unsure about in unsure_fields.",
  fsa_156ez:
    "Extract this FSA-156EZ farm record. Record the farm number, county, tract numbers, farmland/cropland/DCP cropland acres, and the farm-level base acres table with PLC yields exactly as printed. Use null for anything absent. List every field you are unsure about in unsure_fields.",
  determination:
    "Extract this wetland or highly erodible land determination. Record the tract, the determination codes with their acres, the date, and anything the owner must act on. Use null for anything absent. List every field you are unsure about in unsure_fields.",
  generic:
    "Summarize the key facts of this land document: title, parties, date, headline amount, reference number, and a short summary of obligations or dates to track. Use null for anything absent. List every field you are unsure about in unsure_fields.",
  legal_description:
    "Parse the legal description in this document for plotting. Decide whether it is a PLSS aliquot description (quarter-quarter chains with section, township, range), metes and bounds (bearing and distance calls, possibly curves), mixed, or unknown. Copy source_text VERBATIM. For aliquot tracts give section, township, range with directions and the normalized aliquot chain, listing each 'less and except' exception separately. For metes and bounds list EVERY call in order with the bearing exactly as written, the distance, its unit, and curve elements when present. Never invent a call, a number, or a direction; use null and list it in unsure_fields.",
};
