// ANNUAL TIMBER TAX SUMMARY: one taxpayer (entity), one tax year, built
// from the timber records (migrations 0045-0047) for the accountant.
// Pure; the page loads rows and renders this. Nothing here is advice:
// it organizes the numbers and flags what is missing.

import { formatDate, formatDollars, plural } from "./format";
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
    activity_id?: string | null; // the stand work the cost was entered on
  }>;
  // Stand work (stand_activities) the costs hang on. A cost on work that
  // is only planned, or was skipped, is not counted as paid.
  activities?: Array<{ id: string; status: string }>;
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

// One amount split by shares, to the cent. When the shares cover the
// whole amount, the last share that gets anything takes the rounding
// remainder, so the parts add back to the whole ($100,000.01 split
// 50/50 is $50,000.01 and $50,000.00, not two of $50,000.01).
function splitToCents(amount: number, shares: number[]): number[] {
  const parts = shares.map((sh) => r2(amount * sh));
  const last = shares.reduce((at, sh, i) => (sh > 0 ? i : at), -1);
  if (last >= 0 && Math.abs(shares.reduce((s, sh) => s + sh, 0) - 1) < 0.00001) {
    parts[last] = r2(parts[last] + (amount - parts.reduce((s, x) => s + x, 0)));
  }
  return parts;
}

