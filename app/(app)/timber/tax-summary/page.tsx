import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { formatDate, formatDollars } from "@/lib/format";
import { PROGRAM_LABELS, SEC126_LABELS } from "@/lib/reforestation";
import { TAX_CATEGORIES, TAX_NOTE, type TaxCategory } from "@/lib/standActivities";
import { NO_ENTITY_KEY, buildTimberTaxSummary } from "@/lib/timberTaxSummary";
import TaxSummaryActions from "@/components/timber/TaxSummaryActions";

export const metadata = { title: "Timber tax summary" };

// ANNUAL TIMBER TAX SUMMARY: one taxpayer, one year, for the accountant.
// Built by lib/timberTaxSummary.ts from the timber records; print to PDF
// or download CSV.

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export default async function TimberTaxSummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; entity?: string }>;
}) {
  const sp = await searchParams;
  const { supabase } = await requireOrg();
  const now = new Date();
  // Most use is in winter for the year just ended.
  const defaultYear = now.getMonth() <= 3 ? now.getFullYear() - 1 : now.getFullYear();
  const year = Number(sp.year) || defaultYear;

  const [
    { data: properties },
    { data: entities },
    { data: stands },
    { data: saleStands },
    { data: sales },
    { data: settlements },
    { data: payments },
    { data: costs },
    { data: accounts },
    { data: entries },
    { data: awards },
    { data: csPayments },
    { data: activities },
  ] = await Promise.all([
    supabase.from("properties").select("id, name, entity_id").order("name"),
    supabase.from("entities").select("id, name, entity_type").order("name"),
    supabase.from("timber_stands").select("id, property_id, acres"),
    supabase.from("timber_sale_stands").select("timber_sale_id, timber_stand_id, allocation_pct"),
    supabase.from("timber_sales").select("id, sale_name, sale_type, allocation_method, contract_date"),
    supabase.from("timber_settlements").select("timber_sale_id, settlement_date, total_amount, allocation"),
    supabase.from("payments").select("timber_sale_id, amount, received_date").not("timber_sale_id", "is", null),
    supabase
      .from("timber_costs")
      .select("id, property_id, paid_date, amount, tax_category, timber_sale_id, cost_share_award_id, vendor, description, activity_id"),
    supabase.from("timber_accounts").select("id, property_id, acquisition_type, acquired_date"),
    supabase.from("timber_account_entries").select("account_id, entry_date, entry_type, basis_change, timber_sale_id"),
    supabase.from("cost_share_awards").select("id, property_id, entity_id, program, title"),
    supabase.from("cost_share_payments").select("award_id, received_date, amount, sec126_choice"),
    // Costs on work that is only planned are not counted as paid.
    supabase.from("stand_activities").select("id, status"),
  ]);

  // Taxpayers that hold timber: entities of properties with stands.
  const timberProps = new Set((stands ?? []).map((s) => s.property_id));
  const holders = new Set((properties ?? []).filter((p) => timberProps.has(p.id)).map((p) => p.entity_id ?? NO_ENTITY_KEY));
  const entityOptions = [
    ...(entities ?? []).filter((e) => holders.has(e.id)).map((e) => ({ key: e.id, name: e.name })),
    ...(holders.has(NO_ENTITY_KEY) ? [{ key: NO_ENTITY_KEY, name: "No entity" }] : []),
  ];
  const entityKey = sp.entity && entityOptions.some((o) => o.key === sp.entity) ? sp.entity : (entityOptions[0]?.key ?? NO_ENTITY_KEY);
  const entityName = entityOptions.find((o) => o.key === entityKey)?.name ?? "";

  const s = buildTimberTaxSummary({
    year,
    entityKey,
    properties: properties ?? [],
    entities: entities ?? [],
    stands: stands ?? [],
    saleStands: saleStands ?? [],
    sales: sales ?? [],
    settlements: settlements ?? [],
    payments: (payments ?? []) as Array<{ timber_sale_id: string | null; amount: number; received_date: string }>,
    costs: costs ?? [],
    activities: activities ?? [],
    accounts: accounts ?? [],
    entries: entries ?? [],
    awards: awards ?? [],
    costSharePayments: csPayments ?? [],
  });

  const years: number[] = [];
  for (let y = now.getFullYear(); y >= now.getFullYear() - 10; y--) years.push(y);

  const rows: Array<Array<string | number>> = [
    ["Section", "Item", "Property", "Date", "Amount", "Note"],
    ...s.sales.flatMap((x) => [
      ["Timber sale", `${x.saleName}: received`, x.propertyName, "", x.proceeds, x.saleType === "lump_sum" ? "Lump sum" : "Pay as cut"],
      ["Timber sale", `${x.saleName}: selling costs`, x.propertyName, "", -x.sellingExpenses, ""],
      ["Timber sale", `${x.saleName}: depletion`, x.propertyName, "", -x.depletion, ""],
      ["Timber sale", `${x.saleName}: gain`, x.propertyName, "", x.gain, `${x.holding === "long" ? "Held over a year" : x.holding === "short" ? "Held a year or less" : "Holding period unknown"}. ${x.formHint}`],
    ]),
    ...s.reforestation.map((r) => ["Replanting (Sec 194)", "Deduction this year", r.propertyName, "", r.deduction, `Expensed ${formatDollars(r.expensed)}; amortization ${formatDollars(r.amortization)}; paid this year ${formatDollars(r.paidThisYear)}; cost-share excluded ${formatDollars(r.costShareExcluded)}`]),
    ...s.costShare.map((c) => ["Cost-share received", c.title, PROGRAM_LABELS[c.program] ?? c.program, c.received_date, c.amount, SEC126_LABELS[c.choice]?.label ?? c.choice]),
    ...s.expenses.map((e) => [TAX_CATEGORIES[e.tax_category as TaxCategory]?.label ?? e.tax_category, e.what, e.propertyName, e.paid_date, e.amount, ""]),
  ];
  const csv = rows.map((r) => r.map(csvCell).join(",")).join("\n");
  const empty = s.sales.length === 0 && s.reforestation.length === 0 && s.costShare.length === 0 && s.expenses.length === 0;

  const Money = ({ v, strong = false }: { v: number; strong?: boolean }) => (
    <span className={strong ? "font-semibold text-pine-900" : "text-gray-900"}>{formatDollars(v)}</span>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6 print:max-w-none print:p-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-gray-500 print:hidden">
            <Link href="/timber" className="hover:underline">
              Timber
            </Link>{" "}
            /
          </p>
          <h1 className="text-xl font-semibold text-gray-900">
            Timber tax summary: {entityName}, {year}
          </h1>
          <p className="mt-0.5 text-sm text-gray-600">
            For your accountant. Built from the timber records; confirm with them before filing.
          </p>
        </div>
        <TaxSummaryActions
          year={year}
          years={years}
          entityKey={entityKey}
          entityOptions={entityOptions}
          csv={csv}
          fileName={`timber-tax-${year}-${entityName.replace(/[^A-Za-z0-9]+/g, "-")}.csv`}
        />
      </div>

      {/* Bottom line */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Timber received", s.totals.proceeds],
          ["Taxable timber gain (about)", s.totals.gain],
          ["Replanting deduction", s.totals.reforestationDeduction],
          ["Upkeep and other costs", s.totals.operating + s.totals.improvements + s.totals.notSure],
        ].map(([label, v]) => (
          <div key={label as string} className="rounded-xl border border-gray-200 bg-white p-3">
            <p className="text-xs text-gray-500">{label}</p>
            <p className="text-lg font-semibold text-pine-900">{formatDollars(v as number)}</p>
          </div>
        ))}
      </section>

      {s.checklist.length > 0 || s.formT ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
          <h2 className="mb-1 font-semibold text-amber-900">Before you send this</h2>
          <ul className="list-disc space-y-0.5 pl-5 text-amber-900">
            {s.checklist.map((c) => (
              <li key={c}>{c}</li>
            ))}
            {s.formT ? <li>Depletion is claimed this year: Form T (Timber) is likely needed. Ask your accountant.</li> : null}
          </ul>
        </section>
      ) : null}

      {empty ? (
        <p className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500">
          No timber sales, replanting costs, cost-share, or timber costs recorded for {entityName} in {year}.
        </p>
      ) : null}

      {s.sales.length > 0 ? (
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-2 font-semibold text-gray-900">Timber sales</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="py-1">Sale</th>
                <th className="py-1 text-right">Received</th>
                <th className="py-1 text-right">Selling costs</th>
                <th className="py-1 text-right">Depletion</th>
                <th className="py-1 text-right">Gain</th>
              </tr>
            </thead>
            <tbody>
              {s.sales.map((x) => (
                <tr key={`${x.saleId}:${x.propertyName}`} className="border-t border-gray-100 align-top">
                  <td className="py-1.5">
                    <Link href={`/timber-sales/${x.saleId}`} className="font-medium text-gray-900 hover:underline">
                      {x.saleName}
                    </Link>
                    <span className="block text-xs text-gray-500">
                      {x.propertyName} · {x.saleType === "lump_sum" ? "Lump sum" : "Pay as cut"} ·{" "}
                      {x.holding === "long" ? "held over a year" : x.holding === "short" ? "held a year or less" : "holding period unknown"}
                    </span>
                    <span className="block text-xs text-gray-500">{x.formHint}</span>
                  </td>
                  <td className="py-1.5 text-right"><Money v={x.proceeds} /></td>
                  <td className="py-1.5 text-right"><Money v={x.sellingExpenses} /></td>
                  <td className="py-1.5 text-right"><Money v={x.depletion} /></td>
                  <td className="py-1.5 text-right"><Money v={x.gain} strong /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {s.reforestation.length > 0 ? (
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-1 font-semibold text-gray-900">Replanting deduction (Section 194)</h2>
          <p className="mb-2 text-xs text-gray-500">
            Up to $10,000 per property per year can be deducted right away{s.isTrust ? " (not for a trust)" : ""}; the rest is
            amortized over 84 months. Cost-share excluded from income is netted out first.
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="py-1">Property</th>
                <th className="py-1 text-right">Paid this year</th>
                <th className="py-1 text-right">Cost-share excluded</th>
                <th className="py-1 text-right">Deducted now</th>
                <th className="py-1 text-right">Amortization</th>
                <th className="py-1 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {s.reforestation.map((r) => (
                <tr key={r.propertyName} className="border-t border-gray-100">
                  <td className="py-1.5">{r.propertyName}</td>
                  <td className="py-1.5 text-right"><Money v={r.paidThisYear} /></td>
                  <td className="py-1.5 text-right"><Money v={r.costShareExcluded} /></td>
                  <td className="py-1.5 text-right"><Money v={r.expensed} /></td>
                  <td className="py-1.5 text-right"><Money v={r.amortization} /></td>
                  <td className="py-1.5 text-right"><Money v={r.deduction} strong /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {s.costShare.length > 0 ? (
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-2 font-semibold text-gray-900">Cost-share received</h2>
          <ul className="space-y-1 text-sm">
            {s.costShare.map((c, i) => (
              <li key={i} className="flex flex-wrap gap-x-3">
                <span className="text-xs text-gray-500">{formatDate(c.received_date)}</span>
                <span className="text-gray-900">{c.title}</span>
                <span className="text-gray-500">{PROGRAM_LABELS[c.program] ?? c.program}</span>
                <span className="text-gray-600">{SEC126_LABELS[c.choice]?.label ?? c.choice}</span>
                <span className="ml-auto"><Money v={c.amount} /></span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {s.expenses.length > 0 ? (
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-2 font-semibold text-gray-900">Other timber costs paid</h2>
          <ul className="space-y-1 text-sm">
            {s.expenses.map((e, i) => (
              <li key={i} className="flex flex-wrap gap-x-3">
                <span className="text-xs text-gray-500">{formatDate(e.paid_date)}</span>
                <span className="text-gray-900">{e.what || "Cost"}</span>
                <span className="text-gray-500">{e.propertyName}</span>
                <span className="text-gray-600">{TAX_CATEGORIES[e.tax_category as TaxCategory]?.label ?? e.tax_category}</span>
                <span className="ml-auto"><Money v={e.amount} /></span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-gray-500">
            Whether upkeep costs are deducted now or added to basis depends on whether the timber is held as an
            investment or a business. Your accountant decides.
          </p>
        </section>
      ) : null}

      <p className="text-xs text-gray-500">{TAX_NOTE} Property taxes on timber land are on the Property Taxes page.</p>
    </div>
  );
}
