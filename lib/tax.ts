// Property tax domain logic: parcel number normalization and matching,
// due/delinquent date defaults, and computed statement status.

import { formatDate } from "@/lib/format";
import { canonicalParcel } from "@/lib/parcelNumber";

// The statement HEADER (migration 0030): how the county billed it. The
// parcels it covers are tax_statement_lines; amount_due is the total.
export interface TaxStatementRow {
  id: string;
  tax_year: number;
  county: string | null;
  state: string | null;
  authority_name: string | null;
  account_number: string | null;
  account_kind: "account_number" | "receipt_number" | "key_number" | "parcel_number" | "bill_number" | "other" | null;
  taxpayer_name_printed: string | null;
  care_of_printed: string | null;
  entity_id: string | null;
  entity_evidence: string | null;
  source_document_id: string | null;
  amount_due: number;
  line_total: number | null;
  reconciled: boolean;
  due_date: string | null;
  delinquent_date: string | null;
  notes: string | null;
}

export interface TaxStatementLineRow {
  id: string;
  tax_statement_id: string;
  line_no: number;
  tax_year: number;
  line_type: "real_property" | "personal_property";
  identifiers: Array<{ label: string | null; kind: string; value: string; normalized: string }>;
  appraised_value: number | null;
  assessed_value: number | null;
  // Filled where the bill prints them (migration 0050, uploads and the
  // re-read); absent on rows loaded before then.
  market_value?: number | null;
  current_use_value?: number | null;
  tax_due: number;
  exemptions: string | null;
  legal_description: string | null;
  property_address: string | null;
  acres: number | null;
  parcel_id: string | null;
  match_source: "identifier" | "manual" | "name" | "spatial" | "migrated" | null;
  match_evidence: string | null;
  confirmed: boolean;
}

// A payment is applied at the statement level; its expense is spread
// across the statement's lines by their share of the line total (the
// header total when lines do not reconcile), so parcels and properties
// carry their part. Personal property lines carry their share too
// (attributed to the entity, never to a parcel).
export function allocateByLines<T extends { id: string; tax_due: number }>(
  amount: number,
  lines: T[]
): Map<string, number> {
  const out = new Map<string, number>();
  const total = lines.reduce((a, l) => a + (Number(l.tax_due) || 0), 0);
  if (lines.length === 0) return out;
  if (total <= 0) {
    const each = amount / lines.length;
    for (const l of lines) out.set(l.id, each);
    return out;
  }
  for (const l of lines) out.set(l.id, (amount * (Number(l.tax_due) || 0)) / total);
  return out;
}

// The total a statement's payments are spread over: EVERY line on the
// statement, including lines this viewer cannot see (row level security
// hides unmatched and personal property lines from 'user' members, and a
// payment spread over only the visible lines would overstate them). The
// stored line_total is that sum; the statement total stands in when it
// is missing. Never less than the lines actually in view.
export function allocationBasis(
  statement: { amount_due: number; line_total?: number | null } | null | undefined,
  visibleLineTotal: number
): number {
  const stored = Number(statement?.line_total) > 0 ? Number(statement?.line_total) : Number(statement?.amount_due) || 0;
  return Math.max(stored, visibleLineTotal);
}

export interface TaxPaymentRow {
  id: string;
  tax_statement_id: string;
  paid_date: string;
  amount: number;
  method: string | null;
  memo: string | null;
}

export interface CountyDefault {
  county: string;
  state: string;
  due_month: number;
  due_day: number;
  delinquent_month: number;
  delinquent_day: number;
}

// ---------------------------------------------------------------- matching

// Normalize a parcel number for comparison: uppercase, strip everything
// that isn't a letter or digit, and drop leading zeros from digit runs so
// "22-05-0034.001" matches "22 5 34 1" style variants.
// Canonical parcel number (lib/parcelNumber.ts): punctuation-agnostic,
// leading zeros dropped, and the trailing sub-parcel zero that tax
// statements print ("003.000-0") ignored, so a statement matches the
// parcel as the county GIS stored it.
export function normalizeParcelNumber(raw: string | null | undefined): string {
  return canonicalParcel(raw);
}

export function matchParcel<T extends { id: string; parcel_number: string }>(
  printed: string | null | undefined,
  parcels: T[]
): T | null {
  const target = normalizeParcelNumber(printed);
  if (!target) return null;
  return parcels.find((p) => normalizeParcelNumber(p.parcel_number) === target) ?? null;
}

// ---------------------------------------------------------------- dates

export const ALABAMA_DEFAULT: Omit<CountyDefault, "county" | "state"> = {
  due_month: 10,
  due_day: 1,
  delinquent_month: 1,
  delinquent_day: 1,
};

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// Due and delinquent dates for a tax year. A delinquent month at or before
// the due month means it falls in the following calendar year (Alabama:
// due Oct 1 of the tax year, delinquent Jan 1 of the next).
export function defaultDates(
  taxYear: number,
  county: string | null | undefined,
  state: string | null | undefined,
  defaults: CountyDefault[]
): { due_date: string; delinquent_date: string } {
  const c = (county ?? "").trim().toLowerCase();
  const s = (state ?? "").trim().toLowerCase();
  const row =
    defaults.find(
      (d) => d.county.toLowerCase() === c && (d.state ?? "").toLowerCase() === s
    ) ??
    defaults.find((d) => d.county.toLowerCase() === c) ??
    null;
  const cfg = row ?? { ...ALABAMA_DEFAULT };
  const delinquentYear =
    cfg.delinquent_month <= cfg.due_month ? taxYear + 1 : taxYear;
  return {
    due_date: iso(taxYear, cfg.due_month, cfg.due_day),
    delinquent_date: iso(delinquentYear, cfg.delinquent_month, cfg.delinquent_day),
  };
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// delinquent_date is the FIRST delinquent day, so the last day to pay on
// time is the day before it (Alabama: delinquent Jan 1, pay by Dec 31).
export function lastDayToPay(delinquentDate: string): string {
  const m = ISO_DATE.exec(delinquentDate);
  if (!m) return delinquentDate;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) - 1));
  return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

