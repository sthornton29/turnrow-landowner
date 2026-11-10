// TIMBER BASIS AND DEPLETION (migration 0046). Pure, unit-tested math
// for the timber account ledger. Nothing derived is stored: balances
// are the opening amounts plus the sum of ledger entries.
//
// The rules (USDA FS-1275 Tax Tips for Forest Landowners, 2025 tax year):
//   * Purchase: total cost is split among land, timber, improvements by
//     fair market value; the timber share is the timber basis.
//   * Inheritance: basis is the fair market value at the date of death.
//   * Gift: the donor's basis carries over.
//   * Depletion unit = adjusted basis / volume on hand. Selling Q units
//     recovers Q x unit, never more than the basis left.
//   * Taxable gain = proceeds - selling expenses - depletion.
// The app PROPOSES depletion; a person confirms it (standing rule), and
// every screen says the numbers are for the accountant.

import { TIMBER_PRODUCTS, type RateUnit, type SettlementLine } from "./leaseLogic";
import {
  allocationShares,
  resolveSettlementShares,
  type AllocatableStand,
  type AllocationMethod,
  type SettlementAllocation,
} from "./timberAllocation";

export const ALL_TIMBER = "all_timber";

export type AcquisitionType = "purchase" | "inheritance" | "gift" | "transfer" | "unknown";
export type BasisSource =
  | "closing_statement"
  | "timber_cruise"
  | "appraisal"
  | "estate_appraisal"
  | "retroactive_appraisal"
  | "estimate"
  | "unknown";
export type EntryType = "depletion" | "capitalized_cost" | "volume_adjustment" | "casualty_loss" | "other";

export const ACQUISITION_LABELS: Record<AcquisitionType, { label: string; question: string; help: string }> = {
  purchase: {
    label: "Bought",
    question: "Bought it",
    help: "Your timber basis is the part of the price (plus closing costs) that paid for the timber. A cruise or appraisal at the time of purchase sets that split.",
  },
  inheritance: {
    label: "Inherited",
    question: "Inherited it",
    help: "Your basis is the timber's value on the date of death (a stepped-up basis). An estate appraisal or a forester's appraisal as of that date sets it.",
  },
  gift: {
    label: "Gift",
    question: "Received it as a gift",
    help: "The giver's basis carries over to you. Use the value they had in it, not the value on the day of the gift.",
  },
  transfer: {
    label: "Put into the entity",
    question: "Put into the LLC, trust, or company by the family",
    help: "Usually the entity keeps the basis the family had before the transfer. Your accountant can confirm how this transfer was treated.",
  },
  unknown: {
    label: "Not sure",
    question: "Not sure",
    help: "That is common. A consulting forester can do a retroactive appraisal that works the timber back to the date you got it.",
  },
};

export const BASIS_SOURCE_LABELS: Record<BasisSource, string> = {
  closing_statement: "Closing statement",
  timber_cruise: "Timber cruise at the time",
  appraisal: "Appraisal at the time",
  estate_appraisal: "Estate appraisal",
  retroactive_appraisal: "Retroactive appraisal (done later)",
  estimate: "Our own estimate",
  unknown: "No record yet",
};

export const ENTRY_TYPE_LABELS: Record<EntryType, string> = {
  depletion: "Depletion (timber sold)",
  capitalized_cost: "Cost added to basis",
  volume_adjustment: "Volume adjustment (new cruise, growth)",
  casualty_loss: "Casualty loss (storm, fire, beetles)",
  other: "Other adjustment",
};

export function productLabel(product: string): string {
  if (product === ALL_TIMBER) return "All timber";
  return TIMBER_PRODUCTS.find((p) => p.product === product)?.label ?? product.replace(/_/g, " ");
}

export interface AccountProduct {
  product: string;
  unit: RateUnit;
  opening_volume: number | null;
  opening_basis: number;
}

export interface AccountEntry {
  entry_date: string;
  entry_type: string;
  product: string | null;
  volume_change: number;
  basis_change: number;
  timber_sale_id?: string | null;
}

export interface ProductBalance {
  product: string;
  unit: RateUnit;
  volume: number | null; // null = never measured
  basis: number;
  unitBasis: number | null; // $ per unit; null when volume unknown or zero
}

