// Domain logic for leases, timber sales, and income. This is the single
// source of truth for lease terms shapes (stored in leases.terms jsonb),
// payment schedules, annual rent computation, expected payment generation,
// and payment status. The AI extraction schema mirrors these shapes.

export type LeaseType = "agricultural" | "hunting";
export type RentStructure = "cash" | "flex" | "crop_share";
export type LeaseStatus = "draft" | "active" | "expired" | "terminated";

export const LEASE_STATUS_LABELS: Record<LeaseStatus, string> = {
  draft: "Draft",
  active: "Active",
  expired: "Expired",
  terminated: "Terminated",
};

// ---------------------------------------------------------------- terms

// How a crop share / flex lease establishes its average price. The
// method only changes where the SUGGESTED price for each year's
// assumption comes from; assumptions themselves work exactly as before
// and every suggestion is reviewed before saving.
export type PriceMethod = "manual" | "tenant_average" | "rma_benchmark" | "custom";

export const PRICE_METHOD_LABELS: Record<PriceMethod, string> = {
  manual: "Manual (enter prices yourself)",
  tenant_average: "Tenant's average price (farm connection)",
  rma_benchmark: "RMA insurance benchmark (public data)",
  custom: "Custom recipe (from the lease's pricing clause)",
};

// Per-crop RMA benchmark configuration on the lease.
export interface RmaBenchmarkConfig {
  crop: string;
  state: string; // 2-letter
  formula: "projected" | "harvest" | "average";
}

// A custom pricing recipe: designed once (AI-assisted, user-reviewed),
// computed deterministically every year by lib/priceExpression.ts.
export interface PriceRecipeInput {
  name: string; // identifier used in the expression, snake_case
  label: string;
  source: "manual" | "rma_projected" | "rma_harvest" | "tenant_average";
  guidance: string | null; // where the human finds a manual value
}

export interface PriceRecipe {
  description: string;
  inputs: PriceRecipeInput[];
  expression: string;
}

export interface LeaseTerms {
  // cash
  cash_basis?: "per_acre" | "lump_sum" | null;
  rate_per_acre?: number | null;
  lump_sum?: number | null;
  // flex
  base_rate_per_acre?: number | null;
  bonus_description?: string | null;
  // crop_share
  landowner_share_pct?: number | null;
  shares_expenses?: boolean | null;
  expense_share_pct?: number | null;
  // price method (flex + crop_share)
  price_method?: PriceMethod | null;
  rma_config?: RmaBenchmarkConfig[] | null;
  custom_recipe?: PriceRecipe | null;
  pricing_clause?: string | null; // verbatim clause from extraction, prefills recipe setup
  // hunting
  hunt_basis?: "lump_sum" | "per_acre" | null;
  amount?: number | null;
  hunt_rate_per_acre?: number | null;
  insurance_required?: boolean | null;
}

// One entry of a lease payment schedule (1 to 4 per year). Either percent
// of the annual rent or a fixed amount.
export interface SchedulePayment {
  label: string;
  month: number; // 1-12
  day: number; // 1-31
  percent?: number | null;
  amount?: number | null;
}

// Per-year user-entered projection assumptions (lease_year_assumptions.data)
export interface YearAssumptions {
  // flex
  bonus_estimate?: number | null;
  // crop_share
  crop?: string | null;
  acres?: number | null;
  expected_yield?: number | null;
  expected_price?: number | null;
  expected_shared_expenses?: number | null; // landowner's share, dollars
}

export interface LeaseLike {
  lease_type: LeaseType;
  rent_structure: RentStructure | null;
  terms: LeaseTerms;
  payment_schedule: SchedulePayment[];
  start_date: string | null;
  end_date: string | null;
}

// ---------------------------------------------------------------- annual rent

