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
      authority_name: nullable("string", "Taxing authority exactly as printed"),
      tax_year: nullable("integer", "Tax year the statement covers"),
      billing_key: nullable("string", "The number the county bills on, exactly as printed (account, receipt, bill, key, or parcel number)"),
      billing_kind: { type: ["string", "null"], enum: ["account_number", "receipt_number", "key_number", "bill_number", "parcel_number", "other", null] },
      taxpayer_name: nullable("string", "Taxpayer or owner name EXACTLY as printed, including any 'C/O ...' part"),
      care_of: nullable("string", "The name after C/O when printed separately; else null"),
      mailing_address: nullable("string", "Mailing address as printed, one line"),
      total_tax: nullable("number", "Total tax due for the whole statement, dollars"),
      due_date: nullable("string", "The date the tax becomes DUE, the START of the payment window (e.g. 'due October 1' or 'taxes due October 1, 2024 - December 31, 2024' -> 2024-10-01), YYYY-MM-DD; never the last day to pay"),
      delinquent_date: nullable("string", "The first day the tax is delinquent if printed (e.g. 'delinquent after December 31' or 'pay by December 31' -> 2025-01-01; 'delinquent January 1' -> that day), YYYY-MM-DD"),
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
            appraised_value: nullable("number", "Appraised or market value, dollars"),
            assessed_value: nullable("number", "Assessed value, dollars"),
            tax_due: nullable("number", "Tax due for THIS line, dollars"),
            exemptions: nullable("string", "Exemption codes or text on the line, as printed"),
            legal_description: nullable("string", "Legal description printed for the line, verbatim"),
            property_address: nullable("string", "Property or situs address if printed"),
            acres: nullable("number", "Acres if printed"),
          },
          required: ["line_type", "identifiers", "appraised_value", "assessed_value", "tax_due", "exemptions", "legal_description", "property_address", "acres"],
          additionalProperties: false,
        },
      },
      unsure_fields: {
        type: "array",
        items: { type: "string" },
        description: "Field names you are not confident about (blurry, ambiguous, partially visible); for lines use lines[i].field",
      },
    },
    required: ["county", "state", "authority_name", "tax_year", "billing_key", "billing_kind", "taxpayer_name", "care_of", "mailing_address", "total_tax", "due_date", "delinquent_date", "header_identifiers", "lines", "unsure_fields"],
    additionalProperties: false,
  },
};

export const TAX_SEGMENT_PROMPT = (firstPage: number, count: number) =>
  `These are pages ${firstPage} to ${firstPage + count - 1} of a file of property tax statements. For EVERY page, record the statement header printed on it. The billing_key is the number the county bills on (an account number covering several parcels, else a receipt, bill, or key number, else the parcel number), exactly as printed. total_tax is the statement's total, which whole-account bills repeat on every page. ${HANDWRITING_RULE}`;

export const TAX_STATEMENT_PROMPT =
  `These pages are ONE property tax statement (it may be several pages, a photo, or a scan). Record the header and EVERY parcel line printed on it. For each line capture EVERY labeled number exactly as printed as an identifier pair (label as printed, best-guess kind, value). Unrecognized labels keep kind 'other' with the label. Mark business personal property lines as personal_property. Keep the taxpayer name exactly as printed, including any C/O. Dates as YYYY-MM-DD, dollars as plain numbers. ${HANDWRITING_RULE} List every field you are unsure about in unsure_fields.`;
