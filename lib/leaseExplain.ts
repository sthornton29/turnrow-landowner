// The story behind one lease-year's number. annualRent() in leaseLogic.ts
// returns a single figure; this module returns every piece that went
// into it (each factor with where it came from), which basis won
// (a generated payment schedule or the projection), and what has
// actually been received against it. Pure: the breakdown page and the
// Income page's by-lease rows both read from here, and the tests pin
// the arithmetic to annualRent's.

import {
  annualRent,
  cropAssumptions,
  paymentStatus,
  type CropPractice,
  type LeaseLike,
  type PaymentStatus,
  type ValueSource,
  type ValueSourceKind,
  type YearAssumptions,
} from "./leaseLogic";
import type { GovShareRow } from "./income";

export type RentStructureKey =
  | "cash_per_acre"
  | "cash_lump_sum"
  | "flex"
  | "crop_share"
  | "hunting_per_acre"
  | "hunting_lump_sum"
  | "unknown";

export const STRUCTURE_LABELS: Record<RentStructureKey, string> = {
  cash_per_acre: "Cash rent per acre",
  cash_lump_sum: "Cash rent, lump sum",
  flex: "Flex lease",
  crop_share: "Crop share",
  hunting_per_acre: "Hunting lease per acre",
  hunting_lump_sum: "Hunting lease, lump sum",
  unknown: "Lease",
};

// What "Expected" rests on for the year.
//   schedule    generated expected payments exist; their sum is the number
//   projection  computed from terms and the year's assumptions
//   incomplete  a projection was attempted but an input is missing
//   none        the lease does not project this year (expired, no dates)
export type ExpectedBasis = "schedule" | "projection" | "incomplete" | "none";

export const BASIS_LABELS: Record<ExpectedBasis, string> = {
  schedule: "Payment schedule",
  projection: "Projection",
  incomplete: "Incomplete",
  none: "Not projected",
};

// One input to the arithmetic, with its provenance. A value filled from
// tenant data carries a source; a value typed by hand carries none and
// is never changed automatically.
export interface Factor {
  label: string;
  value: number | null;
  unit: string; // "ac", "bu/ac", "$/bu", "%", "$", "$/ac"
  source: ValueSource | null;
  fromTerms?: boolean; // lives in the lease terms, not the year's assumptions
}

export interface CropStep {
  crop: string;
  practice: CropPractice;
  unit: "bu" | "lb" | "ton";
  acres: Factor;
  expectedYield: Factor;
  price: Factor;
  production: number | null; // acres x yield
  cropValue: number | null; // production x price
  sharePct: number;
  yourShare: number | null; // cropValue x share
  sharedExpenses: number | null; // dollars, when the lease shares expenses
  net: number | null; // yourShare - expenses
  missing: string[]; // "acres", "yield", "price" when blank
}

export interface ScheduleLine {
  id: string;
  label: string;
  dueDate: string;
  expected: number;
  received: number;
  status: PaymentStatus;
}

export interface LeaseYearExplanation {
  year: number;
  structure: RentStructureKey;
  structureLabel: string;
  basis: ExpectedBasis;
  basisLabel: string;
  // One plain sentence a landowner can read without the math.
  headline: string;
  expected: number;
  received: number;
  outstanding: number;
  projection: number | null; // annualRent for the year (null = incomplete)
  scheduleTotal: number | null; // sum of generated rows (null = none)
  totalAcres: number;
  lands: Array<{ propertyId: string; propertyName: string; acres: number }>;
  // Structure-specific arithmetic (exactly one is set for a known structure)
  cash: { rate: Factor; acres: Factor; lumpSum: Factor | null } | null;
  flex: {
    baseRate: Factor;
    acres: Factor;
    baseTotal: number | null;
    bonus: Factor;
    bonusDescription: string | null;
  } | null;
  cropShare: {
    sharePct: number;
    sharesExpenses: boolean;
    crops: CropStep[];
    subtotal: number | null;
  } | null;
  hunting: { rate: Factor | null; acres: Factor | null; amount: Factor | null } | null;
  schedule: ScheduleLine[];
  unscheduledPayments: Array<{ date: string; amount: number; memo: string | null }>;
  gov: {
    sharePct: number;
    tenantAmount: number;
    landownerAmount: number;
    receivedVia: GovShareRow["receivedVia"];
    generated: boolean;
  } | null;
  missing: string[]; // plain-language list when incomplete
  sourceKinds: ValueSourceKind[]; // which tenant sources appear anywhere
  handEntered: boolean; // any assumption value typed by hand
}

