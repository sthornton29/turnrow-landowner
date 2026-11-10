// ANNUAL TIMBER TAX SUMMARY: one taxpayer (entity), one tax year, built
// from the timber records (migrations 0045-0047) for the accountant.
// Pure; the page loads rows and renders this. Nothing here is advice:
// it organizes the numbers and flags what is missing.

import type { AllocationMethod, SettlementAllocation } from "./timberAllocation";
import { propertyShareOfSale } from "./timberBasis";
import { deductionForYear, reforestationByYear } from "./reforestation";

export const NO_ENTITY_KEY = "none";

export interface SummaryInput {
  year: number;
  entityKey: string; // entity id, or NO_ENTITY_KEY
  properties: Array<{ id: string; name: string; entity_id: string | null }>;
  entities: Array<{ id: string; name: string; entity_type?: string | null }>;
  stands: Array<{ id: string; property_id: string; acres: number | null }>;
  saleStands: Array<{ timber_sale_id: string; timber_stand_id: string; allocation_pct: number | null }>;
  sales: Array<{ id: string; sale_name: string; sale_type: string; allocation_method: string | null; contract_date: string | null }>;
  settlements: Array<{ timber_sale_id: string; settlement_date: string; total_amount: number; allocation: unknown }>;
  payments: Array<{ timber_sale_id: string | null; amount: number; received_date: string }>;
  costs: Array<{
    id: string;
    property_id: string;
    paid_date: string;
    amount: number;
    tax_category: string;
    timber_sale_id: string | null;
    cost_share_award_id: string | null;
    vendor: string | null;
    description: string | null;
  }>;
  accounts: Array<{ id: string; property_id: string; acquisition_type: string; acquired_date: string | null }>;
  entries: Array<{ account_id: string; entry_date: string; entry_type: string; basis_change: number; timber_sale_id: string | null }>;
  awards: Array<{ id: string; property_id: string; entity_id: string | null; program: string; title: string }>;
  costSharePayments: Array<{ award_id: string; received_date: string; amount: number; sec126_choice: string }>;
}

export interface SaleLine {
  saleId: string;
  saleName: string;
  saleType: string;
  propertyName: string;
  proceeds: number;
  sellingExpenses: number;
  depletion: number;
  gain: number;
  holding: "long" | "short" | "unknown";
  formHint: string;
  basisSetUp: boolean;
}

export interface ReforestationLine {
  propertyName: string;
  paidThisYear: number;
  costShareExcluded: number;
  expensed: number;
  amortization: number;
  deduction: number;
}

export interface ExpenseLine {
  propertyName: string;
  paid_date: string;
  amount: number;
  tax_category: string;
  what: string;
}

