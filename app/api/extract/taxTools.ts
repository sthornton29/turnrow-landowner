import type Anthropic from "@anthropic-ai/sdk";
import { IDENTIFIER_KINDS } from "@/lib/taxIdentifiers";

// Forced-tool schemas for property tax statements, two stages:
//   tax_segment   one call per page group, returns every page's header
//                 so lib/taxSegment.ts can group pages into statements
//   tax_statement one call per statement (its pages only), returns the
//                 header plus EVERY parcel line with EVERY labeled
//                 number as an identifier pair
// Handwritten annotations are the owner's notes and never feed a field.

const nullable = (type: "string" | "number" | "integer", description: string) => ({
  type: [type, "null"] as [typeof type, "null"],
  description,
});

export const HANDWRITING_RULE =
  "IMPORTANT: handwritten marks, notes, check marks, circles, and highlighter on these pages are the owner's own annotations. Ignore handwriting for EVERY field; read only printed text.";

// What "unsure" means. Without this the reader listed fields it had left
// null because the bill does not print them (assessed value, ratio, a
// due date with no year), and clearly printed values it could not
// classify: every 2026 Lawrence notice came back with its one printed
// "APPR VALUE" marked unsure, read correctly each time. A mark is for a
// reading that needs a second look at the paper, nothing else.
//
// A null field is listed in exactly one case: something IS printed there
// and cannot be read at all. That mark must reach the review screen (it
// is the only sign the blank box should hold a number), so nothing in
// code drops marks on blank fields: a check that did was tried here and
// threw away the mark on a notice whose appraised value was smeared out.
export const UNSURE_RULE =
  "unsure_fields is ONLY for print you could not read with confidence: characters that are blurry, faint, cut off by the scan, or covered by handwriting or a stamp, or two printed numbers that could each be the field. Record your best reading and list the field; when a printed value cannot be read at all, leave it null and list it. NEVER list a field you left null because the bill does not print it (an assessed value, ratio, or acres that is not on the bill; a date left null because no year is printed): null is the complete answer. NEVER list text or a number whose characters are clear, whatever else is odd about it: the bill does not say what kind of value it is, it does not multiply out to the tax, the county misspelled or abbreviated it, or the county printed it cut short (a legal description that stops mid-phrase or reads strangely is recorded exactly as printed). A clearly printed bill has an EMPTY unsure_fields list.";

export const TAX_SEGMENT_TOOL: Anthropic.Tool = {
  name: "record_tax_pages",
  description:
    "Record, for EVERY page provided, the property tax statement header printed on it, so pages can be grouped into statements. A statement that bills a whole account repeats its account number and total on every page; a continuation page carries the same numbers.",
  input_schema: {
    type: "object",
    properties: {
      pages: {
        type: "array",
        description: "One entry per page, in order, first page = the page_number given in the prompt",
        items: {
          type: "object",
          properties: {
            page_number: { type: "integer", description: "Page number within the whole file (the prompt says which page this group starts at)" },
            is_statement: { type: "boolean", description: "False for cover letters, envelopes, blank or unrelated pages" },
            is_continuation: { type: "boolean", description: "True when this page continues the statement begun on an earlier page (same account, no new header, or the header repeats)" },
            county: nullable("string", "County named on the page (without the word County)"),
            state: nullable("string", "Two-letter state"),
            billing_key: nullable("string", "The number the county BILLS on, exactly as printed: the account number when the statement covers an account; else the receipt, bill, or key number; else the parcel number"),
            billing_kind: {
              type: ["string", "null"],
              enum: ["account_number", "receipt_number", "key_number", "bill_number", "parcel_number", "other", null],
            },
            taxpayer_name: nullable("string", "Taxpayer or owner name exactly as printed, including any C/O"),
            tax_year: nullable("integer", "Tax year the statement covers"),
            total_tax: nullable("number", "The statement's TOTAL tax due as printed on this page (not a single parcel's line), dollars"),
          },
          required: ["page_number", "is_statement", "is_continuation", "county", "state", "billing_key", "billing_kind", "taxpayer_name", "tax_year", "total_tax"],
          additionalProperties: false,
        },
      },
    },
    required: ["pages"],
    additionalProperties: false,
  },
};