export interface ExplainArgs {
  lease: LeaseLike & { status: string };
  year: number;
  lands: Array<{ propertyId: string; propertyName: string; leasedAcres: number | null }>;
  assumptions: YearAssumptions | undefined;
  // Generated expected rows for this lease-year, rent only (government
  // share rows are their own income type and are passed in via gov).
  expectedRows: Array<{ id: string; label: string; due_date: string; expected_amount: number }>;
  // Every payment recorded on the lease. Received for the year counts
  // those dated in the year (the Income page's rule); rows matched to
  // a schedule line count toward that line.
  payments: Array<{
    amount: number;
    received_date: string;
    expected_payment_id: string | null;
    memo?: string | null;
  }>;
  gov: GovShareRow[]; // rows for this lease and payment year (any property)
  today?: Date;
}

export function cropUnit(crop: string | null | undefined): CropStep["unit"] {
  const c = (crop ?? "").toLowerCase();
  if (/cotton/.test(c)) return "lb";
  if (/hay|forage|silage/.test(c)) return "ton";
  return "bu";
}

export function structureOf(lease: LeaseLike): RentStructureKey {
  const t = lease.terms ?? {};
  if (lease.lease_type === "hunting") {
    return t.hunt_basis === "per_acre" ? "hunting_per_acre" : "hunting_lump_sum";
  }
  switch (lease.rent_structure) {
    case "cash":
      return t.cash_basis === "lump_sum" ? "cash_lump_sum" : "cash_per_acre";
    case "flex":
      return "flex";
    case "crop_share":
      return "crop_share";
    default:
      return "unknown";
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function factor(
  label: string,
  value: number | null | undefined,
  unit: string,
  source?: ValueSource | null,
  fromTerms?: boolean
): Factor {
  return { label, value: value ?? null, unit, source: source ?? null, fromTerms };
}

export function explainLeaseYear(args: ExplainArgs): LeaseYearExplanation {
  const { lease, year, assumptions } = args;
  const t = lease.terms ?? {};
  const today = args.today ?? new Date();
  const structure = structureOf(lease);

  const lands = args.lands.map((l) => ({
    propertyId: l.propertyId,
    propertyName: l.propertyName,
    acres: l.leasedAcres ?? 0,
  }));
  const totalAcres = lands.reduce((s, l) => s + l.acres, 0);
  const acresFactor = factor("Leased acres", totalAcres, "ac");

  // ---- the projection, piece by piece
  const projection = annualRent(lease, totalAcres, assumptions);
  const missing: string[] = [];
  const sourceKinds = new Set<ValueSourceKind>();
  let handEntered = false;
  const note = (s: ValueSource | null | undefined) => {
    if (s?.kind) sourceKinds.add(s.kind);
    else handEntered = true;
  };

  let cash: LeaseYearExplanation["cash"] = null;
  let flex: LeaseYearExplanation["flex"] = null;
  let cropShare: LeaseYearExplanation["cropShare"] = null;
  let hunting: LeaseYearExplanation["hunting"] = null;

  if (structure === "cash_per_acre") {
    cash = {
      rate: factor("Rate per acre", t.rate_per_acre, "$/ac", null, true),
      acres: acresFactor,
      lumpSum: null,
    };
    if (!t.rate_per_acre) missing.push("the rate per acre in the lease terms");
    if (totalAcres <= 0) missing.push("leased acres (link land to the lease)");
  } else if (structure === "cash_lump_sum") {
    cash = {
      rate: factor("Rate per acre", null, "$/ac", null, true),
      acres: acresFactor,
      lumpSum: factor("Annual lump sum", t.lump_sum, "$", null, true),
    };
    if (t.lump_sum == null) missing.push("the lump sum in the lease terms");
  } else if (structure === "flex") {
    const baseTotal =
      t.base_rate_per_acre ? round2(t.base_rate_per_acre * totalAcres) : null;
    flex = {
      baseRate: factor("Base rate per acre", t.base_rate_per_acre, "$/ac", null, true),
      acres: acresFactor,
      baseTotal,
      bonus: factor("Bonus estimate", assumptions?.bonus_estimate ?? 0, "$"),
      bonusDescription: t.bonus_description ?? null,
    };
    if (!t.base_rate_per_acre) missing.push("the base rate per acre in the lease terms");
    if (totalAcres <= 0) missing.push("leased acres (link land to the lease)");
    if (assumptions?.bonus_estimate != null) handEntered = true;
  } else if (structure === "crop_share") {
    const sharePct = t.landowner_share_pct ?? 0;
    const sharesExpenses = !!t.shares_expenses;
    const entries = cropAssumptions(assumptions);
    if (!t.landowner_share_pct) missing.push("your share percent in the lease terms");
    if (entries.length === 0) missing.push(`crop assumptions for ${year} (acres, yield, price per crop)`);
    const crops: CropStep[] = entries.map((e) => {
      const unit = cropUnit(e.crop);
      const acres = factor("Acres", e.acres, "ac", e.sources?.acres);
      const expectedYield = factor("Yield", e.expected_yield, `${unit}/ac`, e.sources?.expected_yield);
      const price = factor("Price", e.expected_price, `$/${unit}`, e.sources?.expected_price);
      note(e.sources?.acres);
      note(e.sources?.expected_yield);
      note(e.sources?.expected_price);
      const rowMissing: string[] = [];
      if (!e.acres) rowMissing.push("acres");
      if (!e.expected_yield) rowMissing.push("yield");
      if (!e.expected_price) rowMissing.push("price");
      const complete = rowMissing.length === 0 && sharePct > 0;
      const production = complete ? e.acres! * e.expected_yield! : null;
      const cropValue = complete ? production! * e.expected_price! : null;
      const yourShare = complete ? cropValue! * (sharePct / 100) : null;
      const sharedExpenses = sharesExpenses ? (e.expected_shared_expenses ?? 0) : null;
      const net = complete ? yourShare! - (sharedExpenses ?? 0) : null;
      const cropName = e.crop?.trim() || "Crop";
      for (const m of rowMissing) missing.push(`${m} for ${cropName}`);
      return {
        crop: cropName,
        practice: e.practice ?? "blended",
        unit,
        acres,
        expectedYield,
        price,
        production,
        cropValue,
        sharePct,
        yourShare,
        sharedExpenses,
        net,
        missing: rowMissing,
      };
    });
    const subtotal = crops.every((c) => c.net !== null) && crops.length > 0
      ? crops.reduce((s, c) => s + (c.net ?? 0), 0)
      : null;
    cropShare = { sharePct, sharesExpenses, crops, subtotal };
  } else if (structure === "hunting_per_acre") {
    hunting = {
      rate: factor("Rate per acre", t.hunt_rate_per_acre, "$/ac", null, true),
      acres: acresFactor,
      amount: null,
    };
    if (!t.hunt_rate_per_acre) missing.push("the rate per acre in the lease terms");
  } else if (structure === "hunting_lump_sum") {
    hunting = {
      rate: null,
      acres: null,
      amount: factor("Annual amount", t.amount, "$", null, true),
    };
    if (t.amount == null) missing.push("the annual amount in the lease terms");
  }

  // ---- schedule and received
  const receivedByRow = new Map<string, number>();
  const unscheduledPayments: LeaseYearExplanation["unscheduledPayments"] = [];
  let received = 0;
  const rowIds = new Set(args.expectedRows.map((r) => r.id));
  for (const p of args.payments) {
    const inYear = Number(p.received_date.slice(0, 4)) === year;
    if (p.expected_payment_id && rowIds.has(p.expected_payment_id)) {
      receivedByRow.set(
        p.expected_payment_id,
        (receivedByRow.get(p.expected_payment_id) ?? 0) + p.amount
      );
    } else if (inYear) {
      unscheduledPayments.push({ date: p.received_date, amount: p.amount, memo: p.memo ?? null });
    }
    if (inYear) received += p.amount;
  }
  const schedule: ScheduleLine[] = args.expectedRows
    .slice()
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
    .map((r) => {
      const got = receivedByRow.get(r.id) ?? 0;
      return {
        id: r.id,
        label: r.label || "Payment",
        dueDate: r.due_date,
        expected: r.expected_amount,
        received: got,
        status: paymentStatus(r.expected_amount, got, r.due_date, today),
      };
    });
  const scheduleTotal =
    schedule.length > 0 ? schedule.reduce((s, r) => s + r.expected, 0) : null;

  // ---- which basis wins (the Income page's rule)
  const projects =
    lease.status !== "expired" &&
    lease.status !== "terminated" &&
    !!lease.start_date &&
    !!lease.end_date &&
    year >= Number(lease.start_date.slice(0, 4)) &&
    year <= Number(lease.end_date.slice(0, 4));
  let basis: ExpectedBasis;
  let expected: number;
  if (scheduleTotal !== null) {
    basis = "schedule";
    expected = scheduleTotal;
  } else if (!projects) {
    basis = "none";
    expected = 0;
  } else if (projection === null || projection === 0) {
    basis = projection === 0 ? "projection" : "incomplete";
    expected = 0;
  } else {
    basis = "projection";
    expected = projection;
  }

  // ---- government share (counted under Government payments, not rent)
  const govRows = args.gov.filter((r) => r.paymentYear === year);
  const gov =
    govRows.length > 0
      ? {
          sharePct: govRows[0].sharePct,
          tenantAmount: govRows.reduce((s, r) => s + r.tenantAmount, 0),
          landownerAmount: govRows.reduce((s, r) => s + r.landownerAmount, 0),
          receivedVia: govRows[0].receivedVia,
          generated: govRows.some((r) => r.generated),
        }
      : null;

  const structureLabel = STRUCTURE_LABELS[structure];
  const headline = headlineFor({
    structure,
    basis,
    year,
    expected,
    totalAcres,
    cash,
    flex,
    cropShare,
    hunting,
    scheduleCount: schedule.length,
  });

  return {
    year,
    structure,
    structureLabel,
    basis,
    basisLabel: BASIS_LABELS[basis],
    headline,
    expected,
    received,
    outstanding: Math.max(expected - received, 0),
    projection,
    scheduleTotal,
    totalAcres,
    lands,
    cash,
    flex,
    cropShare,
    hunting,
    schedule,
    unscheduledPayments,
    gov,
    missing,
    sourceKinds: Array.from(sourceKinds),
    handEntered,
  };
}

const money = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const acresText = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " acres";

function headlineFor(x: {
  structure: RentStructureKey;
  basis: ExpectedBasis;
  year: number;
  expected: number;
  totalAcres: number;
  cash: LeaseYearExplanation["cash"];
  flex: LeaseYearExplanation["flex"];
  cropShare: LeaseYearExplanation["cropShare"];
  hunting: LeaseYearExplanation["hunting"];
  scheduleCount: number;
}): string {
  if (x.basis === "none") {
    return `This lease is not projected for ${x.year}: it is outside the lease dates or no longer active.`;
  }
  if (x.basis === "incomplete") {
    return `${x.year} cannot be projected yet because an input is missing. Fill it in and the number appears here.`;
  }
  if (x.basis === "schedule") {
    return `${x.year} expected rent is the ${x.scheduleCount} scheduled payment${x.scheduleCount === 1 ? "" : "s"} you generated for this lease, ${money(x.expected)} in all. The schedule replaces the projection.`;
  }
  switch (x.structure) {
    case "cash_per_acre":
      return `${money(x.expected)}: ${acresText(x.totalAcres)} at ${money(x.cash?.rate.value ?? 0)} an acre.`;
    case "cash_lump_sum":
      return `${money(x.expected)}: the fixed annual amount in the lease terms.`;
    case "flex":
      return `${money(x.expected)}: a base of ${money(x.flex?.baseTotal ?? 0)} (${acresText(x.totalAcres)} at ${money(x.flex?.baseRate.value ?? 0)} an acre) plus a ${money(x.flex?.bonus.value ?? 0)} bonus estimate.`;
    case "crop_share": {
      const n = x.cropShare?.crops.length ?? 0;
      return `${money(x.expected)}: your ${x.cropShare?.sharePct ?? 0}% share of what ${n} crop${n === 1 ? "" : "s"} ${n === 1 ? "is" : "are"} projected to be worth this year${x.cropShare?.sharesExpenses ? ", less your share of expenses" : ""}.`;
    }
    case "hunting_per_acre":
      return `${money(x.expected)}: ${acresText(x.totalAcres)} at ${money(x.hunting?.rate?.value ?? 0)} an acre.`;
    case "hunting_lump_sum":
      return `${money(x.expected)}: the annual hunting lease amount.`;
    default:
      return `${money(x.expected)} expected for ${x.year}.`;
  }
}
