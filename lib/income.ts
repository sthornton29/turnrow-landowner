// Income rollups shared by the Income page, property pages, and dashboard.
// Amounts allocate to properties by leased acres (leases) or by linked
// stand acres (timber sales); anything unallocable lands in "Unassigned".
//
// PROJECTIONS: a lease-year with no generated expected payments still
// shows its projected rent, computed straight from terms + leased acres
// + that year's assumptions (the tenant's prices and yields). Landowners
// never have to press Generate to see expected rent; generating a
// payment schedule REPLACES the projection for that lease-year with the
// schedule's rows. Views label projection-sourced totals as estimates
// that will change.

import { annualRent, type LeaseLike, type YearAssumptions } from "@/lib/leaseLogic";

export type IncomeType = "agricultural" | "hunting" | "timber";

export interface IncomeLease extends LeaseLike {
  id: string;
  status: string;
}

export interface IncomeInputs {
  leases: IncomeLease[];
  assumptions: Array<{ lease_id: string; year: number; data: YearAssumptions }>;
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
  taxStatements: Array<{
    id: string;
    parcel_id: string | null;
    tax_year: number;
    amount_due: number;
  }>;
  taxPayments: Array<{ tax_statement_id: string; paid_date: string; amount: number }>;
  parcels: Array<{ id: string; property_id: string }>;
}

export interface YearTotals {
  expected: Record<IncomeType, number>;
  received: Record<IncomeType, number>;
  taxesDue: number; // expected expense: statements for this tax year
  taxesPaid: number; // actual expense: tax payments dated in this year
  // True when any of the expected total is a computed projection (no
  // generated payment schedule yet); views show the "will change" note.
  hasProjection: boolean;
}

