// PROPERTY TAX REPORT (stage 2 of the tax work; research in
// docs/research/2026-11-09/research-property-tax.md). Pure: the page loads
// rows and renders what this returns. Order follows the research: bottom
// line, things worth a look (each with dollars and a deadline), current
// use and acreage, benchmarks, next year, deadlines.
//
// Data honesty: statement appraised values mix market and current use
// value across years (the extraction read whichever the bill printed
// first), so year-over-year change is measured on TAX (reliable) and
// values come from the county record (parcels.attributes).

import { landValuePerAcre, readCountyRecord, type CountyRecord } from "./countyRecord";

export type Severity = "high" | "medium" | "low";

export interface Finding {
  id: string;
  kind: string;
  severity: Severity;
  title: string;
  detail: string;
  action: string;
  dollars: number | null; // per year, an estimate
  dollarsLow?: number | null;
  dollarsHigh?: number | null;
  deadline?: string | null; // ISO date
  parcelId?: string | null;
  propertyId?: string | null;
}

export interface ReportParcel {
  id: string;
  parcel_number: string;
  county: string | null;
  property_id: string | null;
  acres: number | null; // GIS
  deeded_acres: number | null;
  attributes: Record<string, unknown> | null;
  current_use_status?: string | null;
  is_homestead?: boolean | null;
}

export interface ReportInput {
  year: number;
  today: Date;
  state: string; // 'AL'
  propertyScope: Set<string> | null; // null = everything
  county: string | null;
  lines: Array<{
    id: string;
    tax_statement_id: string;
    tax_year: number;
    tax_due: number;
    parcel_id: string | null;
    line_type?: string;
    appraised_value?: number | null;
    market_value?: number | null;
    current_use_value?: number | null;
  }>;
  statements: Array<{ id: string; tax_year: number; county: string | null; amount_due: number; delinquent_date: string | null; entity_id: string | null }>;
  payments: Array<{ tax_statement_id: string; amount: number; paid_date?: string | null }>;
  notices?: Array<{ county: string; tax_year: number; notice_date: string; parcel_id: string | null }>;
  parcels: ReportParcel[];
  properties: Array<{ id: string; name: string; entity_id: string | null }>;
  entityNames: Map<string, string[]>; // entity id -> name and aliases
  landUse: Map<string, { timber: number; crop: number; pasture: number; leased: boolean }>; // by property
  incomeByProperty: Map<string, Map<number, number>>; // property -> year -> income received
  cuValues: Array<{ state: string; tax_year: number; land_type: string; rating: string; value_per_acre: number }>;
  millage: Array<{ state: string; county: string; district: string; tax_year: number; total_mills: number; timber_per_acre: number; dwelling_fee: number | null; verified: boolean }>;
}

export interface ParcelRow {
  id: string;
  parcelNumber: string;
  county: string | null;
  propertyId: string | null;
  propertyName: string;
  record: CountyRecord | null;
  acres: number | null; // best: county calc, else deeded, else GIS
  gisAcres: number | null;
  deededAcres: number | null;
  timberAcres: number | null;
  landPerAcre: number | null;
  cuCeiling: number | null; // per acre, good soil, for this parcel's timber/crop mix
  cuStatus: "confirmed" | "county_yes" | "county_no" | "looks_cu" | "looks_market" | "unknown" | "confirmed_no";
  savings: { mid: number; low: number; high: number } | null; // if put on current use
  mills: number | null;
  millsVerified: boolean;
  billCheck: { expected: number; actual: number; diff: number } | null;
  tax: number; // selected year, from statements
  priorTax: number | null;
  nextTax: number | null; // from the county record for year + 1
  history: Array<{ year: number; value: number | null; kind: ValueKind; tax: number }>;
  latestMarket: { year: number; value: number } | null;
  cuSaves: number | null; // a year, when on current use and a market value is known
}

export interface PropertyRow {
  id: string;
  name: string;
  acres: number;
  tax: number;
  perAcre: number | null;
  income: number | null;
  pctIncome: number | null;
  trend: Array<{ year: number; tax: number }>;
}

