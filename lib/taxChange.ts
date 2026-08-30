import { formatDollars } from "@/lib/format";
import type { TaxStatementLineRow } from "@/lib/tax";

// TAX CHANGE ANALYSIS over multi-year statement lines. One line per
// parcel per year is guaranteed by the (parcel_id, tax_year) unique
// index, so year-over-year joins are unambiguous. Everything here is
// pure and unit-tested (lib/taxChange.test.ts); the Property Taxes
// page and the PDF export render its output verbatim.
//
// The decomposition is the standard exact two-part split:
//   deltaTax = r0 * (v1 - v0)  +  v1 * (r1 - r0)
//   (valuation effect at the PRIOR rate) + (rate effect at the CURRENT
//   value); the cross term folds into the rate effect per standard
//   index-decomposition practice, and cents are folded so the two
//   parts always sum to the rounded delta exactly.

export interface ParcelYearFacts {
  appraised: number | null;
  assessed: number | null;
  taxDue: number;
  exemptions: string | null;
}

export type ParcelFlagKind =
  | "ratio_shift"
  | "exemption_change"
  | "spike"
  | "appeared"
  | "disappeared";

export interface ParcelFlag {
  kind: ParcelFlagKind;
  message: string;
}

export interface ParcelChange {
  parcelId: string;
  parcelNumber: string;
  county: string | null;
  propertyId: string | null;
  y0: ParcelYearFacts | null;
  y1: ParcelYearFacts | null;
  // Set only when both years have a line.
  deltaTax: number | null;
  deltaAppraised: number | null;
  pctAppraised: number | null; // fraction, e.g. 0.18
  rate0: number | null; // taxDue / appraised, per year
  rate1: number | null;
  valuationEffect: number | null;
  rateEffect: number | null;
  sentence: string | null; // the plain-language decomposition
  ratio0: number | null; // assessed / appraised, per year
  ratio1: number | null;
  flags: ParcelFlag[];
}

export interface TaxChangeReport {
  y0: number;
  y1: number;
  // Every year in [y0, y1] with its scoped totals (the trend chart).
  perYear: Array<{ year: number; totalTax: number; totalAppraised: number }>;
  summary: {
    tax0: number;
    tax1: number;
    taxPct: number | null;
    appraised0: number;
    appraised1: number;
    appraisedPct: number | null;
    comparedParcels: number;
    flaggedParcels: number;
  };
  // Both-years parcels, sorted by |tax change| descending.
  movers: ParcelChange[];
  // Everything carrying at least one flag (includes presence-only rows).
  flagged: ParcelChange[];
}

const round2 = (x: number) => Math.round(x * 100) / 100;

// Alabama assessment classes: Class III (agricultural / current use)
// assesses at 10% of value, Class II at 20%. Naming the class makes the
// ratio-shift flag actionable.
function ratioLabel(ratio: number): string {
  const pct = ratio * 100;
  if (Math.abs(pct - 10) <= 1.5) return "10% (Class III, current use)";
  if (Math.abs(pct - 20) <= 1.5) return "20% (Class II)";
  return `${pct.toFixed(1)}%`;
}

