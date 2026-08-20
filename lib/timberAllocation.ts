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

// The percentage share of each linked stand under a method. by_acres
// splits by mapped acres (equal split if no stand has acres, so linked
// stands never silently drop to zero); manual uses the stored
// percentages as-is (they may deliberately sum under 100, leaving a
// remainder unallocated); none allocates nothing.
export function allocationShares(
  method: AllocationMethod,
  stands: AllocatableStand[],
  percents?: Record<string, number>
): StandShare[] {
  if (method === "none" || stands.length === 0) return [];
  if (method === "manual") {
    return stands
      .map((s) => ({
        standId: s.id,
        pct: percents?.[s.id] ?? s.allocation_pct ?? 0,
      }))
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
// pieces add back to the whole; under-100% manual splits keep their
// true remainder unallocated instead.
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