export interface TaxReport {
  year: number;
  bottom: {
    tax: number;
    priorTax: number | null;
    change: number | null;
    changePct: number | null;
    reason: string;
    paid: number;
    outstanding: number;
    acres: number;
    perAcre: number | null;
    income: number;
    pctIncome: number | null;
    findings: number;
    atStake: number;
    nextDeadline: { date: string; label: string } | null;
  };
  findings: Finding[];
  parcels: ParcelRow[];
  properties: PropertyRow[];
  nextYear: { total: number; covered: number; parcelsInScope: number; thisYear: number } | null;
  deadlines: Array<{ date: string; label: string; detail: string }>;
  coverage: { lines: number; matched: number; withRecord: number; parcels: number };
  cuSavesTotal: number;
  paidByYear: Array<{ year: number; entity: string; property: string; amount: number }>;
  openNotices: Array<{ county: string; notice_date: string; deadline: string; parcelId: string | null }>;
  rates: { cuYear: number | null; millageNote: string };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// What kind of value a bill printed: the value the tax was figured on
// ("taxed"), or a market value printed beside a tax figured on a lower
// current use value ("market"). Lawrence notices through 2024 printed
// market value while taxing current use; from 2025 they print the taxed
// value. Value x 10% x district mills (+ $0.10 per timber acre)
// reproducing the tax means "taxed".
export type ValueKind = "taxed" | "market" | "unknown";

export function valueKind(value: number | null | undefined, tax: number, mills: number | null, timberAcres = 0): ValueKind {
  if (!value || value <= 0 || !mills || tax <= 0) return "unknown";
  const implied = ((tax - 0.1 * timberAcres) / (value * 0.1)) * 1000;
  if (implied >= mills * 0.85 && implied <= mills * 1.2) return "taxed";
  if (implied < mills * 0.6) return "market";
  return "unknown";
}

// ADOR current use value for a land type and rating, the latest table at
// or before the year.
export function cuValue(
  rows: ReportInput["cuValues"],
  state: string,
  year: number,
  landType: "crop_pasture" | "timber",
  rating: "good" | "average" | "poor" | "nonproductive"
): { value: number; year: number } | null {
  const cands = rows
    .filter((r) => r.state === state && r.land_type === landType && r.rating === rating && r.tax_year <= year)
    .sort((a, b) => b.tax_year - a.tax_year);
  const best = cands[0] ?? rows.filter((r) => r.state === state && r.land_type === landType && r.rating === rating).sort((a, b) => b.tax_year - a.tax_year)[0];
  return best ? { value: Number(best.value_per_acre), year: best.tax_year } : null;
}

// Per-acre ceiling or typical value for a parcel's timber/crop mix.
export function mixValue(
  rows: ReportInput["cuValues"],
  state: string,
  year: number,
  acres: number,
  timberAcres: number | null,
  rating: "good" | "average" | "poor"
): number | null {
  const t = cuValue(rows, state, year, "timber", rating);
  const c = cuValue(rows, state, year, "crop_pasture", rating);
  if (!t || !c || acres <= 0) return null;
  const share = Math.min(1, Math.max(0, (timberAcres ?? 0) / acres));
  return share * t.value + (1 - share) * c.value;
}

export function millsFor(
  rows: ReportInput["millage"],
  state: string,
  county: string | null,
  district: string | null,
  year: number
): ReportInput["millage"][number] | null {
  if (!county) return null;
  const inCounty = rows.filter((r) => r.state === state && r.county.toLowerCase() === county.toLowerCase() && r.tax_year <= year + 1);
  const pick = (d: string) => inCounty.filter((r) => r.district === d).sort((a, b) => b.tax_year - a.tax_year)[0];
  return (district ? pick(district) : undefined) ?? pick("*") ?? null;
}

// Expected tax from the county record: assessed x mills + timber acre tax,
// allowing for 0 to 4 building fees (dwellings are not counted on the record).
export function billCheck(
  r: CountyRecord,
  m: { total_mills: number; timber_per_acre: number; dwelling_fee: number | null }
): { expected: number; actual: number; diff: number } | null {
  if (r.assessed === null || r.taxDue === null) return null;
  const base = (r.assessed * Number(m.total_mills)) / 1000 + Number(m.timber_per_acre) * (r.timberAcres ?? 0);
  let best = base;
  if (m.dwelling_fee) {
    for (let k = 1; k <= 4; k++) {
      const cand = base + k * Number(m.dwelling_fee);
      if (Math.abs(r.taxDue - cand) < Math.abs(r.taxDue - best)) best = cand;
    }
  }
  return { expected: r2(best), actual: r2(r.taxDue), diff: r2(r.taxDue - best) };
}

function normName(s: string): string[] {
  return s
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !["LLC", "INC", "CORP", "CORPORATION", "CO", "THE", "OF", "AND", "ETAL", "ET", "AL", "TRUST", "TRUSTS", "TR", "TRS"].includes(w));
}

export function ownerMatches(owner: string, names: string[]): boolean {
  const o = new Set(normName(owner));
  return names.some((n) => {
    const words = normName(n);
    return words.length > 0 && words.every((w) => o.has(w));
  });
}