// Exemption strings are free text ("H1", "H1, OV65"); compare as token
// sets so reordering never flags.
function exemptionTokens(raw: string | null): string[] {
  return (raw ?? "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
}

function pctText(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

// The plain-language decomposition sentence.
export function decompositionSentence(
  deltaTax: number,
  valuationEffect: number,
  rateEffect: number
): string {
  const dir = deltaTax >= 0 ? "Up" : "Down";
  const parts: string[] = [];
  if (Math.abs(valuationEffect) >= 0.005) {
    parts.push(
      `${formatDollars(Math.abs(valuationEffect))} from ${valuationEffect >= 0 ? "higher" : "lower"} appraisal`
    );
  }
  if (Math.abs(rateEffect) >= 0.005) {
    parts.push(
      `${formatDollars(Math.abs(rateEffect))} from ${rateEffect >= 0 ? "" : "lower "}rates`
    );
  }
  if (parts.length === 0) return "No change.";
  return `${dir} ${formatDollars(Math.abs(deltaTax))}: ${parts.join(", ")}.`;
}

export function buildTaxChangeReport(
  lines: TaxStatementLineRow[],
  parcels: Array<{
    id: string;
    parcel_number: string;
    county: string | null;
    property_id: string | null;
  }>,
  options: {
    y0: number;
    y1: number;
    // null = every parcel the caller can see (RLS already scoped them).
    propertyIds?: Set<string> | null;
    county?: string | null;
    spikeThreshold?: number; // fraction; default 0.15
  }
): TaxChangeReport {
  const { y0, y1 } = options;
  const spikeThreshold = options.spikeThreshold ?? 0.15;
  const scopeProps = options.propertyIds ?? null;
  const county = options.county ?? null;

  const parcelById = new Map(parcels.map((p) => [p.id, p]));
  const inScope = (parcelId: string | null): boolean => {
    if (!parcelId) return false;
    const p = parcelById.get(parcelId);
    if (!p) return false;
    if (county && p.county !== county) return false;
    if (scopeProps && (!p.property_id || !scopeProps.has(p.property_id))) return false;
    return true;
  };

  // parcel -> year -> facts, real property matched lines only (personal
  // property has no parcel dimension; unmatched lines have no parcel).
  const facts = new Map<string, Map<number, ParcelYearFacts>>();
  for (const l of lines) {
    if (l.line_type !== "real_property") continue;
    if (!l.parcel_id || !inScope(l.parcel_id)) continue;
    if (!facts.has(l.parcel_id)) facts.set(l.parcel_id, new Map());
    facts.get(l.parcel_id)!.set(l.tax_year, {
      appraised: l.appraised_value,
      assessed: l.assessed_value,
      taxDue: l.tax_due,
      exemptions: l.exemptions,
    });
  }

  const perYear: TaxChangeReport["perYear"] = [];
  for (let year = Math.min(y0, y1); year <= Math.max(y0, y1); year++) {
    let totalTax = 0;
    let totalAppraised = 0;
    for (const byYear of facts.values()) {
      const f = byYear.get(year);
      if (!f) continue;
      totalTax += f.taxDue;
      totalAppraised += f.appraised ?? 0;
    }
    perYear.push({ year, totalTax: round2(totalTax), totalAppraised: round2(totalAppraised) });
  }

  const changes: ParcelChange[] = [];
  for (const [parcelId, byYear] of facts) {
    const p = parcelById.get(parcelId)!;
    const f0 = byYear.get(y0) ?? null;
    const f1 = byYear.get(y1) ?? null;
    if (!f0 && !f1) continue;

    const change: ParcelChange = {
      parcelId,
      parcelNumber: p.parcel_number,
      county: p.county,
      propertyId: p.property_id,
      y0: f0,
      y1: f1,
      deltaTax: null,
      deltaAppraised: null,
      pctAppraised: null,
      rate0: null,
      rate1: null,
      valuationEffect: null,
      rateEffect: null,
      sentence: null,
      ratio0: null,
      ratio1: null,
      flags: [],
    };

    const rateOf = (f: ParcelYearFacts | null) =>
      f && f.appraised != null && f.appraised > 0 ? f.taxDue / f.appraised : null;
    const ratioOf = (f: ParcelYearFacts | null) =>
      f && f.appraised != null && f.appraised > 0 && f.assessed != null
        ? f.assessed / f.appraised
        : null;
    change.rate0 = rateOf(f0);
    change.rate1 = rateOf(f1);
    change.ratio0 = ratioOf(f0);
    change.ratio1 = ratioOf(f1);

    // Presence flags: never silently drop a parcel that skips a year.
    if (f0 && !f1) {
      change.flags.push({
        kind: "disappeared",
        message: `On the ${y0} statements but not ${y1}. Check whether the ${y1} statement is uploaded, or whether the parcel was sold, combined, or renumbered.`,
      });
    }
    if (!f0 && f1) {
      change.flags.push({
        kind: "appeared",
        message: `New on the ${y1} statements (nothing matched in ${y0}). A split, purchase, or newly matched line.`,
      });
    }

    if (f0 && f1) {
      change.deltaTax = round2(f1.taxDue - f0.taxDue);
      if (f0.appraised != null && f1.appraised != null) {
        change.deltaAppraised = round2(f1.appraised - f0.appraised);
        change.pctAppraised =
          f0.appraised > 0 ? (f1.appraised - f0.appraised) / f0.appraised : null;
      }

      // Exact decomposition when both rates exist.
      if (
        change.rate0 != null &&
        change.rate1 != null &&
        f0.appraised != null &&
        f1.appraised != null
      ) {
        const valuation = round2(change.rate0 * (f1.appraised - f0.appraised));
        // Cent-exact: fold any rounding residue into the rate effect so
        // the parts always sum to the rounded delta.
        const rate = round2(change.deltaTax - valuation);
        change.valuationEffect = valuation;
        change.rateEffect = rate;
        change.sentence = decompositionSentence(change.deltaTax, valuation, rate);
      }

      // Assessment ratio shift: the highest-value flag. A move between
      // Alabama's 10% (Class III current use) and 20% (Class II) almost
      // always means a classification change.
      if (change.ratio0 != null && change.ratio1 != null) {
        const shift = change.ratio1 - change.ratio0;
        if (Math.abs(shift) >= 0.03) {
          const from = ratioLabel(change.ratio0);
          const to = ratioLabel(change.ratio1);
          const lostCurrentUse =
            Math.abs(change.ratio0 * 100 - 10) <= 1.5 &&
            Math.abs(change.ratio1 * 100 - 20) <= 1.5;
          const gainedCurrentUse =
            Math.abs(change.ratio0 * 100 - 20) <= 1.5 &&
            Math.abs(change.ratio1 * 100 - 10) <= 1.5;
          change.flags.push({
            kind: "ratio_shift",
            message: lostCurrentUse
              ? `Assessment ratio moved ${from} to ${to}: current use (Class III) was probably LOST and the parcel now assesses as Class II. Ask the revenue commissioner about its current-use status; reapplying usually fixes it going forward.`
              : gainedCurrentUse
                ? `Assessment ratio moved ${from} to ${to}: the parcel gained current use (Class III) assessment.`
                : `Assessment ratio moved ${from} to ${to}: a probable classification or exemption change. Worth confirming with the revenue commissioner.`,
          });
        }
      }

      // Exemption changes (the homestead analog of a ratio shift).
      const ex0 = exemptionTokens(f0.exemptions);
      const ex1 = exemptionTokens(f1.exemptions);
      const removed = ex0.filter((t) => !ex1.includes(t));
      const added = ex1.filter((t) => !ex0.includes(t));
      if (removed.length > 0) {
        change.flags.push({
          kind: "exemption_change",
          message: `Exemption ${removed.join(", ")} no longer appears on the ${y1} statement. If this is a homestead or age exemption, check it with the revenue commissioner before the bill is final.`,
        });
      }
      if (added.length > 0) {
        change.flags.push({
          kind: "exemption_change",
          message: `Exemption ${added.join(", ")} is new on the ${y1} statement.`,
        });
      }

      // Spike: appeal-review candidate.
      if (change.pctAppraised != null && change.pctAppraised > spikeThreshold) {
        change.flags.push({
          kind: "spike",
          message: `Appraised value up ${pctText(change.pctAppraised)} (${formatDollars(f0.appraised!)} to ${formatDollars(f1.appraised!)}), past the ${pctText(spikeThreshold)} review threshold: an appeal-review candidate.`,
        });
      }
    }

    changes.push(change);
  }

  const movers = changes
    .filter((c) => c.deltaTax != null)
    .sort((a, b) => Math.abs(b.deltaTax!) - Math.abs(a.deltaTax!));
  const flagged = changes.filter((c) => c.flags.length > 0);

  const sumYear = (year: number, pick: (f: ParcelYearFacts) => number) => {
    let total = 0;
    for (const byYear of facts.values()) {
      const f = byYear.get(year);
      if (f) total += pick(f);
    }
    return round2(total);
  };
  const tax0 = sumYear(y0, (f) => f.taxDue);
  const tax1 = sumYear(y1, (f) => f.taxDue);
  const appraised0 = sumYear(y0, (f) => f.appraised ?? 0);
  const appraised1 = sumYear(y1, (f) => f.appraised ?? 0);

  return {
    y0,
    y1,
    perYear,
    summary: {
      tax0,
      tax1,
      taxPct: tax0 > 0 ? (tax1 - tax0) / tax0 : null,
      appraised0,
      appraised1,
      appraisedPct: appraised0 > 0 ? (appraised1 - appraised0) / appraised0 : null,
      comparedParcels: movers.length,
      flaggedParcels: flagged.length,
    },
    movers,
    flagged,
  };
}
