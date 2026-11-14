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

export type GovPaymentTreatment = "landowner_share" | "tenant_retains";
export type GovPaymentReceivedVia = "fsa_direct" | "tenant_remits";

export const GOV_TREATMENT_LABELS: Record<GovPaymentTreatment, string> = {
  landowner_share: "Landowner receives a share of government payments",
  tenant_retains: "Tenant retains all government payments",
};
export const GOV_RECEIVED_VIA_LABELS: Record<GovPaymentReceivedVia, string> = {
  fsa_direct: "FSA pays me directly (I am a party on the farm record)",
  tenant_remits: "Tenant remits my share",
};

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
  // Government payments (ARC/PLC on the leased base acres) are an
  // EXPLICIT choice on crop share and flex leases: the landowner
  // receives a share (percent, prefilled from the crop share) or the
  // tenant retains all. When the landowner receives a share, how it
  // arrives matters for payment matching: FSA pays the landowner
  // directly (never expected in a tenant check) or the tenant remits it
  // (an expected payment the rent upload can match).
  gov_payment_treatment?: GovPaymentTreatment | null;
  gov_payment_share_pct?: number | null;
  gov_payment_received_via?: GovPaymentReceivedVia | null;
  gov_payment_clause?: string | null; // verbatim clause from extraction
  // hunting
  hunt_basis?: "lump_sum" | "per_acre" | null;
  amount?: number | null;
  hunt_rate_per_acre?: number | null;
  insurance_required?: boolean | null;
}

export interface ResolvedGovTreatment {
  treatment: GovPaymentTreatment;
  sharePct: number; // 0 when the tenant retains all
  receivedVia: GovPaymentReceivedVia | null;
  chosen: boolean; // false = migrated default, not yet confirmed by the user
  needsReceivedVia: boolean; // landowner share chosen but how it arrives is unknown
}

// Resolves the explicit treatment with the in-app migration rule for
// leases saved before the choice existed: a nonzero share means the
// landowner receives a share (how it arrives unknown), otherwise the
// tenant retains all; either way flagged as not chosen until saved.
export function govPaymentTreatment(terms: LeaseTerms | null | undefined): ResolvedGovTreatment {
  const t = terms ?? {};
  const pct = Number(t.gov_payment_share_pct ?? 0) || 0;
  if (t.gov_payment_treatment === "landowner_share") {
    return {
      treatment: "landowner_share",
      sharePct: pct,
      receivedVia: t.gov_payment_received_via ?? null,
      chosen: true,
      needsReceivedVia: !t.gov_payment_received_via,
    };
  }
  if (t.gov_payment_treatment === "tenant_retains") {
    return { treatment: "tenant_retains", sharePct: 0, receivedVia: null, chosen: true, needsReceivedVia: false };
  }
  if (pct > 0) {
    return {
      treatment: "landowner_share",
      sharePct: pct,
      receivedVia: t.gov_payment_received_via ?? null,
      chosen: false,
      needsReceivedVia: !t.gov_payment_received_via,
    };
  }
  return { treatment: "tenant_retains", sharePct: 0, receivedVia: null, chosen: false, needsReceivedVia: false };
}

// Plain sentence for lease pages and the Government Payments page.
export function govTreatmentSentence(terms: LeaseTerms | null | undefined): string {
  const r = govPaymentTreatment(terms);
  if (!r.chosen && r.treatment === "tenant_retains") return "Government payments: not chosen yet";
  if (r.treatment === "tenant_retains") return "Tenant keeps all government payments";
  const via =
    r.receivedVia === "fsa_direct"
      ? ", paid to you by FSA directly"
      : r.receivedVia === "tenant_remits"
        ? ", remitted by the tenant"
        : " (confirm how it is received)";
  return `You receive ${r.sharePct}% of ARC/PLC payments on this land${via}${r.chosen ? "" : " (confirm)"}`;
}

