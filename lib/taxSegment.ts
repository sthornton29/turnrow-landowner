// Segmentation of an uploaded tax PDF into statements. The model reads
// every page's header (county, the billing key, taxpayer, year, printed
// total, continuation flag); this pure code groups consecutive pages
// that belong to one statement (a whole-account bill repeats its
// account number and total on every page) and pre-labels the entity
// from the account registry. Unit tested in taxSegment.test.ts.

import { normalizeIdentifier } from "@/lib/taxIdentifiers";

export interface PageHeader {
  page: number; // 1-based
  county: string | null;
  state: string | null;
  billing_key: string | null; // the number the county bills on
  billing_kind: string | null; // account_number | receipt_number | key_number | parcel_number | bill_number | other
  taxpayer_name: string | null;
  tax_year: number | null;
  total_tax: number | null;
  is_continuation: boolean;
  is_statement: boolean; // false for cover letters, envelopes, blank pages
}

export interface StatementGroup {
  key: string;
  pages: number[];
  county: string | null;
  state: string | null;
  billing_key: string | null;
  billing_kind: string | null;
  taxpayer_name: string | null;
  tax_year: number | null;
  total_tax: number | null;
  entity_id: string | null; // pre-label from the account registry
  entity_evidence: string | null;
}

export interface RegisteredAccount {
  county: string;
  state: string;
  account_number: string; // normalized
  entity_id: string;
  entity_name: string;
}

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

function groupKey(h: PageHeader): string | null {
  const key = normalizeIdentifier(h.billing_key);
  if (!key) return null;
  return `${norm(h.county)}|${norm(h.state)}|${key}|${h.tax_year ?? ""}`;
}

export function groupPages(
  headers: PageHeader[],
  registry: RegisteredAccount[] = []
): StatementGroup[] {
  const sorted = [...headers].sort((a, b) => a.page - b.page);
  const groups: StatementGroup[] = [];
  const byKey = new Map<string, StatementGroup>();
  let current: StatementGroup | null = null;
  for (const h of sorted) {
    if (!h.is_statement) {
      current = null;
      continue;
    }
    const key = groupKey(h);
    // A keyed page joins its statement wherever it sits (a whole-account
    // bill repeats the key on every page); an unkeyed continuation page
    // follows the page before it; an unkeyed first page is its own.
    let target: StatementGroup | null = null;
    if (key) target = byKey.get(key) ?? null;
    else if (h.is_continuation && current) target = current;
    if (!target) {
      target = {
        key: key ?? `page-${h.page}`,
        pages: [],
        county: h.county,
        state: h.state,
        billing_key: h.billing_key,
        billing_kind: h.billing_kind,
        taxpayer_name: h.taxpayer_name,
        tax_year: h.tax_year,
        total_tax: h.total_tax,
        entity_id: null,
        entity_evidence: null,
      };
      groups.push(target);
      if (key) byKey.set(key, target);
    }
    target.pages.push(h.page);
    // Fill gaps from later pages without overwriting what the first said.
    target.county ??= h.county;
    target.state ??= h.state;
    target.taxpayer_name ??= h.taxpayer_name;
    target.tax_year ??= h.tax_year;
    target.total_tax ??= h.total_tax;
    current = target;
  }
  for (const g of groups) {
    const acct = normalizeIdentifier(g.billing_key);
    const hit = registry.find(
      (r) => norm(r.county) === norm(g.county) && (!r.state || !g.state || norm(r.state) === norm(g.state)) && r.account_number === acct
    );
    if (hit) {
      g.entity_id = hit.entity_id;
      g.entity_evidence = `${g.billing_kind === "account_number" ? "Account" : "Number"} ${g.billing_key} is registered to ${hit.entity_name}`;
    }
  }
  return groups;
}

// Lines must sum to the header total within a cent.
export function reconcile(lineTotals: Array<number | null | undefined>, headerTotal: number | null | undefined): {
  lineTotal: number;
  gap: number | null;
  reconciled: boolean;
} {
  const lineTotal = Math.round(lineTotals.reduce<number>((a, v) => a + (Number(v) || 0), 0) * 100) / 100;
  if (headerTotal === null || headerTotal === undefined || !Number.isFinite(Number(headerTotal))) {
    return { lineTotal, gap: null, reconciled: false };
  }
  const gap = Math.round((Number(headerTotal) - lineTotal) * 100) / 100;
  return { lineTotal, gap, reconciled: Math.abs(gap) <= 0.01 };
}
