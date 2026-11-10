// INCOME RECORDS (migration 0051): labels and the summaries the Income
// records page shows. Shared by server pages and client components (keep
// labels out of "use client" files: exported constants there reach a
// server page as client references).

export const INCOME_RECORD_TYPES = [
  "farmland_cash_rent",
  "share_rent",
  "hunting",
  "timber",
  "solar",
  "tower",
  "commercial_rent",
  "government",
  "other",
] as const;
export type IncomeRecordType = (typeof INCOME_RECORD_TYPES)[number];

export const INCOME_RECORD_TYPE_LABELS: Record<IncomeRecordType, string> = {
  farmland_cash_rent: "Farm rent (cash)",
  share_rent: "Farm rent (crop share)",
  hunting: "Hunting",
  timber: "Timber",
  solar: "Solar",
  tower: "Tower",
  commercial_rent: "Building rent",
  government: "Government payment",
  other: "Other",
};

export const BASIS_LABELS: Record<string, string> = {
  received: "Received",
  accrued: "Owed (invoice or settlement)",
  calculated: "Calculated, not confirmed paid",
};

export interface IncomeRecordRow {
  id: string;
  year: number;
  received_date: string | null;
  period: string | null;
  payer: string | null;
  payee_name: string | null;
  entity_id: string | null;
  property_id: string | null;
  income_type: string;
  amount: number;
  basis: string;
  confidence: string | null;
  needs_review: boolean;
  source: string | null;
  notes: string | null;
}

// Year x type totals for the records in view, newest year first.
export function totalsByYear(rows: Array<Pick<IncomeRecordRow, "year" | "income_type" | "amount">>) {
  const map = new Map<number, { year: number; total: number; byType: Map<string, number> }>();
  for (const r of rows) {
    const cur = map.get(r.year) ?? { year: r.year, total: 0, byType: new Map<string, number>() };
    cur.total += Number(r.amount);
    cur.byType.set(r.income_type, (cur.byType.get(r.income_type) ?? 0) + Number(r.amount));
    map.set(r.year, cur);
  }
  return Array.from(map.values()).sort((a, b) => b.year - a.year);
}
