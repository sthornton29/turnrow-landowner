// Personal property bills: business contents and equipment, taxed to an
// owner on a county account and never to a parcel. They have no land to
// hang on, so they are followed by ACCOUNT instead: what the bill covers
// (a label the owner gives it once), its value and tax year over year,
// and whether this year's bill has come in. Pure, so the rules are
// tested without a screen.

import { normalizeIdentifier } from "@/lib/taxIdentifiers";

// A statement is a personal property bill when every line on it is one.
// A statement with no lines (a postcard bill) is not: nothing says so.
export function isPersonalPropertyStatement(lines: Array<{ line_type: string }>): boolean {
  return lines.length > 0 && lines.every((l) => l.line_type === "personal_property");
}

const countyKey = (name: string | null | undefined) =>
  (name ?? "").trim().toLowerCase().replace(/\s+county$/, "");

// One county account however it was printed or typed: "Lawrence" and
// "lawrence county" are one county, "001234" and "1234" one account.
// Null when the bill prints no account number. The state is left out on
// purpose: older statements were saved without one, and a second county
// of the same name with the same account number is not a real risk.
export function taxAccountKey(s: { county: string | null | undefined; account_number: string | null | undefined }): string | null {
  const account = normalizeIdentifier(s.account_number);
  const county = countyKey(s.county);
  if (!account || !county) return null;
  return `${county}|${account}`;
}

interface LabeledStatement {
  county: string | null;
  account_number: string | null;
  tax_year: number;
  label?: string | null;
}

// The label an account already carries: the newest statement on that
// account that has one. Null when the account has never been labeled.
export function labelForAccount(
  statements: LabeledStatement[],
  target: { county: string | null | undefined; account_number: string | null | undefined }
): string | null {
  const key = taxAccountKey(target);
  if (!key) return null;
  let best: LabeledStatement | null = null;
  for (const s of statements) {
    if (!(s.label ?? "").trim() || taxAccountKey(s) !== key) continue;
    if (!best || s.tax_year > best.tax_year) best = s;
  }
  return best ? (best.label as string).trim() : null;
}

export interface PersonalPropertyStatement extends LabeledStatement {
  id: string;
  state?: string | null;
  account_kind?: string | null;
  taxpayer_name_printed: string | null;
  entity_id: string | null;
}

export interface PersonalPropertyLine {
  tax_statement_id: string;
  tax_year: number;
  line_type: string;
  tax_due: number;
  appraised_value: number | null;
}

export interface PersonalPropertyRow {
  // The account key, or "statement:<id>" for a bill that prints no account.
  key: string;
  county: string | null;
  account_number: string | null;
  account_kind: string | null;
  label: string | null;
  entity_id: string | null;
  taxpayer: string | null;
  // This year's statement, tax, and value; all null when it is missing.
  statementId: string | null;
  tax: number | null;
  appraised: number | null;
  // The most recent earlier year the account was billed.
  priorYear: number | null;
  priorTax: number | null;
  priorAppraised: number | null;
  // Billed last year and nothing on file for this one.
  missing: boolean;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

// The personal property accounts to show for one tax year: every account
// with a personal property line that year, plus every account that had
// one the year before and has none now (the bill that has not come in,
// or was never uploaded). A parcel missing from a year's statements is
// caught by parcel coverage; nothing else would catch these.
export function personalPropertyAccounts(
  statements: PersonalPropertyStatement[],
  lines: PersonalPropertyLine[],
  year: number
): PersonalPropertyRow[] {
  const stmtById = new Map(statements.map((s) => [s.id, s]));
  interface YearCell {
    statement: PersonalPropertyStatement;
    tax: number;
    appraised: number | null;
  }
  const accounts = new Map<string, Map<number, YearCell>>();
  for (const l of lines) {
    if (l.line_type !== "personal_property") continue;
    const s = stmtById.get(l.tax_statement_id);
    if (!s) continue;
    const key = taxAccountKey(s) ?? `statement:${s.id}`;
    const years = accounts.get(key) ?? new Map<number, YearCell>();
    const cell = years.get(l.tax_year) ?? { statement: s, tax: 0, appraised: null };
    cell.tax = r2(cell.tax + (Number(l.tax_due) || 0));
    if (l.appraised_value !== null && l.appraised_value !== undefined) {
      cell.appraised = r2((cell.appraised ?? 0) + Number(l.appraised_value));
    }
    years.set(l.tax_year, cell);
    accounts.set(key, years);
  }

  const rows: PersonalPropertyRow[] = [];
  for (const [key, years] of accounts) {
    const current = years.get(year) ?? null;
    const priorYear = Array.from(years.keys())
      .filter((y) => y < year)
      .sort((a, b) => b - a)[0];
    const prior = priorYear !== undefined ? years.get(priorYear)! : null;
    // A bill that prints no account cannot be followed from year to year,
    // so it is never called missing.
    const missing = !current && !!prior && priorYear === year - 1 && !key.startsWith("statement:");
    if (!current && !missing) continue;
    const s = (current ?? prior)!.statement;
    rows.push({
      key,
      county: s.county,
      account_number: s.account_number,
      account_kind: s.account_kind ?? null,
      label: (s.label ?? "").trim() || labelForAccount(statements, s),
      entity_id: s.entity_id,
      taxpayer: s.taxpayer_name_printed,
      statementId: current ? current.statement.id : null,
      tax: current ? current.tax : null,
      appraised: current ? current.appraised : null,
      priorYear: prior ? priorYear! : null,
      priorTax: prior ? prior.tax : null,
      priorAppraised: prior ? prior.appraised : null,
      missing,
    });
  }
  const name = (r: PersonalPropertyRow) => `${countyKey(r.county)}|${(r.label ?? "").toLowerCase()}|${r.account_number ?? ""}`;
  // The bills still to come in first, then by county and label.
  return rows.sort((a, b) => Number(b.missing) - Number(a.missing) || name(a).localeCompare(name(b)));
}

// The other statements of one account whose label is not `label` yet:
// saving a label keeps every year of the account the same.
export function statementsToRelabel<T extends { id: string; county: string | null; account_number: string | null; label?: string | null }>(
  statements: T[],
  target: { id: string; county: string | null; account_number: string | null },
  label: string | null
): string[] {
  const key = taxAccountKey(target);
  const want = (label ?? "").trim();
  if (!key) return [];
  return statements
    .filter((s) => s.id !== target.id && taxAccountKey(s) === key && (s.label ?? "").trim() !== want)
    .map((s) => s.id);
}
