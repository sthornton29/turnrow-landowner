// Income rollups shared by the Income page, property pages, and dashboard.
// Amounts allocate to properties by leased acres (leases) or by linked
// stand acres (timber sales); anything unallocable lands in "Unassigned".

export type IncomeType = "agricultural" | "hunting" | "timber";

export interface IncomeInputs {
  leases: Array<{ id: string; lease_type: "agricultural" | "hunting" }>;
  leaseLands: Array<{ lease_id: string; property_id: string; leased_acres: number | null }>;
  expected: Array<{
    id: string;
    lease_id: string | null;
    timber_sale_id: string | null;
    year: number;
    expected_amount: number;
  }>;
  payments: Array<{
    lease_id: string | null;
    timber_sale_id: string | null;
    amount: number;
    received_date: string;
  }>;
  settlements: Array<{
    timber_sale_id: string;
    settlement_date: string;
    total_amount: number;
  }>;
  saleStands: Array<{ timber_sale_id: string; timber_stand_id: string }>;
  stands: Array<{ id: string; property_id: string; acres: number | null }>;
}

export interface YearTotals {
  expected: Record<IncomeType, number>;
  received: Record<IncomeType, number>;
}

function emptyTotals(): YearTotals {
  return {
    expected: { agricultural: 0, hunting: 0, timber: 0 },
    received: { agricultural: 0, hunting: 0, timber: 0 },
  };
}

function typeOf(
  inputs: IncomeInputs,
  leaseId: string | null,
  timberSaleId: string | null
): IncomeType {
  if (timberSaleId) return "timber";
  const lease = inputs.leases.find((l) => l.id === leaseId);
  return lease?.lease_type === "hunting" ? "hunting" : "agricultural";
}

// Expected vs received by year and income type.
export function summarizeByYear(inputs: IncomeInputs): Map<number, YearTotals> {
  const map = new Map<number, YearTotals>();
  const get = (year: number) => {
    if (!map.has(year)) map.set(year, emptyTotals());
    return map.get(year)!;
  };

  for (const e of inputs.expected) {
    get(e.year).expected[typeOf(inputs, e.lease_id, e.timber_sale_id)] +=
      e.expected_amount;
  }
  for (const p of inputs.payments) {
    const year = Number(p.received_date.slice(0, 4));
    get(year).received[typeOf(inputs, p.lease_id, p.timber_sale_id)] += p.amount;
  }
  for (const s of inputs.settlements) {
    const year = Number(s.settlement_date.slice(0, 4));
    get(year).received.timber += s.total_amount;
  }
  return map;
}

// Allocation shares per source: property_id -> fraction (sums to 1), or
// null when the source has no land linked.
function sharesFor(
  inputs: IncomeInputs,
  leaseId: string | null,
  timberSaleId: string | null
): Map<string, number> | null {
  if (leaseId) {
    const lands = inputs.leaseLands.filter((l) => l.lease_id === leaseId);
    const total = lands.reduce((s, l) => s + (l.leased_acres ?? 0), 0);
    if (total <= 0) return null;
    const map = new Map<string, number>();
    for (const l of lands) {
      map.set(
        l.property_id,
        (map.get(l.property_id) ?? 0) + (l.leased_acres ?? 0) / total
      );
    }
    return map;
  }
  if (timberSaleId) {
    const standById = new Map(inputs.stands.map((s) => [s.id, s]));
    const links = inputs.saleStands.filter((s) => s.timber_sale_id === timberSaleId);
    const total = links.reduce(
      (s, l) => s + (standById.get(l.timber_stand_id)?.acres ?? 0),
      0
    );
    if (total <= 0) return null;
    const map = new Map<string, number>();
    for (const l of links) {
      const stand = standById.get(l.timber_stand_id);
      if (!stand) continue;
      map.set(
        stand.property_id,
        (map.get(stand.property_id) ?? 0) + (stand.acres ?? 0) / total
      );
    }
    return map;
  }
  return null;
}

export const UNASSIGNED = "__unassigned__";

// Per-property expected/received for one year.
export function allocateToProperties(
  inputs: IncomeInputs,
  year: number
): Map<string, { expected: number; received: number }> {
  const result = new Map<string, { expected: number; received: number }>();
  const add = (propertyId: string, field: "expected" | "received", amount: number) => {
    const cur = result.get(propertyId) ?? { expected: 0, received: 0 };
    cur[field] += amount;
    result.set(propertyId, cur);
  };
  const spread = (
    leaseId: string | null,
    timberSaleId: string | null,
    field: "expected" | "received",
    amount: number
  ) => {
    const shares = sharesFor(inputs, leaseId, timberSaleId);
    if (!shares) {
      add(UNASSIGNED, field, amount);
      return;
    }
    for (const [propertyId, share] of shares) {
      add(propertyId, field, amount * share);
    }
  };

  for (const e of inputs.expected) {
    if (e.year !== year) continue;
    spread(e.lease_id, e.timber_sale_id, "expected", e.expected_amount);
  }
  for (const p of inputs.payments) {
    if (Number(p.received_date.slice(0, 4)) !== year) continue;
    spread(p.lease_id, p.timber_sale_id, "received", p.amount);
  }
  for (const s of inputs.settlements) {
    if (Number(s.settlement_date.slice(0, 4)) !== year) continue;
    spread(null, s.timber_sale_id, "received", s.total_amount);
  }
  return result;
}

// Fetch-all helper used by pages that need income data. Kept here so every
// page loads the same shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadIncomeInputs(supabase: any): Promise<IncomeInputs> {
  const [leases, leaseLands, expected, payments, settlements, saleStands, stands] =
    await Promise.all([
      supabase.from("leases").select("id, lease_type"),
      supabase.from("lease_lands").select("lease_id, property_id, leased_acres"),
      supabase
        .from("expected_payments")
        .select("id, lease_id, timber_sale_id, year, expected_amount"),
      supabase
        .from("payments")
        .select("lease_id, timber_sale_id, amount, received_date"),
      supabase
        .from("timber_settlements")
        .select("timber_sale_id, settlement_date, total_amount"),
      supabase.from("timber_sale_stands").select("timber_sale_id, timber_stand_id"),
      supabase.from("timber_stands").select("id, property_id, acres"),
    ]);
  return {
    leases: leases.data ?? [],
    leaseLands: leaseLands.data ?? [],
    expected: expected.data ?? [],
    payments: payments.data ?? [],
    settlements: settlements.data ?? [],
    saleStands: saleStands.data ?? [],
    stands: stands.data ?? [],
  };
}