// Annual rent for one year, from terms + leased acres + that year's
// assumptions. Returns null when the inputs are not sufficient yet.
export function annualRent(
  lease: LeaseLike,
  totalLeasedAcres: number,
  assumptions: YearAssumptions | undefined
): number | null {
  const t = lease.terms ?? {};
  if (lease.lease_type === "hunting") {
    if (t.hunt_basis === "per_acre") {
      return t.hunt_rate_per_acre ? t.hunt_rate_per_acre * totalLeasedAcres : null;
    }
    return t.amount ?? null;
  }
  switch (lease.rent_structure) {
    case "cash":
      if (t.cash_basis === "lump_sum") return t.lump_sum ?? null;
      return t.rate_per_acre ? t.rate_per_acre * totalLeasedAcres : null;
    case "flex": {
      if (!t.base_rate_per_acre) return null;
      return t.base_rate_per_acre * totalLeasedAcres + (assumptions?.bonus_estimate ?? 0);
    }
    case "crop_share": {
      const a = assumptions ?? {};
      if (!a.acres || !a.expected_yield || !a.expected_price || !t.landowner_share_pct) {
        return null;
      }
      const gross = a.acres * a.expected_yield * a.expected_price * (t.landowner_share_pct / 100);
      const expenses = t.shares_expenses ? (a.expected_shared_expenses ?? 0) : 0;
      return gross - expenses;
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------- expected payments

export interface GeneratedPayment {
  year: number;
  label: string;
  due_date: string; // YYYY-MM-DD
  expected_amount: number;
}

function isoDate(year: number, month: number, day: number): string {
  const m = String(Math.min(Math.max(month, 1), 12)).padStart(2, "0");
  const d = String(Math.min(Math.max(day, 1), 31)).padStart(2, "0");
  return `${year}-${m}-${d}`;
}

// Expected payment rows for every year of the lease term. The caller diffs
// these against existing rows (never touching rows that have payments).
export function generateLeasePayments(
  lease: LeaseLike,
  totalLeasedAcres: number,
  assumptionsByYear: Map<number, YearAssumptions>
): GeneratedPayment[] {
  if (!lease.start_date || !lease.end_date) return [];
  const startYear = Number(lease.start_date.slice(0, 4));
  const endYear = Number(lease.end_date.slice(0, 4));
  if (!startYear || !endYear || endYear < startYear || endYear - startYear > 50) return [];

  const schedule =
    lease.payment_schedule.length > 0
      ? lease.payment_schedule
      : [{ label: "Annual payment", month: 1, day: 1, percent: 100 }];

  const rows: GeneratedPayment[] = [];
  for (let year = startYear; year <= endYear; year++) {
    const annual = annualRent(lease, totalLeasedAcres, assumptionsByYear.get(year));
    if (annual === null) continue;
    for (const p of schedule) {
      const amount =
        p.amount !== null && p.amount !== undefined
          ? p.amount
          : Math.round(annual * ((p.percent ?? 0) / 100) * 100) / 100;
      if (!amount) continue;
      rows.push({
        year,
        label: p.label || "Payment",
        due_date: isoDate(year, p.month, p.day),
        expected_amount: amount,
      });
    }
  }
  return rows;
}

// Timber sale: expected rows come straight from its payment_schedule
// entries [{ label, due_date, amount }].
export interface TimberSchedulePayment {
  label: string;
  due_date: string;
  amount: number;
}

export function generateTimberPayments(
  schedule: TimberSchedulePayment[]
): GeneratedPayment[] {
  return schedule
    .filter((p) => p.due_date && p.amount)
    .map((p) => ({
      year: Number(p.due_date.slice(0, 4)),
      label: p.label || "Payment",
      due_date: p.due_date,
      expected_amount: p.amount,
    }));
}

// ---------------------------------------------------------------- status

export type PaymentStatus =
  | "paid"
  | "partial"
  | "past_due"
  | "due_soon"
  | "upcoming";

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  paid: "Paid",
  partial: "Partially paid",
  past_due: "Past due",
  due_soon: "Due soon",
  upcoming: "Upcoming",
};

export function paymentStatus(
  expectedAmount: number,
  receivedTotal: number,
  dueDate: string,
  today: Date = new Date()
): PaymentStatus {
  if (receivedTotal >= expectedAmount - 0.005) return "paid";
  if (receivedTotal > 0) return "partial";
  const due = new Date(dueDate + "T00:00:00");
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysUntil = Math.ceil((due.getTime() - today.getTime()) / msPerDay);
  if (daysUntil < 0) return "past_due";
  if (daysUntil <= 30) return "due_soon";
  return "upcoming";
}

export const STATUS_BADGE_CLASSES: Record<PaymentStatus, string> = {
  paid: "bg-kelly-50 text-pine-900",
  partial: "bg-amber-50 text-amber-800",
  past_due: "bg-red-50 text-red-700",
  due_soon: "bg-amber-50 text-amber-800",
  upcoming: "bg-gray-100 text-gray-600",
};

// ---------------------------------------------------------------- timber products

export const TIMBER_PRODUCTS: Array<{ product: string; label: string }> = [
  { product: "pine_sawtimber", label: "Pine sawtimber" },
  { product: "pine_cns", label: "Pine chip-n-saw" },
  { product: "pine_pulpwood", label: "Pine pulpwood" },
  { product: "hardwood_sawtimber", label: "Hardwood sawtimber" },
  { product: "hardwood_pulpwood", label: "Hardwood pulpwood" },
];

export interface StumpageRate {
  product: string; // one of TIMBER_PRODUCTS or a custom slug
  label: string;
  price_per_ton: number;
}

export interface SettlementLine {
  product: string;
  label: string;
  tons: number;
  price_per_ton: number;
  amount: number;
}

// ---------------------------------------------------------------- insurance

export function insuranceProblem(
  insuranceRequired: boolean | null | undefined,
  tenant: { insurance_on_file: boolean; insurance_expires: string | null } | null
): string | null {
  if (!insuranceRequired) return null;
  if (!tenant) return "Insurance is required but no tenant is linked.";
  if (!tenant.insurance_on_file) {
    return "Insurance is required but this tenant has no certificate on file.";
  }
  if (tenant.insurance_expires) {
    const expires = new Date(tenant.insurance_expires + "T00:00:00");
    if (expires < new Date()) {
      return `Insurance is required but the certificate expired ${tenant.insurance_expires}.`;
    }
  }
  return null;
}