const IDENTIFIER_ITEM = {
  type: "object" as const,
  properties: {
    label: { type: "string", description: "The label exactly as printed next to the number (e.g. 'PPIN', 'Parcel No.', 'Key Number', 'Receipt #')" },
    kind: { type: "string", enum: [...IDENTIFIER_KINDS], description: "Best-guess kind; 'other' when none fits (keep the label)" },
    value: { type: "string", description: "The number exactly as printed, keeping its punctuation and spacing" },
  },
  required: ["label", "kind", "value"],
  additionalProperties: false,
};

export const TAX_STATEMENT_TOOL: Anthropic.Tool = {
  name: "record_tax_statement",
  description:
    "Record ONE property tax statement: its header and EVERY parcel line (block) printed on it, with every labeled number on each line captured as an identifier pair. Use null for anything not shown. Never invent a line.",
  input_schema: {
    type: "object",
    properties: {
      county: nullable("string", "County (without the word County)"),
      state: nullable("string", "Two-letter state"),
      authority_name: nullable("string", "The taxing authority's office as printed, without the officeholder's own name (e.g. 'Lawrence County Revenue Commissioner')"),
      tax_year: nullable("integer", "Tax year the statement covers"),
      billing_key: nullable("string", "The number the county bills on, exactly as printed (account, receipt, bill, key, or parcel number)"),
      billing_kind: { type: ["string", "null"], enum: ["account_number", "receipt_number", "key_number", "bill_number", "parcel_number", "other", null] },
      taxpayer_name: nullable("string", "Taxpayer or owner name EXACTLY as printed, including any 'C/O ...' part"),
      care_of: nullable("string", "The name after C/O when printed separately; else null"),
      mailing_address: nullable("string", "Mailing address as printed, one line"),
      total_tax: nullable("number", "Total tax due for the whole statement, dollars"),
      due_date: nullable("string", "The date the tax becomes DUE, the START of the payment window, YYYY-MM-DD; never the last day to pay. ONLY when the bill prints the date WITH ITS YEAR (e.g. 'taxes due October 1, 2026 - December 31, 2026' -> 2026-10-01). When the bill gives a month and day with no year (e.g. 'due on October 1 of each tax year'), return null: do not work out or guess a year."),
      delinquent_date: nullable("string", "The first day the tax is delinquent, YYYY-MM-DD. ONLY when the bill prints the date WITH ITS YEAR (e.g. 'delinquent after December 31, 2026' or 'pay by December 31, 2026' -> 2027-01-01; 'delinquent January 1, 2027' -> that day). When the bill gives a month and day with no year (e.g. 'delinquent after December 31 of each year'), return null: do not work out or guess a year."),
      header_identifiers: {
        type: "array",
        description: "Every labeled number printed in the HEADER that is not tied to one parcel line (account number, receipt number, key number, bill number, ...)",
        items: IDENTIFIER_ITEM,
      },
      lines: {
        type: "array",
        description: "One entry per parcel block printed on the statement, in order. A single-parcel statement has exactly one.",
        items: {
          type: "object",
          properties: {
            line_type: { type: "string", enum: ["real_property", "personal_property"], description: "personal_property for business personal property lines (often parcel 00-00-00... or an exemption code like PP)" },
            identifiers: { type: "array", description: "EVERY labeled number on this line (parcel number, PPIN, PIN, account, key, receipt, ...), each as printed", items: IDENTIFIER_ITEM },
            appraised_value: nullable("number", "The line's main printed value, dollars, filled whenever the bill prints a property value for the line: the one labeled appraised ('APPR VALUE', 'Appraised Value', 'Total Value'); on a bill with no appraised label, the market value (the same number as market_value). Never the assessed value."),
            assessed_value: nullable("number", "Assessed value, dollars, ONLY when the bill prints one; never worked out from another value"),
            tax_due: nullable("number", "Tax due for THIS line, dollars"),
            exemptions: nullable("string", "Exemption codes or text on the line, as printed"),
            legal_description: nullable("string", "Legal description printed for the line, verbatim"),
            property_address: nullable("string", "Property or situs address if printed"),
            acres: nullable("number", "Acres if printed"),
            market_value: nullable("number", "Fair market value, dollars, ONLY when the bill's own label says market (or it prints a total appraised MARKET value); null for a value labeled only appraised. Filling this never empties appraised_value."),
            current_use_value: nullable("number", "Current use value, dollars, ONLY when the bill's own label says current use (Alabama farm and timber land); null otherwise"),
            land_value: nullable("number", "Land value if printed separately, dollars"),
            improvement_value: nullable("number", "Improvements / buildings value if printed, dollars"),
            assessment_ratio: nullable("number", "Assessment ratio or class percent if printed, as a percent (10, 20); Class III is 10, Class II 20"),
            tax_district: nullable("string", "Tax district code or name if printed"),
            millage: nullable("number", "Total millage / tax rate in mills if printed (e.g. 30.0)"),
            timber_acres: nullable("number", "Timber or forest acres if printed"),
          },
          required: ["line_type", "identifiers", "appraised_value", "assessed_value", "tax_due", "exemptions", "legal_description", "property_address", "acres", "market_value", "current_use_value", "land_value", "improvement_value", "assessment_ratio", "tax_district", "millage", "timber_acres"],
          additionalProperties: false,
        },
      },
      unsure_fields: {
        type: "array",
        items: { type: "string" },
        description: "Fields where printed characters could not be read with confidence (blurry, faint, cut off, covered), whether you recorded a best reading or had to leave it null; for lines use lines[i].field. Never a field left null because the bill does not print it, and never clearly printed text that merely looks odd. Empty when everything was clearly printed.",
      },
    },
    required: ["county", "state", "authority_name", "tax_year", "billing_key", "billing_kind", "taxpayer_name", "care_of", "mailing_address", "total_tax", "due_date", "delinquent_date", "header_identifiers", "lines", "unsure_fields"],
    additionalProperties: false,
  },
};