const costLabel = (c: { description: string | null; vendor: string | null; amount: number; paid_date: string }) =>
  `${[c.description, c.vendor].filter(Boolean).join(", ") || "Cost"} ${formatDollars(Number(c.amount))} (${formatDate(c.paid_date)})`;

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

  // Costs entered on work that is not done yet (planned or skipped) have
  // not been paid as far as this summary goes; the stand page leaves
  // them out of its total the same way.
  const activityStatus = new Map((inp.activities ?? []).map((a) => [a.id, a.status]));
  const notDone = (c: { activity_id?: string | null }) => {
    const status = c.activity_id ? activityStatus.get(c.activity_id) : undefined;
    return status !== undefined && status !== "done";
  };
  const costs = inp.costs.filter((c) => !notDone(c));
  const waiting = inp.costs.filter((c) => notDone(c) && propIds.has(c.property_id) && inYear(c.paid_date, year));

  // ---------------------------------------------------------------- sales
  const sales: SaleLine[] = [];
  const countedSellingCosts = new Set<string>();
  for (const sale of inp.sales) {
    const links = inp.saleStands.filter((l) => l.timber_sale_id === sale.id);
    // A sale's money counts whichever way it was recorded: settlements
    // and payments both, whatever the sale type says today (the Income
    // page counts them the same way).
    const saleSettlements = inp.settlements.filter((x) => x.timber_sale_id === sale.id);
    const salePayments = inp.payments.filter((x) => x.timber_sale_id === sale.id);
    if (links.length === 0) {
      // No stand, so no property and no taxpayer: the sale cannot be put
      // in anyone's summary. Say so in every summary rather than drop it.
      const received =
        saleSettlements.filter((s) => inYear(s.settlement_date, year)).reduce((s, x) => s + (Number(x.total_amount) || 0), 0) +
        salePayments.filter((p) => inYear(p.received_date, year)).reduce((s, x) => s + (Number(x.amount) || 0), 0);
      if (received > 0) {
        checklist.push(
          `${sale.sale_name}: ${formatDollars(r2(received))} came in during ${year}, but the sale is not linked to any timber stand, so it is left out of this summary. Link its stands on the sale page.`
        );
      }
      continue;
    }
    const saleStands = links.map((l) => ({
      id: l.timber_stand_id,
      acres: standAcres.get(l.timber_stand_id) ?? null,
      allocation_pct: l.allocation_pct,
      property_id: standProp.get(l.timber_stand_id) ?? "",
    }));
    const method = (sale.allocation_method ?? "by_acres") as AllocationMethod;
    // Every property the sale touches, in a fixed order, so one amount
    // splits the same way in every taxpayer's summary.
    const saleProps = Array.from(new Set(saleStands.map((s) => s.property_id))).sort();
    const touched = saleProps.filter((p) => propIds.has(p));
    if (touched.length === 0) continue;
    const moneyDates = [
      ...saleSettlements.map((s) => s.settlement_date),
      ...salePayments.map((p) => p.received_date),
    ]
      .filter(Boolean)
      .sort();
    const firstDate: string | null = moneyDates[0] ?? null;
    const proceedsYears = new Set(moneyDates.map((d) => d.slice(0, 4)));
    const proceedsByProp = new Map<string, number>();
    const addMoney = (date: string, amount: number, allocation: SettlementAllocation | null) => {
      if (!inYear(date, year)) return;
      const parts = splitToCents(
        Number(amount) || 0,
        saleProps.map((pid) => propertyShareOfSale(method, saleStands, pid, allocation))
      );
      saleProps.forEach((pid, i) => proceedsByProp.set(pid, (proceedsByProp.get(pid) ?? 0) + parts[i]));
    };
    for (const s of saleSettlements) addMoney(s.settlement_date, s.total_amount, s.allocation as SettlementAllocation | null);
    for (const p of salePayments) addMoney(p.received_date, p.amount, null);
    for (const pid of touched) {
      const proceeds = proceedsByProp.get(pid) ?? 0;
      const acctIds = new Set(accountsByProp.get(pid) ?? []);
      const depletion = -inp.entries
        .filter((e) => acctIds.has(e.account_id) && e.timber_sale_id === sale.id && e.entry_type === "depletion" && inYear(e.entry_date, year))
        .reduce((s, e) => s + Number(e.basis_change), 0);
      const saleCosts = costs.filter((c) => c.property_id === pid && c.timber_sale_id === sale.id && c.tax_category === "selling_expense");
      for (const c of saleCosts) countedSellingCosts.add(c.id);
      const sellingExpenses = saleCosts.filter((c) => inYear(c.paid_date, year)).reduce((s, c) => s + Number(c.amount), 0);
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
        depletion: r2(depletion) || 0, // no -0 when nothing is depleted
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
      // Selling costs count in the year they were paid. When that is a
      // year the sale brought in no money, the accountant should see it.
      const offYear = saleCosts.filter((c) => !proceedsYears.has(c.paid_date.slice(0, 4)));
      if (offYear.some((c) => inYear(c.paid_date, year)) || (line.proceeds > 0 && offYear.length > 0)) {
        const years = Array.from(new Set(offYear.map((c) => c.paid_date.slice(0, 4)))).sort();
        checklist.push(
          `${line.saleName} (${line.propertyName}): ${formatDollars(r2(offYear.reduce((s, c) => s + Number(c.amount), 0)))} of selling costs paid in ${years.join(" and ")}, a year with no money in from this sale. This summary counts selling costs in the year paid. Ask your accountant which year they belong in.`
        );
      }
    }
  }

  // Selling costs that landed on no sale line above are in no number on
  // this page: list them so they are not lost.
  const straySelling = costs.filter(
    (c) =>
      propIds.has(c.property_id) &&
      c.tax_category === "selling_expense" &&
      inYear(c.paid_date, year) &&
      !countedSellingCosts.has(c.id)
  );
  const noSale = straySelling.filter((c) => !c.timber_sale_id);
  if (noSale.length > 0) {
    checklist.push(
      `${plural(noSale.length, "selling cost")} not linked to a timber sale, so not counted in this summary: ${noSale.map(costLabel).join("; ")}. Pick the sale on the work each one was entered with, or enter it under Selling costs on the sale page instead.`
    );
  }
  const wrongSale = straySelling.filter((c) => c.timber_sale_id);
  if (wrongSale.length > 0) {
    checklist.push(
      `${plural(wrongSale.length, "selling cost")} linked to a sale that has no stand on the cost's property, so not counted in this summary: ${wrongSale.map(costLabel).join("; ")}. Check the stands linked on the sale page.`
    );
  }
  if (waiting.length > 0) {
    checklist.push(
      `${plural(waiting.length, "cost")} totaling ${formatDollars(r2(waiting.reduce((s, c) => s + Number(c.amount), 0)))} left out because the work they were entered on is not marked as done. If the work is finished and paid, mark it done on the stand page.`
    );
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
    const refCosts = costs.filter((c) => c.property_id === p.id && c.tax_category === "reforestation");
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
  const expenses: ExpenseLine[] = costs
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
