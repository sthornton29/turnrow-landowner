// Allocation of timber sale dollars (and tons) across the linked
// stands. The sale carries an allocation_method (by_acres default,
// manual percentages, or none = stay at sale level); each settlement
// may override it via its allocation jsonb. Stand summary pages use
// these shares to show allocated timber income.

export type AllocationMethod = "by_acres" | "manual" | "none";

export interface AllocatableStand {
  id: string;
  acres: number | null;
  allocation_pct?: number | null; // manual method
}

// Per-settlement override stored in timber_settlements.allocation:
// null inherits the sale's method.
export interface SettlementAllocation {
  method: AllocationMethod;
  percents?: Record<string, number>; // stand id -> pct, manual only
}

export interface StandShare {
  standId: string;
  pct: number;
}

// One stand's manual percentage. A settlement's own percents stand
// alone (a stand it leaves out gets 0, not the sale's stored number);
// without them the sale's stored percentage applies.
function manualPct(s: AllocatableStand, percents?: Record<string, number>): number {
  const raw = percents ? percents[s.id] : s.allocation_pct;
  return Number(raw ?? 0) || 0;
}

// Manual percentages count only when every one is 0 or more and they
// add to 100 (to the hundredth). Anything else (boxes left blank, 60 and
// blank, 80 and 40) would lose or invent dollars.
export function manualPercentTotal(
  stands: AllocatableStand[],
  percents?: Record<string, number>
): number {
  const total = stands.reduce((sum, s) => sum + manualPct(s, percents), 0);
  return Math.round(total * 100) / 100;
}

export function manualPercentsValid(
  stands: AllocatableStand[],
  percents?: Record<string, number>
): boolean {
  if (stands.length === 0) return false;
  if (stands.some((s) => manualPct(s, percents) < 0)) return false;
  return Math.abs(manualPercentTotal(stands, percents) - 100) <= 0.01;
}

// Linked stands that get nothing in a by-acres split because they have
// no drawn boundary (no acres) while another linked stand does. Empty
// when every stand has acres, or none does (then the split is equal).
export function standsWithoutAcres(stands: AllocatableStand[]): string[] {
  const missing = stands.filter((s) => !((s.acres ?? 0) > 0));
  if (missing.length === 0 || missing.length === stands.length) return [];
  return missing.map((s) => s.id);
}

// The percentage share of each linked stand under a method. by_acres
// splits by mapped acres (equal split if no stand has acres, so linked
// stands never silently drop to zero); manual uses the percentages when
// they add to 100 and otherwise falls back to the by-acres split (the
// screens that take percentages warn about it); none allocates nothing.
export function allocationShares(
  method: AllocationMethod,
  stands: AllocatableStand[],
  percents?: Record<string, number>
): StandShare[] {
  if (method === "none" || stands.length === 0) return [];
  if (method === "manual" && manualPercentsValid(stands, percents)) {
    return stands
      .map((s) => ({ standId: s.id, pct: manualPct(s, percents) }))
      .filter((s) => s.pct > 0);
  }
  const totalAcres = stands.reduce((sum, s) => sum + (s.acres ?? 0), 0);
  if (totalAcres <= 0) {
    const equal = 100 / stands.length;
    return stands.map((s) => ({ standId: s.id, pct: equal }));
  }
  return stands
    .map((s) => ({ standId: s.id, pct: ((s.acres ?? 0) / totalAcres) * 100 }))
    .filter((s) => s.pct > 0);
}

export interface AllocatedAmount {
  standId: string;
  amount: number;
}

// Dollars split by the shares, rounded to cents. When the shares sum to
// (at least) 100%, the last stand absorbs the rounding remainder so the
// pieces add back to the whole; shares handed in that sum under 100%
// keep their true remainder unallocated instead.
export function allocateAmount(
  amount: number,
  shares: StandShare[]
): AllocatedAmount[] {
  if (shares.length === 0) return [];
  const totalPct = shares.reduce((sum, s) => sum + s.pct, 0);
  const out = shares.map((s) => ({
    standId: s.standId,
    amount: Math.round(amount * (s.pct / 100) * 100) / 100,
  }));
  if (totalPct >= 99.999) {
    const allocated = out.reduce((sum, a) => sum + a.amount, 0);
    const drift = Math.round((amount - allocated) * 100) / 100;
    if (drift !== 0) {
      out[out.length - 1].amount =
        Math.round((out[out.length - 1].amount + drift) * 100) / 100;
    }
  }
  return out;
}

// Convenience: the sale-or-settlement-level resolution. A settlement's
// allocation jsonb wins when present; otherwise the sale's method and
// the stands' stored manual percentages apply.
export function resolveSettlementShares(
  saleMethod: AllocationMethod,
  stands: AllocatableStand[],
  settlementAllocation: SettlementAllocation | null | undefined
): StandShare[] {
  if (settlementAllocation) {
    return allocationShares(
      settlementAllocation.method,
      stands,
      settlementAllocation.percents
    );
  }
  return allocationShares(saleMethod, stands);
}
