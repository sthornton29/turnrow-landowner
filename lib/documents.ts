import { normalizeFsaExtraction } from "@/lib/gov/fsaImport";
import { formatAcres, formatDollars } from "@/lib/format";

// Single source of truth for the document vault: the doc_type taxonomy
// (mirrors the check constraint in migration 0020), its groups, which
// types can be scanned with which extraction, which can plot a boundary,
// the per-scan review form, and the short highlight lines list rows show.

export type DocType =
  | "deed_warranty"
  | "deed_quitclaim"
  | "deed_timber"
  | "deed_mineral"
  | "title_insurance"
  | "title_opinion"
  | "closing_statement"
  | "probate_estate"
  | "survey_plat"
  | "legal_description"
  | "easement_deed"
  | "mortgage_dot"
  | "lien_release"
  | "fsa_156ez"
  | "fsa_map"
  | "crp_contract"
  | "nrcs_conservation_plan"
  | "wetland_determination"
  | "hel_determination"
  | "appraisal"
  | "timber_cruise"
  | "management_plan"
  | "soil_survey"
  | "insurance_policy"
  | "hunting_agreement"
  | "current_use_application"
  | "other";

export type DocGroup =
  | "title"
  | "survey"
  | "encumbrance"
  | "government"
  | "valuation"
  | "agreements"
  | "other";

export const DOC_GROUP_LABELS: Record<DocGroup, string> = {
  title: "Title & ownership",
  survey: "Surveys & legal",
  encumbrance: "Encumbrances & debt",
  government: "Government & conservation",
  valuation: "Valuation & management",
  agreements: "Insurance & agreements",
  other: "Other",
};

export const DOC_GROUPS = Object.keys(DOC_GROUP_LABELS) as DocGroup[];

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  deed_warranty: "Warranty deed",
  deed_quitclaim: "Quitclaim deed",
  deed_timber: "Timber deed",
  deed_mineral: "Mineral deed",
  title_insurance: "Title insurance policy",
  title_opinion: "Title opinion",
  closing_statement: "Closing statement",
  probate_estate: "Probate / estate record",
  survey_plat: "Survey plat",
  legal_description: "Legal description",
  easement_deed: "Easement deed",
  mortgage_dot: "Deed of trust / mortgage",
  lien_release: "Lien release",
  fsa_156ez: "FSA-156EZ",
  fsa_map: "FSA map",
  crp_contract: "CRP contract",
  nrcs_conservation_plan: "NRCS conservation plan",
  wetland_determination: "Wetland determination",
  hel_determination: "HEL determination",
  appraisal: "Appraisal",
  timber_cruise: "Timber cruise",
  management_plan: "Management plan",
  soil_survey: "Soil survey",
  insurance_policy: "Insurance policy",
  hunting_agreement: "Hunting agreement",
  current_use_application: "Current use application",
  other: "Other",
};

export const DOC_TYPE_GROUP: Record<DocType, DocGroup> = {
  deed_warranty: "title",
  deed_quitclaim: "title",
  deed_timber: "title",
  deed_mineral: "title",
  title_insurance: "title",
  title_opinion: "title",
  closing_statement: "title",
  probate_estate: "title",
  survey_plat: "survey",
  legal_description: "survey",
  easement_deed: "encumbrance",
  mortgage_dot: "encumbrance",
  lien_release: "encumbrance",
  fsa_156ez: "government",
  fsa_map: "government",
  crp_contract: "government",
  nrcs_conservation_plan: "government",
  wetland_determination: "government",
  hel_determination: "government",
  appraisal: "valuation",
  timber_cruise: "valuation",
  management_plan: "valuation",
  soil_survey: "valuation",
  insurance_policy: "agreements",
  hunting_agreement: "agreements",
  current_use_application: "agreements",
  other: "other",
};

// Taxonomy order (group order, then the order above within a group).
export const DOC_TYPES = Object.keys(DOC_TYPE_LABELS) as DocType[];