export interface AccountBalance {
  products: ProductBalance[];
  basis: number;
  openingBasis: number;
  depleted: number; // total recovered through depletion (positive)
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// Entries with no product apply to the whole account, spread over its
// products in proportion to basis (volume too, where known).
export function accountBalance(products: AccountProduct[], entries: AccountEntry[]): AccountBalance {
  const rows = new Map<string, { unit: RateUnit; volume: number | null; basis: number }>();
  for (const p of products) {
    rows.set(p.product, {
      unit: p.unit,
      volume: p.opening_volume ?? null,
      basis: Number(p.opening_basis) || 0,
    });
  }
  const openingBasis = round2(Array.from(rows.values()).reduce((s, r) => s + r.basis, 0));
  let depleted = 0;
  const sorted = [...entries].sort((a, b) => a.entry_date.localeCompare(b.entry_date));
  for (const e of sorted) {
    const dv = Number(e.volume_change) || 0;
    const db = Number(e.basis_change) || 0;
    if (e.entry_type === "depletion") depleted += -db;
    if (e.product && rows.has(e.product)) {
      const r = rows.get(e.product)!;
      r.basis += db;
      if (dv !== 0) r.volume = (r.volume ?? 0) + dv;
    } else if (e.product && !rows.has(e.product)) {
      // A product first seen in the ledger (a cruise found poles, say).
      rows.set(e.product, { unit: "ton", volume: dv !== 0 ? dv : null, basis: db });
    } else {
      const totalBasis = Array.from(rows.values()).reduce((s, r) => s + r.basis, 0);
      const n = rows.size;
      for (const r of rows.values()) {
        const share = totalBasis > 0 ? r.basis / totalBasis : n > 0 ? 1 / n : 0;
        r.basis += db * share;
        if (dv !== 0 && r.volume !== null) r.volume += dv * share;
      }
    }
  }
  const out: ProductBalance[] = Array.from(rows.entries()).map(([product, r]) => {
    const basis = round2(Math.max(0, r.basis));
    const volume = r.volume === null ? null : Math.max(0, Math.round(r.volume * 1000) / 1000);
    return {
      product,
      unit: r.unit,
      volume,
      basis,
      unitBasis: volume && volume > 0 ? Math.round((basis / volume) * 10000) / 10000 : null,
    };
  });
  return {
    products: out,
    basis: round2(out.reduce((s, p) => s + p.basis, 0)),
    openingBasis,
    depleted: round2(depleted),
  };
}

export interface SoldQuantity {
  product: string;
  unit: RateUnit;
  quantity: number;
}

export interface DepletionLine {
  product: string; // the account product depleted
  soldProduct: string; // what the settlement called it
  unit: RateUnit;
  quantity: number;
  unitBasis: number;
  volumeChange: number; // negative
  basisChange: number; // negative
}

export interface DepletionProposal {
  lines: DepletionLine[];
  total: number; // positive dollars recovered
  unmatched: SoldQuantity[]; // sold products the account cannot price
  note: string | null;
}

// Depletion from quantities sold. A sold product matches the account's
// same product and unit; failing that, an 'all_timber' pool in the same
// unit takes it. Products with no volume on record cannot be priced per
// unit: they come back unmatched (use proposeDepletionByShare).
export function proposeDepletion(balance: AccountBalance, sold: SoldQuantity[]): DepletionProposal {
  const remaining = new Map(balance.products.map((p) => [p.product, { ...p }]));
  const lines: DepletionLine[] = [];
  const unmatched: SoldQuantity[] = [];
  for (const s of sold) {
    if (!(s.quantity > 0)) continue;
    let target = remaining.get(s.product);
    if (!target || target.unit !== s.unit) {
      const pool = remaining.get(ALL_TIMBER);
      target = pool && pool.unit === s.unit ? pool : undefined;
    }
    if (!target || !target.volume || target.volume <= 0 || target.unitBasis === null) {
      unmatched.push(s);
      continue;
    }
    const qty = Math.min(s.quantity, target.volume);
    const unitBasis = target.basis / target.volume;
    const amount = round2(Math.min(target.basis, qty * unitBasis));
    lines.push({
      product: target.product,
      soldProduct: s.product,
      unit: s.unit,
      quantity: s.quantity,
      unitBasis: Math.round(unitBasis * 10000) / 10000,
      volumeChange: -qty,
      basisChange: -amount,
    });
    target.volume -= qty;
    target.basis = round2(target.basis - amount);
    target.unitBasis = target.volume > 0 ? target.basis / target.volume : null;
  }
  const total = round2(lines.reduce((s, l) => s - l.basisChange, 0));
  let note: string | null = null;
  const overcut = sold.some((s) => {
    const t = balance.products.find((p) => p.product === s.product) ?? balance.products.find((p) => p.product === ALL_TIMBER);
    return t?.volume != null && s.quantity > t.volume;
  });
  if (overcut) {
    note = "More was cut than the account shows on hand. Depletion stops at the volume on record; a new cruise or a volume adjustment may be needed.";
  }
  return { lines, total, unmatched, note };
}

// Depletion by share: "about 40% of this tract's timber was sold". Used
// for lump-sum sales and accounts with no volume on record.
export function proposeDepletionByShare(balance: AccountBalance, share: number): DepletionProposal {
  const s = Math.min(1, Math.max(0, share));
  const lines: DepletionLine[] = balance.products
    .filter((p) => p.basis > 0)
    .map((p) => ({
      product: p.product,
      soldProduct: p.product,
      unit: p.unit,
      quantity: p.volume != null ? Math.round(p.volume * s * 1000) / 1000 : 0,
      unitBasis: p.unitBasis ?? 0,
      volumeChange: p.volume != null ? -Math.round(p.volume * s * 1000) / 1000 : 0,
      basisChange: -round2(p.basis * s),
    }));
  return { lines, total: round2(lines.reduce((t, l) => t - l.basisChange, 0)), unmatched: [], note: null };
}

// Sum settlement lines into quantities by product and unit, scaled by
// this tract's share of the sale (a sale across two properties).
export function soldFromSettlements(
  settlements: Array<{ lines: SettlementLine[] | null }>,
  share = 1
): SoldQuantity[] {
  const map = new Map<string, SoldQuantity>();
  for (const s of settlements) {
    for (const l of s.lines ?? []) {
      const q = Number(l.quantity) || 0;
      if (q <= 0) continue;
      const key = `${l.product}|${l.unit}`;
      const cur = map.get(key) ?? { product: l.product, unit: l.unit, quantity: 0 };
      cur.quantity += q * share;
      map.set(key, cur);
    }
  }
  return Array.from(map.values()).map((q) => ({ ...q, quantity: Math.round(q.quantity * 1000) / 1000 }));
}

// Purchase or inheritance split: given total value and the FMV of each
// part, the basis of each part. Used by the setup interview when the
// owner knows the appraised values but not the allocated cost.
export function allocateByValue(
  totalCost: number,
  parts: { land: number; timber: number; improvements: number }
): { land: number; timber: number; improvements: number } {
  const sum = parts.land + parts.timber + parts.improvements;
  if (!(sum > 0) || !(totalCost >= 0)) return { land: 0, timber: 0, improvements: 0 };
  const timber = round2((totalCost * parts.timber) / sum);
  const improvements = round2((totalCost * parts.improvements) / sum);
  return { land: round2(totalCost - timber - improvements), timber, improvements };
}

export function taxableGain(proceeds: number, sellingExpenses: number, depletion: number): number {
  return round2(proceeds - sellingExpenses - depletion);
}

export const BASIS_NOTE = "For your accountant. Confirm with them before filing.";

// This property's share (0..1) of a sale or of one settlement: the sum of
// its stands' allocation shares. A sale kept "at sale level" (method
// none) falls back to acres, since depletion needs SOME split; a sale
// whose stands all sit on this property is 1.
export function propertyShareOfSale(
  method: AllocationMethod,
  saleStands: Array<AllocatableStand & { property_id: string }>,
  propertyId: string,
  settlementAllocation?: SettlementAllocation | null
): number {
  if (saleStands.length === 0) return 0;
  if (saleStands.every((s) => s.property_id === propertyId)) return 1;
  const effective: AllocationMethod = method === "none" ? "by_acres" : method;
  const shares = settlementAllocation && settlementAllocation.method !== "none"
    ? resolveSettlementShares(effective, saleStands, settlementAllocation)
    : allocationShares(effective, saleStands);
  const onProperty = new Set(saleStands.filter((s) => s.property_id === propertyId).map((s) => s.id));
  const pct = shares.filter((s) => onProperty.has(s.standId)).reduce((t, s) => t + s.pct, 0);
  return Math.min(1, Math.max(0, pct / 100));
}