export function buildTaxReport(inp: ReportInput): TaxReport {
  const { year, state } = inp;
  const propName = new Map(inp.properties.map((p) => [p.id, p.name]));
  const propEntity = new Map(inp.properties.map((p) => [p.id, p.entity_id]));
  const inScopeProp = (pid: string | null) => !inp.propertyScope || (pid !== null && inp.propertyScope.has(pid));
  const scopedParcels = inp.parcels.filter((p) => inScopeProp(p.property_id) && (!inp.county || p.county === inp.county));
  // The same county parcel entered twice is reported once (and flagged).
  const seenKey = new Map<string, ReportParcel>();
  const duplicates: Array<{ keep: ReportParcel; dup: ReportParcel }> = [];
  const parcels: ReportParcel[] = [];
  for (const p of scopedParcels) {
    const key = `${(p.county ?? "").toLowerCase()}|${p.parcel_number.replace(/[^0-9A-Za-z]/g, "")}`;
    const prev = seenKey.get(key);
    if (prev) duplicates.push({ keep: prev, dup: p });
    else {
      seenKey.set(key, p);
      parcels.push(p);
    }
  }
  const parcelIds = new Set(parcels.map((p) => p.id));
  const stmtById = new Map(inp.statements.map((s) => [s.id, s]));

  // Statement lines in scope: matched to an in-scope parcel, or (when no
  // property filter) unmatched lines of in-scope counties.
  const lineInScope = (l: ReportInput["lines"][number]) => {
    if (l.parcel_id) return parcelIds.has(l.parcel_id);
    if (inp.propertyScope) return false;
    const s = stmtById.get(l.tax_statement_id);
    return !inp.county || s?.county === inp.county;
  };
  const scopedLines = inp.lines.filter(lineInScope);
  const taxIn = (y: number, parcelId?: string) =>
    r2(scopedLines.filter((l) => l.tax_year === y && (!parcelId || l.parcel_id === parcelId)).reduce((s, l) => s + Number(l.tax_due), 0));
  const hasYear = (y: number) => scopedLines.some((l) => l.tax_year === y);

  // Paid and outstanding for the year: statement payments spread to lines
  // by tax share, then summed over in-scope lines.
  const paidByStmt = new Map<string, number>();
  for (const p of inp.payments) paidByStmt.set(p.tax_statement_id, (paidByStmt.get(p.tax_statement_id) ?? 0) + Number(p.amount));
  const stmtLineTotal = new Map<string, number>();
  for (const l of inp.lines) stmtLineTotal.set(l.tax_statement_id, (stmtLineTotal.get(l.tax_statement_id) ?? 0) + Number(l.tax_due));
  let paid = 0;
  for (const l of scopedLines.filter((x) => x.tax_year === year)) {
    const tot = stmtLineTotal.get(l.tax_statement_id) ?? 0;
    const p = paidByStmt.get(l.tax_statement_id) ?? 0;
    paid += tot > 0 ? Math.min(Number(l.tax_due), (p * Number(l.tax_due)) / tot) : 0;
  }
  paid = r2(paid);
  const tax = taxIn(year);
  const priorTax = hasYear(year - 1) ? taxIn(year - 1) : null;

  // ---------------------------------------------------------------- parcels
  let cuYear: number | null = null;
  const rows: ParcelRow[] = parcels.map((p) => {
    const rec = readCountyRecord(p.attributes);
    const acres = rec?.calcAcres ?? p.deeded_acres ?? rec?.deededAcres ?? p.acres ?? null;
    const lpa = rec && acres ? landValuePerAcre(rec, acres) : null;
    const ceil = acres ? mixValue(inp.cuValues, state, year, acres, rec?.timberAcres ?? null, "good") : null;
    const cuT = cuValue(inp.cuValues, state, year, "timber", "good");
    if (cuT) cuYear = cuT.year;
    let status: ParcelRow["cuStatus"] = "unknown";
    if (p.current_use_status === "enrolled") status = "confirmed";
    else if (p.current_use_status === "not_enrolled") status = "confirmed_no";
    else if (rec?.hasCurrentUse === true) status = "county_yes";
    else if (rec?.hasCurrentUse === false) status = "county_no";
    else if (lpa !== null && ceil !== null) status = lpa <= ceil * 1.05 ? "looks_cu" : lpa > ceil * 1.25 ? "looks_market" : "unknown";
    const m = rec ? millsFor(inp.millage, state, p.county, rec.taxDistrict, year) : null;
    let savings: ParcelRow["savings"] = null;
    if ((status === "looks_market" || status === "county_no" || status === "confirmed_no") && lpa !== null && acres && m) {
      const at = (rating: "good" | "average" | "poor") => {
        const v = mixValue(inp.cuValues, state, year, acres, rec?.timberAcres ?? null, rating);
        return v === null ? 0 : Math.max(0, ((lpa - v) * acres * 0.1 * Number(m.total_mills)) / 1000);
      };
      savings = { mid: Math.round(at("average")), low: Math.round(at("good")), high: Math.round(at("poor")) };
    }
    const nextTax = rec && rec.year === year + 1 ? rec.taxDue : null;
    // Value history from the bills: each printed value classified.
    const history = Array.from(new Set(scopedLines.filter((l) => l.parcel_id === p.id).map((l) => l.tax_year)))
      .sort((a, b) => a - b)
      .map((y) => {
        const ls = scopedLines.filter((l) => l.parcel_id === p.id && l.tax_year === y);
        const t = r2(ls.reduce((s2, l) => s2 + Number(l.tax_due), 0));
        const l0 = ls[0];
        if (l0?.market_value) return { year: y, value: Number(l0.market_value), kind: "market" as ValueKind, tax: t };
        const v = l0?.appraised_value != null ? Number(l0.appraised_value) : null;
        return { year: y, value: v, kind: valueKind(v, t, m ? Number(m.total_mills) : null, rec?.timberAcres ?? 0), tax: t };
      });
    const mk = [...history].reverse().find((h) => h.kind === "market" && h.value);
    const latestMarket = mk && mk.value ? { year: mk.year, value: mk.value } : null;
    const onCU = status === "confirmed" || status === "county_yes" || status === "looks_cu";
    const cuSaves =
      onCU && latestMarket && rec?.taxableValue && m && latestMarket.value > rec.taxableValue
        ? Math.round(((latestMarket.value - rec.taxableValue) * 0.1 * Number(m.total_mills)) / 1000)
        : null;
    return {
      id: p.id,
      parcelNumber: p.parcel_number,
      county: p.county,
      propertyId: p.property_id,
      propertyName: p.property_id ? (propName.get(p.property_id) ?? "") : "",
      record: rec,
      acres,
      gisAcres: p.acres,
      deededAcres: p.deeded_acres ?? rec?.deededAcres ?? null,
      timberAcres: rec?.timberAcres ?? null,
      landPerAcre: lpa !== null ? Math.round(lpa) : null,
      cuCeiling: ceil !== null ? Math.round(ceil) : null,
      cuStatus: status,
      savings,
      mills: m ? Number(m.total_mills) : null,
      millsVerified: !!m?.verified,
      billCheck: rec && m ? billCheck(rec, m) : null,
      tax: taxIn(year, p.id),
      priorTax: hasYear(year - 1) ? taxIn(year - 1, p.id) : null,
      nextTax,
      history,
      latestMarket,
      cuSaves,
    };
  });

  // ---------------------------------------------------------------- findings
  const findings: Finding[] = [];
  const today = iso(inp.today);
  // The current use window (Oct 1 to Jan 1) always closes next Jan 1.
  const cuDeadline = `${inp.today.getFullYear() + 1}-01-01`;

  for (const r of rows) {
    const use = r.propertyId ? inp.landUse.get(r.propertyId) : undefined;
    const evidence = (use && (use.timber > 0 || use.crop > 0 || use.pasture > 0 || use.leased)) || (r.timberAcres ?? 0) > 0;
    if ((r.cuStatus === "looks_market" || r.cuStatus === "county_no") && r.acres && r.acres >= 5) {
      findings.push({
        id: `cu:${r.id}`,
        kind: "current_use",
        severity: evidence ? "high" : "medium",
        title: r.cuStatus === "county_no" ? `Not on current use: ${r.propertyName || r.parcelNumber}` : `Looks like it is not on current use: ${r.propertyName || r.parcelNumber}`,
        detail: `Parcel ${r.parcelNumber}: taxable land value is about $${(r.landPerAcre ?? 0).toLocaleString("en-US")} an acre on ${r.acres.toFixed(1)} acres; current use land cannot be valued above about $${(r.cuCeiling ?? 0).toLocaleString("en-US")} an acre.${evidence ? " Your records show farm or timber use on this property." : ""}`,
        action: "Ask the revenue commissioner whether it is enrolled. If it qualifies, apply for current use between Oct 1 and Jan 1 (form cuapp).",
        dollars: r.savings?.mid ?? null,
        dollarsLow: r.savings?.low ?? null,
        dollarsHigh: r.savings?.high ?? null,
        deadline: cuDeadline,
        parcelId: r.id,
        propertyId: r.propertyId,
      });
    }
    if (r.billCheck && Math.abs(r.billCheck.diff) > 5 && Math.abs(r.billCheck.diff) > 0.02 * r.billCheck.actual) {
      findings.push({
        id: `bill:${r.id}`,
        kind: "bill_check",
        severity: "medium",
        title: `County figure does not tie out: ${r.parcelNumber}`,
        detail: `The county shows $${r.billCheck.actual.toFixed(2)}; assessed value x ${r.mills} mills plus the timber acre tax gives $${r.billCheck.expected.toFixed(2)} (difference $${r.billCheck.diff.toFixed(2)}). Possible causes: a different tax district, an exemption, a fee, or a rate that changed.`,
        action: "Compare the bill's tax district and exemptions with the county record.",
        dollars: Math.abs(r.billCheck.diff),
        parcelId: r.id,
        propertyId: r.propertyId,
      });
    }
    const acreVals = [r.deededAcres, r.record?.calcAcres ?? null, r.gisAcres].filter((v): v is number => v !== null && v > 0);
    if (acreVals.length >= 2) {
      const hi = Math.max(...acreVals);
      const lo = Math.min(...acreVals);
      if (hi / lo > 1.1 && hi - lo > 2) {
        const countyOver = r.record?.calcAcres && r.deededAcres && r.record.calcAcres > r.deededAcres + 2;
        findings.push({
          id: `acres:${r.id}`,
          kind: "acreage",
          severity: countyOver ? "medium" : "low",
          title: `Acreage does not agree: ${r.parcelNumber}`,
          detail: `Deed ${r.deededAcres?.toFixed(1) ?? "?"} ac, county ${r.record?.calcAcres?.toFixed(1) ?? "?"} ac, map ${r.gisAcres?.toFixed(1) ?? "?"} ac.`,
          action: countyOver
            ? "The county may be taxing more acres than the deed. Ask the assessor to check the parcel against the deed."
            : "Check the map boundary against the deed or survey.",
          dollars:
            countyOver && r.landPerAcre && r.mills
              ? Math.round(((r.record!.calcAcres! - r.deededAcres!) * r.landPerAcre * 0.1 * r.mills) / 1000)
              : null,
          parcelId: r.id,
          propertyId: r.propertyId,
        });
      }
    }
    if (r.record?.owner && r.propertyId) {
      const eid = propEntity.get(r.propertyId);
      const names = eid ? (inp.entityNames.get(eid) ?? []) : [];
      if (names.length && !ownerMatches(r.record.owner, names)) {
        findings.push({
          id: `owner:${r.id}`,
          kind: "owner",
          severity: "medium",
          title: `County owner name differs: ${r.parcelNumber}`,
          detail: `The county lists "${r.record.owner}"${r.record.mailing ? `, mailing to ${r.record.mailing}` : ""}; the app has ${names[0]}. Bills follow the county's name and address.`,
          action: "If the land changed hands or entities, make sure the county has the right owner and mailing address (and that current use carried over).",
          dollars: r.tax || null,
          parcelId: r.id,
          propertyId: r.propertyId,
        });
      }
    }
    if (r.priorTax !== null && r.priorTax > 0 && r.tax > r.priorTax * 1.15 && r.tax - r.priorTax > 50) {
      findings.push({
        id: `jump:${r.id}`,
        kind: "tax_jump",
        severity: "medium",
        title: `Tax up ${Math.round(((r.tax - r.priorTax) / r.priorTax) * 100)}%: ${r.propertyName || r.parcelNumber}`,
        detail: `Parcel ${r.parcelNumber}: $${r.priorTax.toFixed(2)} in ${year - 1}, $${r.tax.toFixed(2)} in ${year}.`,
        action: "Look at the valuation notice. A value increase can be protested to the Board of Equalization within 30 days of the notice.",
        dollars: r2(r.tax - r.priorTax),
        parcelId: r.id,
        propertyId: r.propertyId,
      });
    }
    if (hasYear(year) && r.priorTax !== null && r.priorTax > 0 && r.tax === 0 && rows.some((x) => x.county === r.county && x.tax > 0)) {
      findings.push({
        id: `missing:${r.id}`,
        kind: "missing_bill",
        severity: inp.today.getMonth() >= 10 ? "high" : "medium",
        title: `No ${year} bill on file: ${r.propertyName || r.parcelNumber}`,
        detail: `Parcel ${r.parcelNumber} was billed $${r.priorTax.toFixed(2)} for ${year - 1}, but no ${year} statement line is matched to it.`,
        action: "Upload the bill, or match its line on the Taxes page. Alabama taxes are owed whether or not a bill arrives.",
        dollars: r.priorTax,
        deadline: `${year}-12-31`,
        parcelId: r.id,
        propertyId: r.propertyId,
      });
    }
  }

  for (const { keep, dup } of duplicates) {
    findings.push({
      id: `dup:${dup.id}`,
      kind: "duplicate_parcel",
      severity: "low",
      title: `Parcel entered twice: ${keep.parcel_number}`,
      detail: `${keep.county ?? ""} parcel ${keep.parcel_number} is in Turnrow twice${keep.property_id !== dup.property_id ? " under different properties" : ""}. It is counted once here.`,
      action: "Delete the extra parcel on the property page (keep the one with the right boundary).",
      dollars: null,
      parcelId: dup.id,
      propertyId: dup.property_id,
    });
  }

  // A statement line far from the county's own figure for the next year
  // usually means the line was matched to the wrong parcel (or carries a
  // combined total).
  for (const r of rows) {
    if (r.nextTax === null || r.nextTax <= 0 || r.tax <= 0) continue;
    const ratio = r.tax / r.nextTax;
    if ((ratio > 2 || ratio < 0.5) && Math.abs(r.tax - r.nextTax) > 100) {
      findings.push({
        id: `mismatch:${r.id}`,
        kind: "line_mismatch",
        severity: "medium",
        title: `Bill line does not look like this parcel: ${r.parcelNumber}`,
        detail: `The ${year} statement line matched to ${r.propertyName || "it"} is $${r.tax.toFixed(2)}, but the county figures $${r.nextTax.toFixed(2)} for ${year + 1}. Either the line belongs to another parcel (or carries a combined total), or the value basis changed between the years, for example current use granted or lost.`,
        action: "Check the statement on the Taxes page. If the line is right, the change is real: confirm the parcel's current use status with the county.",
        dollars: null,
        parcelId: r.id,
        propertyId: r.propertyId,
      });
    }
  }

  // Property-level: timber acres the county does not count.
  const byProp = new Map<string, ParcelRow[]>();
  for (const r of rows) if (r.propertyId) byProp.set(r.propertyId, [...(byProp.get(r.propertyId) ?? []), r]);
  for (const [pid, prs] of byProp) {
    const use = inp.landUse.get(pid);
    const countyTimber = prs.reduce((s, r) => s + (r.timberAcres ?? 0), 0);
    const haveField = prs.some((r) => r.record && r.record.timberAcres !== null);
    if (!use || !haveField) continue;
    const gap = use.timber - countyTimber;
    if (gap > Math.max(5, 0.2 * use.timber)) {
      findings.push({
        id: `timber:${pid}`,
        kind: "timber_acres",
        severity: "low",
        title: `More timber than the county counts: ${propName.get(pid)}`,
        detail: `Your stands cover ${use.timber.toFixed(1)} acres; the county records ${countyTimber.toFixed(1)} timber acres. Current use values timber and cropland differently, so the split matters (it can go either way).`,
        action: "Ask the assessor how the acres are split between timber and crop or pasture; bring the stand map.",
        dollars: null,
        propertyId: pid,
      });
    }
  }

  // Statements: unpaid near or past delinquency.
  for (const s of inp.statements.filter((x) => x.tax_year === year && (!inp.county || x.county === inp.county))) {
    const lines = inp.lines.filter((l) => l.tax_statement_id === s.id);
    if (inp.propertyScope && !lines.some((l) => l.parcel_id && parcelIds.has(l.parcel_id))) continue;
    const bal = r2(Number(s.amount_due) - (paidByStmt.get(s.id) ?? 0));
    if (bal <= 0.01) continue;
    const delinquent = s.delinquent_date ?? `${s.tax_year}-12-31`;
    const daysLeft = (new Date(delinquent + "T00:00:00").getTime() - inp.today.getTime()) / 864e5;
    if (daysLeft > 60) continue;
    findings.push({
      id: `unpaid:${s.id}`,
      kind: "unpaid",
      severity: "high",
      title: daysLeft < 0 ? `Delinquent: ${s.county ?? ""} ${s.tax_year} bill` : `Unpaid: ${s.county ?? ""} ${s.tax_year} bill`,
      detail: `$${bal.toFixed(2)} still open${daysLeft < 0 ? `; it went delinquent ${delinquent}` : `; delinquent after ${delinquent}`}. Late taxes add interest and fees, and go to a tax sale in May.`,
      action: "Pay it, or record the payment on the Taxes page if it was paid.",
      dollars: bal,
      deadline: delinquent,
    });
  }

  // Unmatched lines and tax versus income.
  const unmatched = scopedLines.filter((l) => l.tax_year === year && !l.parcel_id && l.line_type !== "personal_property");
  if (unmatched.length > 0) {
    findings.push({
      id: "unmatched",
      kind: "unmatched",
      severity: "low",
      title: `${unmatched.length} bill line${unmatched.length === 1 ? "" : "s"} not tied to a parcel`,
      detail: `$${r2(unmatched.reduce((s, l) => s + Number(l.tax_due), 0)).toFixed(2)} of ${year} tax is in totals but not in any per-acre or per-property figure.`,
      action: "Match the lines on the Taxes page.",
      dollars: null,
    });
  }

  const props: PropertyRow[] = [];
  const years = Array.from(new Set(scopedLines.map((l) => l.tax_year))).sort((a, b) => a - b).slice(-6);
  for (const [pid, prs] of byProp) {
    const acres = prs.reduce((s, r) => s + (r.acres ?? 0), 0);
    const t = r2(prs.reduce((s, r) => s + r.tax, 0));
    const income = inp.incomeByProperty.get(pid)?.get(year) ?? null;
    const row: PropertyRow = {
      id: pid,
      name: propName.get(pid) ?? "",
      acres: r2(acres),
      tax: t,
      perAcre: acres > 0 ? r2(t / acres) : null,
      income,
      pctIncome: income && income > 0 ? t / income : null,
      trend: years.map((y) => ({ year: y, tax: r2(prs.reduce((s, r) => s + taxIn(y, r.id), 0)) })),
    };
    props.push(row);
    if (row.pctIncome !== null && row.pctIncome > 0.1 && t > 100) {
      findings.push({
        id: `income:${pid}`,
        kind: "tax_vs_income",
        severity: "low",
        title: `Tax is ${Math.round(row.pctIncome * 100)}% of income: ${row.name}`,
        detail: `$${t.toFixed(2)} of tax against $${(income ?? 0).toFixed(2)} of ${year} income. On current use farm and timber land, tax is usually a few percent of rent.`,
        action: "Check that the land is on current use, and whether the rent is in line.",
        dollars: null,
        propertyId: pid,
      });
    }
  }
  props.sort((a, b) => b.tax - a.tax);

  const sevRank: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  findings.sort((a, b) => {
    const soonA = a.deadline && (new Date(a.deadline).getTime() - inp.today.getTime()) / 864e5 < 60 ? 0 : 1;
    const soonB = b.deadline && (new Date(b.deadline).getTime() - inp.today.getTime()) / 864e5 < 60 ? 0 : 1;
    return sevRank[a.severity] - sevRank[b.severity] || soonA - soonB || (b.dollars ?? 0) - (a.dollars ?? 0);
  });

  // ---------------------------------------------------------------- next year
  const withNext = rows.filter((r) => r.nextTax !== null);
  const nextYear = withNext.length
    ? {
        total: r2(withNext.reduce((s, r) => s + (r.nextTax ?? 0), 0)),
        covered: withNext.length,
        parcelsInScope: rows.length,
        thisYear: r2(withNext.reduce((s, r) => s + r.tax, 0)),
      }
    : null;

  // ---------------------------------------------------------------- deadlines
  const y = inp.today.getFullYear();
  const deadlines = [
    { date: `${y}-12-31`, label: "Property taxes delinquent after Dec 31", detail: "Taxes are due Oct 1. Unpaid bills go to probate in February and a tax sale in May." },
    { date: inp.today.getMonth() >= 9 ? `${y + 1}-01-01` : `${y}-10-01`, label: inp.today.getMonth() >= 9 ? "Current use applications close Jan 1" : "Current use applications open Oct 1", detail: "Apply with the county (form cuapp). Once granted it carries forward, but a new owner must apply again." },
    { date: `${y + 1}-04-01`, label: "Valuation notices (spring and summer)", detail: "A protest to the Board of Equalization is due within 30 days of the notice. Enter the date when a notice arrives." },
    { date: "2027-10-01", label: "The 7% cap runs through the tax year beginning Oct 1, 2027", detail: "Unless extended, taxable values may reset to full assessed value after that." },
  ]
    .filter((d) => d.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));

  // Valuation notices: a protest is due within 30 days.
  const openNotices = (inp.notices ?? [])
    .filter((n) => (!inp.county || n.county === inp.county) && (!n.parcel_id || parcelIds.has(n.parcel_id)))
    .map((n) => {
      const d = new Date(n.notice_date + "T00:00:00");
      d.setDate(d.getDate() + 30);
      return { county: n.county, notice_date: n.notice_date, deadline: iso(d), parcelId: n.parcel_id };
    })
    .filter((n) => n.deadline >= today);
  for (const n of openNotices) {
    const jumps = findings.filter((f) => (f.kind === "tax_jump" || f.kind === "current_use") && (!n.parcelId || f.parcelId === n.parcelId));
    findings.unshift({
      id: `notice:${n.county}:${n.notice_date}:${n.parcelId ?? "all"}`,
      kind: "protest_window",
      severity: jumps.length ? "high" : "medium",
      title: `Protest window open: ${n.county} County valuation notice`,
      detail: `The notice dated ${n.notice_date} can be protested to the ${n.county} County Board of Equalization until ${n.deadline}.${jumps.length ? ` ${jumps.length} finding${jumps.length === 1 ? "" : "s"} above may be worth raising.` : ""}`,
      action: "If a value looks too high, file a written protest with the Board of Equalization before the deadline (the parcel's appeal packet has the evidence). Class and current use questions go to the revenue commissioner.",
      dollars: null,
      deadline: n.deadline,
      parcelId: n.parcelId,
    });
    deadlines.push({ date: n.deadline, label: `Protest deadline, ${n.county} County notice of ${n.notice_date}`, detail: "30 days from the valuation notice." });
  }
  deadlines.sort((a, b) => a.date.localeCompare(b.date));

  // Tax PAID by calendar year (the year a cash-basis taxpayer deducts
  // it), by entity and property, for the accountant.
  const parcelProp = new Map(inp.parcels.map((p) => [p.id, p.property_id]));
  const entName = new Map(Array.from(inp.entityNames.entries()).map(([k, v]) => [k, v[0]]));
  const paidAgg = new Map<string, { year: number; entity: string; property: string; amount: number }>();
  for (const pay of inp.payments) {
    if (!pay.paid_date) continue;
    const st = stmtById.get(pay.tax_statement_id);
    if (!st || (inp.county && st.county !== inp.county)) continue;
    const sl = inp.lines.filter((l) => l.tax_statement_id === pay.tax_statement_id);
    const tot = sl.reduce((s2, l) => s2 + Number(l.tax_due), 0);
    const parts = sl.length && tot > 0 ? sl.map((l) => ({ l, share: Number(l.tax_due) / tot })) : [{ l: null, share: 1 }];
    for (const { l, share } of parts) {
      const pid = l?.parcel_id ? (parcelProp.get(l.parcel_id) ?? null) : null;
      if (inp.propertyScope && (!pid || !inp.propertyScope.has(pid))) continue;
      const eid = (pid ? propEntity.get(pid) : null) ?? st.entity_id;
      const entity = eid ? (entName.get(eid) ?? "Entity") : "No entity";
      const property = pid ? (propName.get(pid) ?? "") : "Not tied to a parcel";
      const y = Number(pay.paid_date.slice(0, 4));
      const key = `${y}|${entity}|${property}`;
      const cur = paidAgg.get(key) ?? { year: y, entity, property, amount: 0 };
      cur.amount += Number(pay.amount) * share;
      paidAgg.set(key, cur);
    }
  }
  const paidByYear = Array.from(paidAgg.values())
    .map((x) => ({ ...x, amount: r2(x.amount) }))
    .sort((a, b) => b.year - a.year || a.entity.localeCompare(b.entity) || a.property.localeCompare(b.property));

  const acres = r2(rows.reduce((s, r) => s + (r.acres ?? 0), 0));
  const income = r2(props.reduce((s, p) => s + (p.income ?? 0), 0));
  const change = priorTax !== null ? r2(tax - priorTax) : null;
  const movers = rows
    .filter((r) => r.priorTax !== null)
    .map((r) => ({ r, d: r.tax - (r.priorTax ?? 0) }))
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  const top = movers.slice(0, 2).filter((m) => Math.abs(m.d) >= 1);
  const reason =
    change === null
      ? `No ${year - 1} bills on file to compare.`
      : Math.abs(change) < 1
        ? `About the same as ${year - 1}.`
        : `${change > 0 ? "Up" : "Down"} $${Math.abs(change).toLocaleString("en-US", { maximumFractionDigits: 0 })} from ${year - 1}${top.length ? `, mostly ${top.map((m) => `${m.r.propertyName || m.r.parcelNumber} (${m.d > 0 ? "+" : "-"}$${Math.abs(Math.round(m.d)).toLocaleString("en-US")})`).join(" and ")}` : ""}.`;

  return {
    year,
    bottom: {
      tax,
      priorTax,
      change,
      changePct: change !== null && priorTax ? change / priorTax : null,
      reason,
      paid,
      outstanding: r2(Math.max(0, tax - paid)),
      acres,
      perAcre: acres > 0 ? r2(tax / acres) : null,
      income,
      pctIncome: income > 0 ? tax / income : null,
      findings: findings.filter((f) => f.severity !== "low").length,
      atStake: Math.round(findings.reduce((s, f) => s + (f.kind === "current_use" || f.kind === "acreage" ? (f.dollars ?? 0) : 0), 0)),
      nextDeadline: deadlines[0] ? { date: deadlines[0].date, label: deadlines[0].label } : null,
    },
    findings,
    parcels: rows.sort((a, b) => (b.savings?.mid ?? 0) - (a.savings?.mid ?? 0) || b.tax - a.tax),
    properties: props,
    nextYear,
    deadlines,
    cuSavesTotal: rows.reduce((s2, r) => s2 + (r.cuSaves ?? 0), 0),
    paidByYear,
    openNotices,
    coverage: {
      lines: scopedLines.filter((l) => l.tax_year === year).length,
      matched: scopedLines.filter((l) => l.tax_year === year && l.parcel_id).length,
      withRecord: rows.filter((r) => r.record).length,
      parcels: rows.length,
    },
    rates: {
      cuYear,
      millageNote: "Rural Lawrence and Colbert 30 mills and Lawrence town districts 37 mills, verified against the county records; Morgan 37.4 mills from the state's table, not yet checked against a bill.",
    },
  };
}

export const CU_STATUS_LABELS: Record<ParcelRow["cuStatus"], string> = {
  confirmed: "On current use (you confirmed)",
  confirmed_no: "Not on current use (you confirmed)",
  county_yes: "On current use (county record)",
  county_no: "Not on current use (county record)",
  looks_cu: "Looks like current use",
  looks_market: "Looks like market value",
  unknown: "Can't tell",
};