export const DOC_TYPES_BY_GROUP: Record<DocGroup, DocType[]> = DOC_GROUPS.reduce(
  (acc, g) => {
    acc[g] = DOC_TYPES.filter((t) => DOC_TYPE_GROUP[t] === g);
    return acc;
  },
  {} as Record<DocGroup, DocType[]>
);

export function docTypeLabel(t: string | null | undefined): string {
  return DOC_TYPE_LABELS[(t ?? "other") as DocType] ?? "Other";
}

export function docGroupOf(t: string | null | undefined): DocGroup {
  return DOC_TYPE_GROUP[(t ?? "other") as DocType] ?? "other";
}

// Which /api/extract kind scans a document of this type.
export type ScanKind =
  | "deed"
  | "survey"
  | "title_insurance"
  | "fsa_156ez"
  | "determination"
  | "generic";

export function scanKindFor(docType: DocType): ScanKind | null {
  switch (docType) {
    case "deed_warranty":
    case "deed_quitclaim":
    case "deed_timber":
    case "deed_mineral":
    case "easement_deed":
      return "deed";
    case "survey_plat":
    case "legal_description":
      return "survey";
    case "title_insurance":
    case "title_opinion":
      return "title_insurance";
    case "fsa_156ez":
      return "fsa_156ez";
    case "wetland_determination":
    case "hel_determination":
      return "determination";
    default:
      return "generic";
  }
}

// Deeds, plats, and legal descriptions can feed the boundary plotter.
const PLOTTABLE: ReadonlySet<DocType> = new Set<DocType>([
  "deed_warranty",
  "deed_quitclaim",
  "deed_timber",
  "deed_mineral",
  "survey_plat",
  "legal_description",
  "easement_deed",
]);

export function canPlotBoundary(docType: DocType): boolean {
  return PLOTTABLE.has(docType);
}

export interface ExtractedFieldDef {
  key: string;
  label: string;
  input: "text" | "number" | "date" | "textarea" | "table" | "farms";
  columns?: Array<{ key: string; label: string }>;
}

