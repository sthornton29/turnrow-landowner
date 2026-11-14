// REPLANTING DEDUCTION (IRC Sec 194) with cost-share netting (Sec 126).
// Pure and unit-tested. Sources: USDA FS-1275 Tax Tips for Forest
// Landowners (2025 tax year); 26 USC 194 (docs/research/2026-11-09).
//
//   * Each qualified timber property (here: a property with timber) may
//     deduct up to $10,000 of reforestation costs per tax year right away
//     (194(b)); trusts get no immediate deduction.
//   * The rest is amortized over 84 months (194(a)) with the half-year
//     convention: 1/14 in the year paid, 1/7 in each of the next six
//     years, 1/14 in the eighth.
//   * Cost-share EXCLUDED from income under Sec 126 cannot also be
//     deducted: it comes off the costs it paid for.
// Every number is for the accountant, who makes the actual elections.

export const SEC194_CAP = 10000;

export interface ReforestationCost {
  paid_date: string;
  amount: number;
  cost_share_award_id?: string | null;
}

export interface YearResult {
  year: number;
  eligible: number; // reforestation costs paid that year
  costShareExcluded: number; // excluded cost-share netted out
  net: number;
  expensed: number; // 194(b)
  amortizable: number; // 194(a)
  schedule: Array<{ year: number; amount: number }>;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function amortizationSchedule(amount: number, startYear: number): Array<{ year: number; amount: number }> {
  if (!(amount > 0)) return [];
  const half = r2(amount / 14);
  const full = r2(amount / 7);
  const out = [{ year: startYear, amount: half }];
  for (let i = 1; i <= 6; i++) out.push({ year: startYear + i, amount: full });
  const so = out.reduce((s, x) => s + x.amount, 0);
  out.push({ year: startYear + 7, amount: r2(amount - so) });
  return out;
}

// excludedByAward: total Sec 126 EXCLUDED dollars received per award.
// It nets against that award's linked reforestation costs, earliest
// first, never below zero.
export function reforestationByYear(
  costs: ReforestationCost[],
  excludedByAward: Map<string, number>,
  opts: { isTrust?: boolean; cap?: number } = {}
): YearResult[] {
  const cap = opts.isTrust ? 0 : (opts.cap ?? SEC194_CAP);
  const remaining = new Map(excludedByAward);
  const byYear = new Map<number, { eligible: number; excluded: number }>();
  const sorted = [...costs].sort((a, b) => a.paid_date.localeCompare(b.paid_date));
  for (const c of sorted) {
    const year = Number(c.paid_date.slice(0, 4));
    const amt = Number(c.amount) || 0;
    let netted = 0;
    if (c.cost_share_award_id && remaining.has(c.cost_share_award_id)) {
      const left = remaining.get(c.cost_share_award_id)!;
      netted = Math.min(left, amt);
      remaining.set(c.cost_share_award_id, left - netted);
    }
    const cur = byYear.get(year) ?? { eligible: 0, excluded: 0 };
    cur.eligible += amt;
    cur.excluded += netted;
    byYear.set(year, cur);
  }
  return Array.from(byYear.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([year, v]) => {
      const net = r2(Math.max(0, v.eligible - v.excluded));
      const expensed = r2(Math.min(cap, net));
      const amortizable = r2(net - expensed);
      return {
        year,
        eligible: r2(v.eligible),
        costShareExcluded: r2(v.excluded),
        net,
        expensed,
        amortizable,
        schedule: amortizationSchedule(amortizable, year),
      };
    });
}

// The deduction for one tax year: this year's 194(b) amount plus every
// year's amortization falling in it.
export function deductionForYear(results: YearResult[], taxYear: number): {
  expensed: number;
  amortization: number;
  total: number;
} {
  const expensed = results.filter((r) => r.year === taxYear).reduce((s, r) => s + r.expensed, 0);
  const amortization = results
    .flatMap((r) => r.schedule)
    .filter((s) => s.year === taxYear)
    .reduce((s, x) => s + x.amount, 0);
  return { expensed: r2(expensed), amortization: r2(amortization), total: r2(expensed + amortization) };
}

// Recapture watch: Sec 194 amortization is recaptured on a sale of the
// property within 10 years; excluded Sec 126 cost-share within 20.
export function recaptureUntil(dateIso: string, years: number): string {
  const y = Number(dateIso.slice(0, 4)) + years;
  return `${y}${dateIso.slice(4, 10)}`;
}

export const PROGRAM_LABELS: Record<string, string> = {
  eqip: "NRCS EQIP",
  csp: "NRCS CSP",
  crp: "FSA CRP",
  afc_spb: "AFC Southern Pine Beetle Prevention",
  longleaf: "Longleaf Alliance / longleaf program",
  other: "Other program",
};

export const COST_SHARE_STATUS_LABELS: Record<string, string> = {
  applied: "Applied",
  active: "Active",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const SEC126_LABELS: Record<string, { label: string; help: string }> = {
  exclude: {
    label: "Exclude from income (Sec 126)",
    help: "Not taxed now, but the costs it paid for cannot be deducted, and it is recaptured if the land is sold within 20 years. The amount that can be excluded has a cap and not every program qualifies, so have your accountant confirm the figure.",
  },
  include: {
    label: "Report as income",
    help: "Taxed now, and the costs it paid for can be deducted or count toward the replanting deduction.",
  },
  undecided: {
    label: "Not decided yet",
    help: "Your accountant chooses when the return is prepared.",
  },
};