export const TAX_SEGMENT_PROMPT = (firstPage: number, count: number) =>
  `These are pages ${firstPage} to ${firstPage + count - 1} of a file of property tax statements. For EVERY page, record the statement header printed on it. The billing_key is the number the county bills on (an account number covering several parcels, else a receipt, bill, or key number, else the parcel number), exactly as printed. total_tax is the statement's total, which whole-account bills repeat on every page. ${HANDWRITING_RULE}`;

export const TAX_STATEMENT_PROMPT =
  `These pages are ONE property tax statement (it may be several pages, a photo, or a scan). Record the header and EVERY parcel line printed on it. For each line capture EVERY labeled number exactly as printed as an identifier pair (label as printed, best-guess kind, value). VALUES: appraised_value is the line's main value and is filled on EVERY line the bill prints a property value for: the value labeled appraised ('APPR VALUE', 'Appraised Value', 'Total Value'), or, on a bill with no appraised label, its market value (a bill printing 'MARKET VALUE' and 'ASSESSED VALUE' has the market number in BOTH appraised_value and market_value). market_value and current_use_value are filled only from a label that says market or current use: a bill whose value is labeled only appraised leaves both null, and you do not try to decide which kind of value it is. Some Alabama bills print BOTH a market value and a current use value: put each in its own field, and keep appraised_value as the total value the bill labels appraised. Fill assessed value, land, improvement, assessment ratio, tax district, millage, acres, and timber acres only when the bill prints them under their own label; never work one value out from another or from the tax. Unrecognized labels keep kind 'other' with the label. Mark business personal property lines as personal_property. Keep the taxpayer name exactly as printed, including any C/O: a 'C/O ...' line printed under the name is part of taxpayer_name ('JOHN A DOE C/O DOE FARMS LLC'), and the name after C/O also goes in care_of. Dates as YYYY-MM-DD, dollars as plain numbers. ${HANDWRITING_RULE} ${UNSURE_RULE}`;
