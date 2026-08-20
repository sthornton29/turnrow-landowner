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

// Where an assumption value came from, when it was filled from tenant
// data (the Tenant Data panel). Hand-entered values carry no source.
export type ValueSourceKind = "tenant_projected" | "tenant_final" | "tenant_actual";
export interface ValueSource {
  kind: ValueSourceKind;
  as_of: string | null; // ISO date/timestamp the tenant number was as of
}

export const VALUE_SOURCE_LABELS: Record<ValueSourceKind, string> = {
  tenant_projected: "tenant projected",
  tenant_final: "tenant final",
  tenant_actual: "tenant actual",
};

// Irrigated vs dryland practice on a crop entry. Blended (the default,
// and how legacy rows read) means no split: one set of numbers for the
// whole crop. A crop share year can hold Corn irrigated and Corn
// dryland entries with their own acres/yield/price.
export type CropPractice = "irrigated" | "dryland" | "blended";

export const CROP_PRACTICE_LABELS: Record<CropPractice, string> = {
  blended: "Blended",
  irrigated: "Irrigated",
  dryland: "Dryland",
};

// One crop's projection inputs within a lease year. A crop share year
// holds one or more of these (wheat and canola on the same leased ground
// in the same year); projected rent sums them.
export interface CropAssumption {
  crop?: string | null;
  practice?: CropPractice | null; // null reads as blended
  acres?: number | null;
  expected_yield?: number | null;
  expected_price?: number | null;
  expected_shared_expenses?: number | null; // landowner's share, dollars
  sources?: {
    acres?: ValueSource | null;
    expected_yield?: ValueSource | null;
    expected_price?: ValueSource | null;
  } | null;
}

// Per-year user-entered projection assumptions (lease_year_assumptions.data)
export interface YearAssumptions {
  // flex
  bonus_estimate?: number | null;
  // crop_share, multi-crop shape. Rows saved before this existed carry
  // the single-crop fields below instead; cropAssumptions() reads both.
  crops?: CropAssumption[] | null;
  // legacy single-crop fields (still readable, no longer written)
  crop?: string | null;
  acres?: number | null;
  expected_yield?: number | null;
  expected_price?: number | null;
  expected_shared_expenses?: number | null;
}

// The year's crop entries, whichever shape the row was saved in.
export function cropAssumptions(
  a: YearAssumptions | null | undefined
): CropAssumption[] {
  if (!a) return [];
  if (a.crops && a.crops.length > 0) return a.crops;
  if (
    a.crop ||
    a.acres != null ||
    a.expected_yield != null ||
    a.expected_price != null ||
    a.expected_shared_expenses != null
  ) {
    return [
      {
        crop: a.crop ?? null,
        acres: a.acres ?? null,
        expected_yield: a.expected_yield ?? null,
        expected_price: a.expected_price ?? null,
        expected_shared_expenses: a.expected_shared_expenses ?? null,
      },
    ];
  }
  return [];
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
      // Sum over the year's crop entries; any started-but-incomplete
      // entry keeps the whole year Incomplete (never understate).
      const entries = cropAssumptions(assumptions);
      if (entries.length === 0 || !t.landowner_share_pct) return null;
      let total = 0;
      for (const e of entries) {
        if (!e.acres || !e.expected_yield || !e.expected_price) return null;
        const gross =
          e.acres * e.expected_yield * e.expected_price * (t.landowner_share_pct / 100);
        const expenses = t.shares_expenses ? (e.expected_shared_expenses ?? 0) : 0;
        total += gross - expenses;
      }
      return total;
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

  // Blank schedule rows (no percent and no fixed amount; the form can
  // save empty ones) must not silently zero out generation: ignore
  // them, and with nothing real left fall back to one annual payment.
  const realSchedule = lease.payment_schedule.filter((p) => p.percent || p.amount);
  const schedule =
    realSchedule.length > 0
      ? realSchedule
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
  { product: "poles_pilings", label: "Poles / pilings" },
  { product: "veneer_peeler", label: "Veneer / peeler logs" },
  { product: "crossties", label: "Crossties" },
  { product: "topwood_chips", label: "Topwood / chips" },
];

export const HARVEST_TYPE_LABELS: Record<string, string> = {
  clearcut: "Clearcut",
  first_thinning: "First thinning",
  second_thinning: "Second thinning",
  select_cut: "Select / seed-tree cut",
  salvage: "Salvage",
  other: "Other",
};

// Rate units: $/ton is the Southeast default; hardwood sawtimber
// sometimes sells by the thousand board feet with a log scale noted
// (Doyle is the regional default; Scribner and International 1/4 exist).
export type RateUnit = "ton" | "mbf";
export type LogScale = "doyle" | "scribner" | "international";

export const RATE_UNIT_LABELS: Record<RateUnit, string> = {
  ton: "ton",
  mbf: "MBF",
};

export const LOG_SCALE_LABELS: Record<LogScale, string> = {
  doyle: "Doyle",
  scribner: "Scribner",
  international: "International 1/4",
};

export interface StumpageRate {
  product: string; // one of TIMBER_PRODUCTS or a custom slug
  label: string;
  rate: number; // dollars per unit
  unit: RateUnit;
  log_scale?: LogScale | null; // MBF rates only
}

// Rows written before migration 0018 stored { price_per_ton } with no
// unit; read them as $/ton forever.
export function normalizeStumpageRate(
  raw: Partial<StumpageRate> & { price_per_ton?: number }
): StumpageRate {
  return {
    product: raw.product ?? "",
    label: raw.label ?? "",
    rate: raw.rate ?? raw.price_per_ton ?? 0,
    unit: raw.unit === "mbf" ? "mbf" : "ton",
    log_scale:
      raw.unit === "mbf" ? ((raw.log_scale ?? "doyle") as LogScale) : null,
  };
}

export interface SettlementLine {
  product: string;
  label: string;
  quantity: number; // in the product's unit (tons or MBF)
  unit: RateUnit;
  rate: number; // dollars per unit actually paid
  amount: number;
  // Per-load statements collapse to one line per product, keeping the
  // load count and date range for the record.
  load_count?: number | null;
  date_from?: string | null;
  date_to?: string | null;
}

// Pre-0018 settlement lines stored { tons, price_per_ton }.
export function normalizeSettlementLine(
  raw: Partial<SettlementLine> & { tons?: number; price_per_ton?: number }
): SettlementLine {
  return {
    product: raw.product ?? "",
    label: raw.label ?? "",
    quantity: raw.quantity ?? raw.tons ?? 0,
    unit: raw.unit === "mbf" ? "mbf" : "ton",
    rate: raw.rate ?? raw.price_per_ton ?? 0,
    amount: raw.amount ?? 0,
    load_count: raw.load_count ?? null,
    date_from: raw.date_from ?? null,
    date_to: raw.date_to ?? null,
  };
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