// A tax year a person could mean (not a half-typed "202").
export function plausibleTaxYear(year: number | null | undefined): year is number {
  return typeof year === "number" && Number.isInteger(year) && year >= 1900 && year <= 2100;
}

// Do a statement's dates agree with its tax year? Returns a plain
// sentence saying what is wrong, or null. The due date must fall in the
// tax year or the year after (some states bill the following year) and
// the delinquent date must come after it. Blank dates are not checked.
export function statementDateProblem(
  taxYear: number,
  dueDate: string | null | undefined,
  delinquentDate: string | null | undefined
): string | null {
  const due = dueDate && ISO_DATE.test(dueDate) ? dueDate : null;
  const delinquent = delinquentDate && ISO_DATE.test(delinquentDate) ? delinquentDate : null;
  if (due) {
    const y = Number(due.slice(0, 4));
    if (y !== taxYear && y !== taxYear + 1) {
      return `The due date (${formatDate(due)}) is not in tax year ${taxYear} or the year after.`;
    }
  }
  if (due && delinquent && delinquent <= due) {
    return `The delinquent date (${formatDate(delinquent)}) is not after the due date (${formatDate(due)}).`;
  }
  if (delinquent) {
    const y = Number(delinquent.slice(0, 4));
    if (y < taxYear || y > taxYear + 2) {
      return `The delinquent date (${formatDate(delinquent)}) does not fit tax year ${taxYear}.`;
    }
  }
  return null;
}

// The due and delinquent dates a statement draft shows for a tax year.
// Dates read from the bill are kept only when they agree with the tax
// year: many bills print "due October 1" with no year, so the year in a
// date the reader returns can be a guess. When they do not agree, the
// county's calendar for the tax year is used instead and the note says
// so, for the review screen to show. Called again whenever the tax year
// changes, so the dates always follow the year.
export function draftDates(
  taxYear: number | null | undefined,
  read: { due_date?: string | null; delinquent_date?: string | null },
  county: string | null | undefined,
  state: string | null | undefined,
  defaults: CountyDefault[]
): { due_date: string; delinquent_date: string; note: string | null } {
  const readDue = read.due_date && ISO_DATE.test(read.due_date) ? read.due_date : null;
  const readDelinquent = read.delinquent_date && ISO_DATE.test(read.delinquent_date) ? read.delinquent_date : null;
  // No tax year yet: show what the bill printed, if anything.
  if (!plausibleTaxYear(taxYear)) return { due_date: readDue ?? "", delinquent_date: readDelinquent ?? "", note: null };
  const derived = defaultDates(taxYear, county, state, defaults);
  if (!readDue && !readDelinquent) return { ...derived, note: null };
  const candidate = { due_date: readDue ?? derived.due_date, delinquent_date: readDelinquent ?? derived.delinquent_date };
  if (!statementDateProblem(taxYear, candidate.due_date, candidate.delinquent_date)) return { ...candidate, note: null };
  const printed = [readDue ? `due ${formatDate(readDue)}` : null, readDelinquent ? `delinquent ${formatDate(readDelinquent)}` : null]
    .filter(Boolean)
    .join(", ");
  return {
    ...derived,
    note: `The dates read from the bill (${printed}) do not fit tax year ${taxYear}, so the county's usual dates are shown. Check the tax year and the dates.`,
  };
}

// ---------------------------------------------------------------- status

export type TaxStatus = "paid" | "partial" | "unpaid" | "delinquent";

export const TAX_STATUS_LABELS: Record<TaxStatus, string> = {
  paid: "Paid",
  partial: "Partially paid",
  unpaid: "Unpaid",
  delinquent: "Delinquent",
};

export const TAX_STATUS_CLASSES: Record<TaxStatus, string> = {
  paid: "bg-kelly-50 text-pine-900",
  partial: "bg-amber-50 text-amber-800",
  unpaid: "bg-gray-100 text-gray-600",
  delinquent: "bg-red-50 text-red-700",
};

export function taxStatus(
  statement: Pick<TaxStatementRow, "amount_due" | "delinquent_date">,
  paidTotal: number,
  today: Date = new Date()
): TaxStatus {
  // A statement for $0.00 has nothing to pay, so it can never be late.
  if (statement.amount_due <= 0.005) return "paid";
  if (paidTotal >= statement.amount_due - 0.005) return "paid";
  const pastDelinquent =
    statement.delinquent_date &&
    new Date(statement.delinquent_date + "T00:00:00") <= today;
  if (pastDelinquent) return "delinquent";
  if (paidTotal > 0) return "partial";
  return "unpaid";
}