function emptyTotals(): YearTotals {
  return {
    expected: { agricultural: 0, hunting: 0, timber: 0 },
    received: { agricultural: 0, hunting: 0, timber: 0 },
    taxesDue: 0,
    taxesPaid: 0,
    hasProjection: false,
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

// Projected rent per (lease, year) from terms + leased acres + that
// year's assumptions. Draft and active leases project; expired and
// terminated ones stop.
export function projectedLeaseYears(inputs: IncomeInputs): Map<string, Map<number, number>> {
  const acresByLease = new Map<string, number>();
  for (const l of inputs.leaseLands) {
    acresByLease.set(l.lease_id, (acresByLease.get(l.lease_id) ?? 0) + (l.leased_acres ?? 0));
  }
  const assumptionsByLease = new Map<string, Map<number, YearAssumptions>>();
  for (const a of inputs.assumptions) {
    if (!assumptionsByLease.has(a.lease_id)) assumptionsByLease.set(a.lease_id, new Map());
    assumptionsByLease.get(a.lease_id)!.set(a.year, a.data ?? {});
  }
  const result = new Map<string, Map<number, number>>();
  for (const lease of inputs.leases) {
    if (lease.status === "expired" || lease.status === "terminated") continue;
    if (!lease.start_date || !lease.end_date) continue;
    const startYear = Number(lease.start_date.slice(0, 4));
    const endYear = Number(lease.end_date.slice(0, 4));
    if (!startYear || !endYear || endYear < startYear || endYear - startYear > 50) continue;
    const byYear = new Map<number, number>();
    for (let year = startYear; year <= endYear; year++) {
      const rent = annualRent(
        lease,
        acresByLease.get(lease.id) ?? 0,
        assumptionsByLease.get(lease.id)?.get(year)
      );
      if (rent !== null && rent !== 0) byYear.set(year, rent);
    }
    if (byYear.size > 0) result.set(lease.id, byYear);
  }
  return result;
}

interface EffectiveExpected {
  leaseId: string | null;
  timberSaleId: string | null;
  year: number;
  amount: number;
  projection: boolean; // computed from assumptions, no generated rows yet
}

// One expected amount per source-year: generated expected_payments win
// for a (lease, year) once any exist (they carry the user's schedule
// and adjustments); otherwise the computed projection fills in. Timber
// sales only ever have generated rows.
function effectiveExpectedEntries(inputs: IncomeInputs): EffectiveExpected[] {
  const entries: EffectiveExpected[] = [];
  const generated = new Map<string, number>();
  for (const e of inputs.expected) {
    if (e.timber_sale_id) {
      entries.push({
        leaseId: null,
        timberSaleId: e.timber_sale_id,
        year: e.year,
        amount: e.expected_amount,
        projection: false,
      });
    } else if (e.lease_id) {
      const key = `${e.lease_id}|${e.year}`;
      generated.set(key, (generated.get(key) ?? 0) + e.expected_amount);
    }
  }
  for (const [key, amount] of generated) {
    const [leaseId, year] = key.split("|");
    entries.push({
      leaseId,
      timberSaleId: null,
      year: Number(year),
      amount,
      projection: false,
    });
  }
  for (const [leaseId, byYear] of projectedLeaseYears(inputs)) {
    for (const [year, amount] of byYear) {
      if (generated.has(`${leaseId}|${year}`)) continue;
      entries.push({ leaseId, timberSaleId: null, year, amount, projection: true });
    }
  }
  return entries;
}

// Expected vs received by year and income type.
export function summarizeByYear(inputs: IncomeInputs): Map<number, YearTotals> {
  const map = new Map<number, YearTotals>();
  const get = (year: number) => {
    if (!map.has(year)) map.set(year, emptyTotals());
    return map.get(year)!;
  };

  for (const e of effectiveExpectedEntries(inputs)) {
    const totals = get(e.year);
    totals.expected[typeOf(inputs, e.leaseId, e.timberSaleId)] += e.amount;
    if (e.projection) totals.hasProjection = true;
  }
  for (const p of inputs.payments) {
    const year = Number(p.received_date.slice(0, 4));
    get(year).received[typeOf(inputs, p.lease_id, p.timber_sale_id)] += p.amount;
  }
  for (const s of inputs.settlements) {
    const year = Number(s.settlement_date.slice(0, 4));
    get(year).received.timber += s.total_amount;
  }
  for (const t of inputs.taxStatements) {
    get(t.tax_year).taxesDue += t.amount_due;
  }
  for (const p of inputs.taxPayments) {
    const year = Number(p.paid_date.slice(0, 4));
    get(year).taxesPaid += p.amount;
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

export interface PropertyTotals {
  expected: number;
  received: number;
  taxesDue: number;
  taxesPaid: number;
}

// Per-property income and tax expense for one year. Taxes route through
// the statement's parcel to its property; unmatched statements land in
// Unassigned.
export function allocateToProperties(
  inputs: IncomeInputs,
  year: number
): Map<string, PropertyTotals> {
  const result = new Map<string, PropertyTotals>();
  const add = (propertyId: string, field: keyof PropertyTotals, amount: number) => {
    const cur =
      result.get(propertyId) ??
      { expected: 0, received: 0, taxesDue: 0, taxesPaid: 0 };
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

  for (const e of effectiveExpectedEntries(inputs)) {
    if (e.year !== year) continue;
    spread(e.leaseId, e.timberSaleId, "expected", e.amount);
  }
  for (const p of inputs.payments) {
    if (Number(p.received_date.slice(0, 4)) !== year) continue;
    spread(p.lease_id, p.timber_sale_id, "received", p.amount);
  }
  for (const s of inputs.settlements) {
    if (Number(s.settlement_date.slice(0, 4)) !== year) continue;
    spread(null, s.timber_sale_id, "received", s.total_amount);
  }

  const parcelProperty = new Map(inputs.parcels.map((p) => [p.id, p.property_id]));
  const statementById = new Map(inputs.taxStatements.map((t) => [t.id, t]));
  const propertyOfStatement = (parcelId: string | null) =>
    (parcelId && parcelProperty.get(parcelId)) || UNASSIGNED;

  for (const t of inputs.taxStatements) {
    if (t.tax_year !== year) continue;
    add(propertyOfStatement(t.parcel_id), "taxesDue", t.amount_due);
  }
  for (const p of inputs.taxPayments) {
    if (Number(p.paid_date.slice(0, 4)) !== year) continue;
    const statement = statementById.get(p.tax_statement_id);
    add(propertyOfStatement(statement?.parcel_id ?? null), "taxesPaid", p.amount);
  }
  return result;
}

// Fetch-all helper used by pages that need income data. Kept here so every
// page loads the same shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadIncomeInputs(supabase: any): Promise<IncomeInputs> {
  const [
    leases,
    assumptions,
    leaseLands,
    expected,
    payments,
    settlements,
    saleStands,
    stands,
    taxStatements,
    taxPayments,
    parcels,
  ] = await Promise.all([
    supabase
      .from("leases")
      .select(
        "id, lease_type, rent_structure, status, terms, payment_schedule, start_date, end_date"
      ),
    supabase.from("lease_year_assumptions").select("lease_id, year, data"),
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
    supabase.from("tax_statements").select("id, parcel_id, tax_year, amount_due"),
    supabase.from("tax_payments").select("tax_statement_id, paid_date, amount"),
    supabase.from("parcels").select("id, property_id"),
  ]);
  return {
    leases: leases.data ?? [],
    assumptions: assumptions.data ?? [],
    leaseLands: leaseLands.data ?? [],
    expected: expected.data ?? [],
    payments: payments.data ?? [],
    settlements: settlements.data ?? [],
    saleStands: saleStands.data ?? [],
    stands: stands.data ?? [],
    taxStatements: taxStatements.data ?? [],
    taxPayments: taxPayments.data ?? [],
    parcels: parcels.data ?? [],
  };
}
