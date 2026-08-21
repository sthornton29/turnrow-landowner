import { normalizeFsaExtraction } from "@/lib/gov/fsaImport";
import { formatDollars } from "@/lib/format";
import { DOC_TYPE_LABELS, scanKindFor, type DocType } from "@/lib/documents";
import type { DocumentRow } from "@/types/db";

// Document titles, one generator for the intake fallback, the rescan,
// and the backfill review. Patterns per type, with pieces dropping
// cleanly when a field is missing:
//   Warranty Deed - Smith to Jones (2014)
//   Survey Plat - River Place, 120.0 acres (2009)
//   FSA-156EZ - Farm 1234 (2024)
//   Title Insurance - River Place ($250,000.00, 2014)
//   Wetland Determination - Tract 812 (2019)
//   Appraisal - Smith Farm (2021)
// With nothing extracted: "<Type label> - <cleaned file name>".

function s(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}

function n(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

// A four-digit year out of an ISO date, a US date, or loose text.
export function yearOf(v: unknown): string | null {
  const t = s(v);
  if (!t) return null;
  const m = t.match(/\b(18|19|20)\d{2}\b/);
  return m ? m[0] : null;
}

// "my_deed-2014 (scan).PDF" -> "my deed 2014 (scan)".
export function cleanFileName(fileName: string): string {
  return fileName
    .replace(/\.[A-Za-z0-9]{1,5}$/, "")
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Shorten a party name for a title: first party only, trimmed.
function party(v: unknown): string | null {
  const t = s(v);
  if (!t) return null;
  const first = t.split(/;|\band\b|&|,/)[0]?.trim() || t;
  return first.length > 40 ? first.slice(0, 37).trimEnd() + "..." : first;
}

function withYear(body: string | null, year: string | null): string | null {
  if (body && year) return `${body} (${year})`;
  if (body) return body;
  if (year) return `(${year})`;
  return null;
}

function titleCase(label: string): string {
  return label
    .split(" ")
    .map((w) => (w.length > 2 && w === w.toLowerCase() ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export function proposeTitle(
  docType: DocType,
  extracted: Record<string, unknown> | null | undefined,
  fileName: string,
  opts: { uploadedAt?: string | null; propertyName?: string | null } = {}
): string {
  const label = DOC_TYPE_LABELS[docType] ?? "Document";
  const prefix =
    docType === "fsa_156ez" ? "FSA-156EZ" : docType === "title_insurance" ? "Title Insurance" : titleCase(label);
  const e = extracted ?? {};
  const fallbackYear = yearOf(opts.uploadedAt);
  let body: string | null = null;
  let year: string | null = null;
  let yearInside = false;
  switch (scanKindFor(docType)) {
    case "deed": {
      const from = party(e.grantor);
      const to = party(e.grantee);
      body = from && to ? `${from} to ${to}` : (from ?? to);
      year = yearOf(e.execution_date) ?? yearOf(e.recording_date);
      break;
    }
    case "survey": {
      const who = opts.propertyName ?? party(e.surveyor);
      const acres = n(e.stated_acres);
      const parts = [
        who,
        acres !== null
          ? `${acres.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} acres`
          : null,
      ].filter(Boolean);
      body = parts.length ? parts.join(", ") : null;
      year = yearOf(e.survey_date);
      break;
    }
    case "title_insurance": {
      const who = opts.propertyName ?? party(e.insurer);
      const amt = n(e.policy_amount);
      const y = yearOf(e.policy_date);
      const inner = [amt !== null ? formatDollars(amt) : null, y].filter(Boolean).join(", ");
      body = who ? (inner ? `${who} (${inner})` : who) : inner ? `(${inner})` : null;
      yearInside = true;
      break;
    }
    case "fsa_156ez": {
      const farms = normalizeFsaExtraction(e)
        .map((f) => s(f.farm_number))
        .filter(Boolean) as string[];
      if (farms.length === 1) body = `Farm ${farms[0]}`;
      else if (farms.length > 1) body = `Farms ${farms.slice(0, 4).join(", ")}${farms.length > 4 ? "..." : ""}`;
      year = yearOf(e.program_year) ?? yearOf(e.document_date);
      break;
    }
    case "determination": {
      const tract = s(e.tract);
      body = tract ? `Tract ${tract}` : null;
      year = yearOf(e.determination_date);
      break;
    }
    default: {
      body = opts.propertyName ?? party(e.parties) ?? s(e.title);
      year = yearOf(e.document_date);
    }
  }
  const main = yearInside ? body : withYear(body, year ?? (body ? fallbackYear : null));
  return `${prefix} - ${main ?? cleanFileName(fileName)}`;
}

// What every list, chip, and header shows for a document.
export function displayTitle(doc: Pick<DocumentRow, "title" | "file_name">): string {
  const t = (doc.title ?? "").trim();
  return t || cleanFileName(doc.file_name);
}

// The title pattern text shared with the AI prompt so its proposals
// match what the app generates.
export const TITLE_PATTERN_HINT =
  "Title pattern by type: deeds 'Warranty Deed - <grantor> to <grantee> (<year>)'; " +
  "plats 'Survey Plat - <property or surveyor>, <acres> acres (<year>)'; " +
  "FSA-156EZ 'FSA-156EZ - Farm <number> (<year>)'; " +
  "title insurance 'Title Insurance - <property or insurer> ($<amount>, <year>)'; " +
  "determinations '<Type> - Tract <tract> (<year>)'; anything else '<Type> - <parties or subject> (<year>)'. " +
  "Drop any piece that is not stated; never invent one.";
