import * as XLSX from "xlsx";
import type { RateUnit, SettlementLine, StumpageRate } from "./leaseLogic";

// Logger/mill settlement spreadsheet ingestion. The AI maps the
// columns and product names (/api/extract kind=timber_settlement);
// everything numeric after that is DETERMINISTIC code in this file, so
// per-load rows collapse to per-product period lines the same way
// every time, and the math is unit-testable.

export type SheetCell = string | number | null;
export type SheetRow = SheetCell[];

// First sheet of an xlsx/xls workbook as a raw grid.
export function workbookToRows(data: ArrayBuffer | Uint8Array): SheetRow[] {
  const wb = XLSX.read(data, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: null,
  }) as SheetRow[];
}

export function csvToRows(text: string): SheetRow[] {
  const wb = XLSX.read(text, { type: "string" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: null,
  }) as SheetRow[];
}

// The mapping the AI returns for a settlement sheet: column indexes
// (0-based) plus how the sheet's product spellings map to product
// slugs. Sheets are either per-load detail (one row per scale ticket)
// or already per-product period summaries; collapseLoads handles both
// (a summary sheet just has one row per product).
export interface SettlementColumnMap {
  header_row: number; // 0-based index of the header row
  ticket?: number | null;
  date?: number | null;
  product: number;
  quantity: number;
  rate?: number | null;
  amount?: number | null;
  unit: RateUnit; // unit of the quantity column
  products: Array<{ raw: string; product: string; label: string }>;
}

const EXCEL_EPOCH_OFFSET_DAYS = 25569; // 1970-01-01 in Excel serial days

export function cellToIsoDate(cell: SheetCell): string | null {
  if (cell === null || cell === "") return null;
  if (typeof cell === "number") {
    // Excel serial date (plausible range ~1968..2064)
    if (cell < 25000 || cell > 60000) return null;
    const ms = Math.round((cell - EXCEL_EPOCH_OFFSET_DAYS) * 86400 * 1000);
    return new Date(ms).toISOString().slice(0, 10);
  }
  const parsed = new Date(String(cell));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function cellToNumber(cell: SheetCell): number | null {
  if (cell === null || cell === "") return null;
  if (typeof cell === "number") return cell;
  const n = Number(String(cell).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function slugifyProduct(raw: string): string {
  return raw.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// Collapse per-load rows to one settlement line per product, keeping
// the load count and date range. Rows whose product cell is empty or
// whose quantity is not numeric (totals rows, blank separators) are
// skipped. The line's rate is the weighted average actually paid
// (dollars / quantity), so mixed-rate periods stay honest.
export function collapseLoads(
  rows: SheetRow[],
  map: SettlementColumnMap
): SettlementLine[] {
  const productBySpelling = new Map(
    map.products.map((p) => [p.raw.toLowerCase().trim(), p])
  );
  const groups = new Map<
    string,
    {
      label: string;
      quantity: number;
      amount: number;
      loads: number;
      dates: string[];
      hasAmount: boolean;
    }
  >();

  for (const row of rows.slice(map.header_row + 1)) {
    const rawProduct = row[map.product];
    if (rawProduct === null || String(rawProduct).trim() === "") continue;
    const quantity = cellToNumber(row[map.quantity]);
    if (quantity === null || quantity <= 0) continue;

    const spelling = String(rawProduct).toLowerCase().trim();
    const mapped = productBySpelling.get(spelling);
    const slug = mapped?.product ?? slugifyProduct(String(rawProduct));
    const label = mapped?.label ?? String(rawProduct).trim();

    const rate = map.rate != null ? cellToNumber(row[map.rate]) : null;
    const amountCell = map.amount != null ? cellToNumber(row[map.amount]) : null;
    const amount =
      amountCell !== null ? amountCell : rate !== null ? quantity * rate : 0;

    const date = map.date != null ? cellToIsoDate(row[map.date]) : null;
    const group = groups.get(slug) ?? {
      label,
      quantity: 0,
      amount: 0,
      loads: 0,
      dates: [],
      hasAmount: false,
    };
    group.quantity += quantity;
    group.amount += amount;
    group.loads += 1;
    group.hasAmount = group.hasAmount || amountCell !== null || rate !== null;
    if (date) group.dates.push(date);
    groups.set(slug, group);
  }

  return Array.from(groups.entries()).map(([product, g]) => {
    const dates = g.dates.sort();
    return {
      product,
      label: g.label,
      quantity: round2(g.quantity),
      unit: map.unit,
      rate: g.quantity > 0 && g.hasAmount ? round2(g.amount / g.quantity) : 0,
      amount: round2(g.amount),
      load_count: g.loads,
      date_from: dates[0] ?? null,
      date_to: dates[dates.length - 1] ?? null,
    };
  });
}

// Rate check against the contract, never blocking: "settlement pays
// $28.50/ton, contract says $30". Units that do not match are a
// mismatch by definition.
export interface RateMismatch {
  settlementRate: number;
  settlementUnit: RateUnit;
  contract: StumpageRate;
  unitMismatch: boolean;
}

export function rateMismatch(
  line: SettlementLine,
  contractRates: StumpageRate[]
): RateMismatch | null {
  const contract = contractRates.find((r) => r.product === line.product);
  if (!contract || contract.rate <= 0 || line.rate <= 0) return null;
  if (contract.unit !== line.unit) {
    return {
      settlementRate: line.rate,
      settlementUnit: line.unit,
      contract,
      unitMismatch: true,
    };
  }
  if (Math.abs(contract.rate - line.rate) > 0.005) {
    return {
      settlementRate: line.rate,
      settlementUnit: line.unit,
      contract,
      unitMismatch: false,
    };
  }
  return null;
}