export interface TimberTaxSummary {
  sales: SaleLine[];
  reforestation: ReforestationLine[];
  costShare: Array<{ title: string; program: string; amount: number; choice: string; received_date: string }>;
  expenses: ExpenseLine[];
  totals: {
    proceeds: number;
    sellingExpenses: number;
    depletion: number;
    gain: number;
    reforestationDeduction: number;
    costShareReceived: number;
    costShareExcluded: number;
    operating: number;
    improvements: number;
    notSure: number;
  };
  formT: boolean;
  checklist: string[];
  isTrust: boolean;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const inYear = (d: string | null | undefined, y: number) => !!d && d.slice(0, 4) === String(y);

export function buildTimberTaxSummary(inp: SummaryInput): TimberTaxSummary {
  const { year } = inp;
  const matchesEntity = (entityId: string | null) =>
    inp.entityKey === NO_ENTITY_KEY ? !entityId : entityId === inp.entityKey;
  const props = inp.properties.filter((p) => matchesEntity(p.entity_id));
  const propIds = new Set(props.map((p) => p.id));
  const propName = new Map(inp.properties.map((p) => [p.id, p.name]));
  const entity = inp.entities.find((e) => e.id === inp.entityKey);
  const isTrust = entity?.entity_type === "trust";
  const standProp = new Map(inp.stands.map((s) => [s.id, s.property_id]));
  const standAcres = new Map(inp.stands.map((s) => [s.id, s.acres]));
  const accountsByProp = new Map<string, string[]>();
  for (const a of inp.accounts) accountsByProp.set(a.property_id, [...(accountsByProp.get(a.property_id) ?? []), a.id]);
  const checklist: string[] = [];

  // ---------------------------------------------------------------- sales
  const sales: SaleLine[] = [];
  for (const sale of inp.sales) {
    const links = inp.saleStands.filter((l) => l.timber_sale_id === sale.id);
    const saleStands = links.map((l) => ({
      id: l.timber_stand_id,
      acres: standAcres.get(l.timber_stand_id) ?? null,
      allocation_pct: l.allocation_pct,
      property_id: standProp.get(l.timber_stand_id) ?? "",
    }));
    const method = (sale.allocation_method ?? "by_acres") as AllocationMethod;
    const touched = Array.from(new Set(saleStands.map((s) => s.property_id))).filter((p) => propIds.has(p));
    for (const pid of touched) {
      let proceeds = 0;
      let firstDate: string | null = null;
      if (sale.sale_type === "pay_as_cut") {
        for (const s of inp.settlements.filter((x) => x.timber_sale_id === sale.id)) {
          if (!firstDate || s.settlement_date < firstDate) firstDate = s.settlement_date;
          if (!inYear(s.settlement_date, year)) continue;
          proceeds +=
            (Number(s.total_amount) || 0) *
            propertyShareOfSale(method, saleStands, pid, s.allocation as SettlementAllocation | null);
        }
      } else {
        const share = propertyShareOfSale(method, saleStands, pid);
        for (const p of inp.payments.filter((x) => x.timber_sale_id === sale.id)) {
          if (!firstDate || p.received_date < firstDate) firstDate = p.received_date;
          if (!inYear(p.received_date, year)) continue;
          proceeds += (Number(p.amount) || 0) * share;
        }
      }
      const acctIds = new Set(accountsByProp.get(pid) ?? []);
      const depletion = -inp.entries
        .filter((e) => acctIds.has(e.account_id) && e.timber_sale_id === sale.id && e.entry_type === "depletion" && inYear(e.entry_date, year))
        .reduce((s, e) => s + Number(e.basis_change), 0);
      const sellingExpenses = inp.costs
        .filter((c) => c.property_id === pid && c.timber_sale_id === sale.id && c.tax_category === "selling_expense" && inYear(c.paid_date, year))
        .reduce((s, c) => s + Number(c.amount), 0);
      if (proceeds === 0 && depletion === 0 && sellingExpenses === 0) continue;
      const acct = inp.accounts.find((a) => a.property_id === pid);
      let holding: SaleLine["holding"] = "unknown";
      if (acct?.acquisition_type === "inheritance") holding = "long";
      else if (acct?.acquired_date && (firstDate ?? sale.contract_date)) {
        const sold = new Date(firstDate ?? sale.contract_date!);
        const got = new Date(acct.acquired_date);
        holding = sold.getTime() - got.getTime() > 365.25 * 864e5 ? "long" : "short";
      }
      const line: SaleLine = {
        saleId: sale.id,
        saleName: sale.sale_name,
        saleType: sale.sale_type,
        propertyName: propName.get(pid) ?? "",
        proceeds: r2(proceeds),
        sellingExpenses: r2(sellingExpenses),
        depletion: r2(depletion),
        gain: r2(proceeds - sellingExpenses - depletion),
        holding,
        formHint:
          sale.sale_type === "lump_sum"
            ? "Usually Form 8949 and Schedule D when timber is held as an investment"
            : "Usually Form 4797 Part I (Sec 631(b), a disposal with an economic interest kept)",
        basisSetUp: acctIds.size > 0,
      };
      sales.push(line);
      if (!line.basisSetUp) checklist.push(`${line.propertyName}: no timber basis set up, so ${line.saleName} shows no depletion.`);
      else if (line.proceeds > 0 && line.depletion === 0)
        checklist.push(`${line.saleName} (${line.propertyName}): proceeds this year but no depletion recorded.`);
    }
  }

  // ---------------------------------------------------------------- cost-share
  const awards = inp.awards.filter((a) => matchesEntity(a.entity_id ?? inp.properties.find((p) => p.id === a.property_id)?.entity_id ?? null));
  const awardIds = new Set(awards.map((a) => a.id));
  const excludedByAward = new Map<string, number>();
  for (const p of inp.costSharePayments) {
    if (p.sec126_choice !== "exclude") continue;
    excludedByAward.set(p.award_id, (excludedByAward.get(p.award_id) ?? 0) + Number(p.amount));
  }
  const costShare = inp.costSharePayments
    .filter((p) => awardIds.has(p.award_id) && inYear(p.received_date, year))
    .map((p) => {
      const a = awards.find((x) => x.id === p.award_id)!;
      return { title: a.title, program: a.program, amount: Number(p.amount), choice: p.sec126_choice, received_date: p.received_date };
    });
  const undecided = costShare.filter((c) => c.choice === "undecided").length;
  if (undecided > 0) checklist.push(`${undecided} cost-share payment${undecided === 1 ? "" : "s"} this year with the tax choice (exclude or report) not decided.`);

  // ---------------------------------------------------------------- reforestation
  const reforestation: ReforestationLine[] = [];
  for (const p of props) {
    const refCosts = inp.costs.filter((c) => c.property_id === p.id && c.tax_category === "reforestation");
    if (refCosts.length === 0) continue;
    const results = reforestationByYear(
      refCosts.map((c) => ({ paid_date: c.paid_date, amount: Number(c.amount), cost_share_award_id: c.cost_share_award_id })),
      excludedByAward,
      { isTrust }
    );
    const d = deductionForYear(results, year);
    const thisYear = results.find((r) => r.year === year);
    if (d.total === 0 && !thisYear) continue;
    reforestation.push({
      propertyName: p.name,
      paidThisYear: thisYear?.eligible ?? 0,
      costShareExcluded: thisYear?.costShareExcluded ?? 0,
      expensed: d.expensed,
      amortization: d.amortization,
      deduction: d.total,
    });
  }

  // ---------------------------------------------------------------- other costs
  const expenses: ExpenseLine[] = inp.costs
    .filter(
      (c) =>
        propIds.has(c.property_id) &&
        inYear(c.paid_date, year) &&
        (c.tax_category === "operating_expense" || c.tax_category === "capital_improvement" || c.tax_category === "not_sure")
    )
    .map((c) => ({
      propertyName: propName.get(c.property_id) ?? "",
      paid_date: c.paid_date,
      amount: Number(c.amount),
      tax_category: c.tax_category,
      what: [c.description, c.vendor].filter(Boolean).join(", "),
    }))
    .sort((a, b) => a.paid_date.localeCompare(b.paid_date));
  const notSure = expenses.filter((e) => e.tax_category === "not_sure");
  if (notSure.length > 0) checklist.push(`${notSure.length} cost${notSure.length === 1 ? "" : "s"} marked "not sure" for the accountant to categorize.`);

  const sum = (xs: number[]) => r2(xs.reduce((s, x) => s + x, 0));
  const totals = {
    proceeds: sum(sales.map((s) => s.proceeds)),
    sellingExpenses: sum(sales.map((s) => s.sellingExpenses)),
    depletion: sum(sales.map((s) => s.depletion)),
    gain: sum(sales.map((s) => s.gain)),
    reforestationDeduction: sum(reforestation.map((r) => r.deduction)),
    costShareReceived: sum(costShare.map((c) => c.amount)),
    costShareExcluded: sum(costShare.filter((c) => c.choice === "exclude").map((c) => c.amount)),
    operating: sum(expenses.filter((e) => e.tax_category === "operating_expense").map((e) => e.amount)),
    improvements: sum(expenses.filter((e) => e.tax_category === "capital_improvement").map((e) => e.amount)),
    notSure: sum(notSure.map((e) => e.amount)),
  };
  const formT = totals.depletion > 0;
  if (sales.some((s) => s.holding === "unknown")) checklist.push("Some sales have no acquisition date on record, so the holding period is not shown.");
  if (isTrust && reforestation.length > 0) checklist.push("A trust gets amortization only: no immediate $10,000 replanting deduction.");
  return { sales, reforestation, costShare, expenses, totals, formT, checklist, isTrust };
}