// The review form per scan kind. Keys match the /api/extract tool
// schemas exactly so unsure_fields maps 1:1 onto amber inputs.
export const EXTRACTED_FIELDS: Record<ScanKind, ExtractedFieldDef[]> = {
  deed: [
    { key: "grantor", label: "Grantor (from)", input: "text" },
    { key: "grantee", label: "Grantee (to)", input: "text" },
    { key: "execution_date", label: "Execution date", input: "date" },
    { key: "recording_date", label: "Recording date", input: "date" },
    { key: "recording_ref", label: "Recording reference (book/page or instrument)", input: "text" },
    { key: "consideration", label: "Consideration (if stated)", input: "number" },
    { key: "county", label: "County", input: "text" },
    { key: "state", label: "State", input: "text" },
    { key: "parcel_refs", label: "Parcel references", input: "text" },
    { key: "legal_description", label: "Legal description (verbatim)", input: "textarea" },
  ],
  survey: [
    { key: "surveyor", label: "Surveyor", input: "text" },
    { key: "survey_date", label: "Survey date", input: "date" },
    { key: "stated_acres", label: "Stated acres", input: "number" },
    { key: "recording_ref", label: "Recording reference", input: "text" },
    { key: "legal_description", label: "Legal description (verbatim)", input: "textarea" },
  ],
  title_insurance: [
    { key: "insurer", label: "Insurer", input: "text" },
    { key: "policy_number", label: "Policy number", input: "text" },
    { key: "policy_amount", label: "Policy amount", input: "number" },
    { key: "policy_date", label: "Policy date", input: "date" },
    {
      key: "exceptions",
      label: "Exceptions (Schedule B)",
      input: "table",
      columns: [
        { key: "item", label: "Item" },
        { key: "description", label: "Description" },
      ],
    },
  ],
  fsa_156ez: [
    // A 156EZ document or packet holds one or more farms; the review
    // renders one card per farm (scalars + its base acres grid).
    {
      key: "farms",
      label: "Farms in this document",
      input: "farms",
      columns: [
        { key: "commodity", label: "Commodity" },
        { key: "base_acres", label: "Base acres" },
        { key: "plc_yield", label: "PLC yield" },
      ],
    },
  ],
  determination: [
    { key: "tract", label: "Tract", input: "text" },
    { key: "determination_codes", label: "Determination codes", input: "text" },
    { key: "determination_date", label: "Determination date", input: "date" },
    { key: "notes", label: "Notes", input: "textarea" },
  ],
  generic: [
    { key: "title", label: "Title", input: "text" },
    { key: "parties", label: "Parties", input: "text" },
    { key: "document_date", label: "Document date", input: "date" },
    { key: "amount", label: "Amount", input: "number" },
    { key: "reference", label: "Reference number", input: "text" },
    { key: "summary", label: "Summary", input: "textarea" },
  ],
};

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Short lines for a document row in lists: the fields owners actually
// scan for. Empty when nothing has been extracted.
export function extractedHighlights(
  docType: DocType,
  extracted: Record<string, unknown> | null | undefined
): string[] {
  if (!extracted) return [];
  const out: string[] = [];
  const push = (label: string, v: string | null) => {
    if (v) out.push(`${label}: ${v}`);
  };
  const kind = scanKindFor(docType);
  switch (kind) {
    case "deed": {
      push("Grantor", str(extracted.grantor));
      push("Grantee", str(extracted.grantee));
      push("Rec.", str(extracted.recording_ref));
      const c = num(extracted.consideration);
      if (c !== null) out.push(`Consideration ${formatDollars(c)}`);
      push("Recorded", str(extracted.recording_date));
      break;
    }
    case "survey": {
      push("Surveyor", str(extracted.surveyor));
      const a = num(extracted.stated_acres);
      if (a !== null) out.push(`${formatAcres(a)} acres stated`);
      push("Dated", str(extracted.survey_date));
      push("Rec.", str(extracted.recording_ref));
      break;
    }
    case "title_insurance": {
      push("Insurer", str(extracted.insurer));
      const amt = num(extracted.policy_amount);
      if (amt !== null) out.push(`Policy ${formatDollars(amt)}`);
      push("Policy", str(extracted.policy_number));
      const ex = Array.isArray(extracted.exceptions) ? extracted.exceptions.length : 0;
      if (ex > 0) out.push(`${ex} exception${ex === 1 ? "" : "s"}`);
      break;
    }
    case "fsa_156ez": {
      const farms = normalizeFsaExtraction(extracted);
      const numbers = farms.map((f) => String(f.farm_number ?? "").trim()).filter(Boolean);
      if (farms.length > 1) {
        out.push(`${farms.length} farms: ${numbers.slice(0, 6).join(", ")}${numbers.length > 6 ? "..." : ""}`);
      } else {
        push("Farm", numbers[0] ?? null);
        const crop = num(farms[0]?.cropland_acres);
        if (crop !== null) out.push(`${formatAcres(crop)} cropland acres`);
      }
      let total = 0;
      let rows = 0;
      for (const f of farms) {
        for (const r of f.base_acres ?? []) {
          total += num(r.base_acres) ?? 0;
          rows += 1;
        }
      }
      if (rows > 0) out.push(`${formatAcres(total)} base acres (${rows} commodit${rows === 1 ? "y" : "ies"})`);
      break;
    }
    case "determination": {
      push("Tract", str(extracted.tract));
      push("Codes", str(extracted.determination_codes));
      push("Dated", str(extracted.determination_date));
      break;
    }
    default: {
      push("Parties", str(extracted.parties));
      const amt = num(extracted.amount);
      if (amt !== null) out.push(`Amount ${formatDollars(amt)}`);
      push("Dated", str(extracted.document_date));
      push("Ref", str(extracted.reference));
    }
  }
  return out;
}