// Expected-payment rows for the government share carry this label
// prefix so income views and the rent upload recognize them.
export const GOV_SHARE_LABEL_PREFIX = "Government payment share";
export function isGovShareLabel(label: string | null | undefined): boolean {
  return (label ?? "").startsWith(GOV_SHARE_LABEL_PREFIX);
}
export function govShareLabel(programYear: number): string {
  return `${GOV_SHARE_LABEL_PREFIX} (program year ${programYear})`;
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

// The canonical persisted shape of crop entries: every field present
// (null when empty) and a sources object only for values that still
// carry provenance. The assumption row editor and the drift accept
// helper both write through this so the saved shape never diverges.
export function normalizeCropEntries(entries: CropAssumption[]): CropAssumption[] {
  const VALUE_FIELDS = ["acres", "expected_yield", "expected_price"] as const;
  return entries.map((e) => {
    const sources: NonNullable<CropAssumption["sources"]> = {};
    for (const field of VALUE_FIELDS) {
      const s = e.sources?.[field];
      if (s && e[field] != null) sources[field] = s;
    }
    return {
      crop: e.crop ?? null,
      practice: e.practice ?? null,
      acres: e.acres ?? null,
      expected_yield: e.expected_yield ?? null,
      expected_price: e.expected_price ?? null,
      expected_shared_expenses: e.expected_shared_expenses ?? null,
      ...(Object.keys(sources).length > 0 ? { sources } : {}),
    };
  });
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

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// The last day a schedule entry may name for a month (1-12). February
// allows the 29th: generation moves it to the 28th outside leap years.
export function maxScheduleDay(month: number): number {
  if (month === 2) return 29;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

// What is wrong with a schedule's due dates, as one plain sentence for
// the lease form, or null when every row that carries a percent or an
// amount names a real month and day. (Blank rows are ignored here as
// they are by generation.)
export function scheduleProblem(schedule: SchedulePayment[]): string | null {
  for (const [i, p] of schedule.entries()) {
    if (!p.percent && !p.amount) continue;
    const name = p.label?.trim() || `Payment ${i + 1}`;
    if (!Number.isInteger(p.month) || p.month < 1 || p.month > 12) {
      return `${name}: the due month must be a number from 1 to 12.`;
    }
    const max = maxScheduleDay(p.month);
    if (!Number.isInteger(p.day) || p.day < 1 || p.day > max) {
      return `${name}: ${MONTH_NAMES[p.month - 1]} has ${max} days, so the due day must be from 1 to ${max}.`;
    }
  }
  return null;
}

// A percent schedule should account for the whole year's rent. Returns
// the total of a percent-only schedule and whether it counts as 100
// (within a tenth of a percent, so thirds entered as 33.33 or 33.3 do);
// null when there is nothing to check (no schedule, or fixed dollar
// amounts).
const PERCENT_TOTAL_TOLERANCE = 0.1;
export function schedulePercentTotal(
  schedule: SchedulePayment[]
): { total: number; full: boolean } | null {
  const real = schedule.filter((p) => p.percent || p.amount);
  if (real.length === 0) return null;
  if (real.some((p) => p.amount !== null && p.amount !== undefined)) return null;
  const total = Math.round(real.reduce((s, p) => s + (p.percent ?? 0), 0) * 100) / 100;
  return { total, full: Math.abs(total - 100) <= PERCENT_TOTAL_TOLERANCE + 1e-9 };
}

// A real calendar date for a schedule entry in one year: the month is
// held to 1-12 and the day to that month's length, so 6/31 reads June 30
// and 2/29 reads February 28 outside leap years. (An impossible date
// used to reach the database and fail the whole insert.)
function isoDate(year: number, month: number, day: number): string {
  const m = Math.min(Math.max(Math.trunc(month) || 1, 1), 12);
  const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const d = Math.min(Math.max(Math.trunc(day) || 1, 1), lastDay);
  return `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// The same month and day some years later (February 29 lands on the 28th).
function addYears(date: string, years: number): string {
  return isoDate(
    Number(date.slice(0, 4)) + years,
    Number(date.slice(5, 7)),
    Number(date.slice(8, 10))
  );
}

interface TermPlan {
  startYear: number;
  endYear: number;
  schedule: SchedulePayment[];
  due: Set<string>; // `${year}|${index into schedule}` per installment that falls due
}

// The schedule in effect and which of its installments fall due over the
// lease term. An installment falls due when its date is inside
// start_date..end_date: a July-to-June lease paid each July 1 owes ONE
// payment, not one for each calendar year it touches. One allowance: a
// first-year installment dated before the start is still owed when the
// term would otherwise hold fewer of them than it has lease years (a
// lease starting February 1 with rent due January 1 still owes its
// first year).
function termPlan(lease: LeaseLike): TermPlan | null {
  if (!lease.start_date || !lease.end_date) return null;
  const startYear = Number(lease.start_date.slice(0, 4));
  const endYear = Number(lease.end_date.slice(0, 4));
  if (!startYear || !endYear || endYear < startYear || endYear - startYear > 50) return null;
  const start = lease.start_date.slice(0, 10);
  const end = lease.end_date.slice(0, 10);

  // Blank schedule rows (no percent and no fixed amount; the form can
  // save empty ones) must not silently zero out generation: ignore
  // them, and with nothing real left fall back to one annual payment.
  const realSchedule = lease.payment_schedule.filter((p) => p.percent || p.amount);
  const schedule =
    realSchedule.length > 0
      ? realSchedule
      : [{ label: "Annual payment", month: 1, day: 1, percent: 100 }];

  // Lease years: the 12-month periods the term starts.
  let leaseYears = 0;
  while (leaseYears <= 51 && addYears(start, leaseYears) <= end) leaseYears++;

  const due = new Set<string>();
  schedule.forEach((p, index) => {
    let inTerm = 0;
    for (let year = startYear; year <= endYear; year++) {
      const date = isoDate(year, p.month, p.day);
      if (date < start || date > end) continue;
      due.add(`${year}|${index}`);
      inTerm++;
    }
    if (inTerm < leaseYears && isoDate(startYear, p.month, p.day) < start) {
      due.add(`${startYear}|${index}`);
    }
  });
  return { startYear, endYear, schedule, due };
}

// Dollar amount of each schedule entry for one year's rent. Fixed
// amounts pass through; percents round to the cent, and when a
// percent-only schedule totals 100 the last entry takes what is left, so
// the installments add up to the rent exactly.
function installmentAmounts(schedule: SchedulePayment[], annual: number): number[] {
  const amounts = schedule.map((p) =>
    p.amount !== null && p.amount !== undefined
      ? p.amount
      : Math.round(annual * ((p.percent ?? 0) / 100) * 100) / 100
  );
  if (schedulePercentTotal(schedule)?.full) {
    const last = amounts.length - 1;
    const before = amounts.slice(0, last).reduce((s, a) => s + a, 0);
    amounts[last] = Math.round((annual - before) * 100) / 100;
  }
  return amounts;
}

// The calendar years in which the lease has rent falling due.
export function rentDueYears(lease: LeaseLike): number[] {
  const plan = termPlan(lease);
  if (!plan) return [];
  const years = new Set<number>();
  for (const key of plan.due) years.add(Number(key.split("|")[0]));
  return Array.from(years).sort((a, b) => a - b);
}

// The part of one calendar year's rent that falls due inside the term:
// 1 when every installment of the year does (the usual case), 0 when
// none does, in between when a term that starts or ends mid-year takes
// only some of them. annual is that year's rent (it weighs fixed dollar
// installments against percent ones).
export function rentShareDue(lease: LeaseLike, year: number, annual: number): number {
  const plan = termPlan(lease);
  if (!plan) return 0;
  const isDue = plan.schedule.map((_, i) => plan.due.has(`${year}|${i}`));
  const count = isDue.filter(Boolean).length;
  if (count === 0) return 0;
  if (count === plan.schedule.length) return 1;
  const amounts = installmentAmounts(plan.schedule, annual);
  const all = amounts.reduce((s, a) => s + a, 0);
  const part = amounts.reduce((s, a, i) => (isDue[i] ? s + a : s), 0);
  return all > 0 && part >= 0 ? part / all : count / plan.schedule.length;
}

// The installments of the lease's first and last calendar years that
// fall outside the lease dates and are therefore NOT expected (see
// termPlan). The lease form lists them, so a payment dated just after
// the lease ends never drops out without a word.
export function installmentsOutsideTerm(
  lease: LeaseLike
): Array<{ label: string; due_date: string; when: "before_start" | "after_end" }> {
  const plan = termPlan(lease);
  if (!plan || !lease.start_date) return [];
  const start = lease.start_date.slice(0, 10);
  const out: Array<{ label: string; due_date: string; when: "before_start" | "after_end" }> = [];
  plan.schedule.forEach((p, i) => {
    for (const year of new Set([plan.startYear, plan.endYear])) {
      if (plan.due.has(`${year}|${i}`)) continue;
      const due_date = isoDate(year, p.month, p.day);
      out.push({
        label: p.label || "Payment",
        due_date,
        when: due_date < start ? "before_start" : "after_end",
      });
    }
  });
  return out;
}

// A generated rent row that no longer counts as expected: the lease is
// over (expired or terminated), the row belongs to a LEASE YEAR after
// the year the lease ended, and no money has been recorded against it.
// Rows for the years of the term keep counting whatever the status, so
// marking a lease expired never rewrites its history.
//
// The lease year decides this, never the due date. Rent for a lease
// year is often due after the lease's last day: a crop share lease that
// ends December 31 is settled at final prices the following summer, and
// that payment is still owed after the lease is marked expired. (A lease
// ended early has its end date moved to the day it ended, and then the
// rows for the years after that one drop out.)
export function isLapsedExpectedRow(
  lease: { status?: unknown; end_date?: unknown },
  row: { year: number },
  received: number
): boolean {
  if (lease.status !== "expired" && lease.status !== "terminated") return false;
  if (typeof lease.end_date !== "string" || lease.end_date === "" || received > 0) return false;
  const endYear = Number(lease.end_date.slice(0, 4));
  return Number.isFinite(endYear) && Number(row.year) > endYear;
}

// Expected payment rows for every installment that falls due over the
// lease term (see termPlan). The caller diffs these against existing
// rows (never touching rows that have payments).
// govShareByProgramYear: the landowner's projected share per PROGRAM
// year (from lib/income.ts govShareByYearForLease). A row is generated
// ONLY when the landowner receives a share AND the tenant remits it; it
// lands in the PAYMENT year (program year + 1, due October 1), the date
// FSA money reaches the operator. FSA-direct shares never become rows:
// that money is not expected in a tenant check.
export function generateLeasePayments(
  lease: LeaseLike,
  totalLeasedAcres: number,
  assumptionsByYear: Map<number, YearAssumptions>,
  govShareByProgramYear?: Map<number, number> | null
): GeneratedPayment[] {
  const plan = termPlan(lease);
  if (!plan) return [];
  const { startYear, endYear, schedule } = plan;

  const rows: GeneratedPayment[] = [];
  for (let year = startYear; year <= endYear; year++) {
    const annual = annualRent(lease, totalLeasedAcres, assumptionsByYear.get(year));
    if (annual === null) continue;
    const amounts = installmentAmounts(schedule, annual);
    schedule.forEach((p, i) => {
      if (!plan.due.has(`${year}|${i}`)) return; // outside the lease term
      const amount = amounts[i];
      if (!amount) return;
      rows.push({
        year,
        label: p.label || "Payment",
        due_date: isoDate(year, p.month, p.day),
        expected_amount: amount,
      });
    });
  }
  const gov = govPaymentTreatment(lease.terms);
  if (
    govShareByProgramYear &&
    gov.treatment === "landowner_share" &&
    gov.receivedVia === "tenant_remits" &&
    (lease.rent_structure === "crop_share" || lease.rent_structure === "flex")
  ) {
    for (let year = startYear; year <= endYear; year++) {
      const amount = Math.round((govShareByProgramYear.get(year) ?? 0) * 100) / 100;
      if (!(amount > 0)) continue;
      rows.push({
        year: year + 1,
        label: govShareLabel(year),
        due_date: `${year + 1}-10-01`,
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

// ---------------------------------------------------------------- refresh

export interface ExistingExpectedRow {
  id: string;
  year: number;
  label: string;
  due_date: string;
}

// What "Refresh expected payments" does to the rows in the database.
// Every unpaid row is replaced by the new schedule. A row with money
// recorded against it is never touched; it stands for ONE installment of
// the new schedule, which is then not added again. Which one: the
// installment with the same label and date while it still exists;
// otherwise (the label or date was edited) the installment in the same
// position of its year, or the closest due date when the year no longer
// has as many rows as the schedule has installments. Years match
// separately, and government share rows only with each other. (Matching
// on label and date alone added an unpaid copy of an already-paid
// installment as soon as either was edited.)
export function planScheduleRefresh(
  existing: ExistingExpectedRow[],
  paidIds: ReadonlySet<string>,
  target: GeneratedPayment[]
): { deleteIds: string[]; inserts: GeneratedPayment[] } {
  const groupOf = (r: { year: number; label: string }) =>
    `${r.year}|${isGovShareLabel(r.label) ? "gov" : "rent"}`;
  const byDate = (a: { due_date: string }, b: { due_date: string }) =>
    a.due_date.localeCompare(b.due_date);
  const dayNumber = (d: string) => Date.parse(d.slice(0, 10) + "T00:00:00Z") / 86400000;
  const covered = new Set<GeneratedPayment>();
  const open = (t: GeneratedPayment) => !covered.has(t);

  const paidGroups = new Set(existing.filter((e) => paidIds.has(e.id)).map(groupOf));
  for (const group of paidGroups) {
    const rows = existing.filter((e) => groupOf(e) === group).sort(byDate);
    const targets = target.filter((t) => groupOf(t) === group).sort(byDate);
    const edited: ExistingExpectedRow[] = [];
    for (const kept of rows.filter((r) => paidIds.has(r.id))) {
      const same = targets.find(
        (t) => open(t) && t.label === kept.label && t.due_date === kept.due_date
      );
      if (same) covered.add(same);
      else edited.push(kept);
    }
    for (const kept of edited) {
      const atPosition = rows.length === targets.length ? targets[rows.indexOf(kept)] : undefined;
      const distance = (t: GeneratedPayment) =>
        Math.abs(dayNumber(t.due_date) - dayNumber(kept.due_date));
      const match =
        atPosition && open(atPosition)
          ? atPosition
          : targets.filter(open).sort((a, b) => distance(a) - distance(b))[0];
      if (match) covered.add(match);
    }
  }
  return {
    deleteIds: existing.filter((e) => !paidIds.has(e.id)).map((e) => e.id),
    inserts: target.filter(open),
  };
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
