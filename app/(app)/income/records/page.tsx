import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { formatDollars } from "@/lib/format";
import { INCOME_RECORD_TYPE_LABELS, totalsByYear, type IncomeRecordRow, type IncomeRecordType } from "@/lib/incomeRecords";
import IncomeRecordsClient from "./IncomeRecordsClient";

export const metadata = { title: "Income records" };

// INCOME RECORDS (migration 0051): income received outside a lease
// payment or timber settlement, mostly history from the old books. The
// Income page counts every record as received income in its year.

export default async function IncomeRecordsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; entity?: string; type?: string; review?: string }>;
}) {
  const sp = await searchParams;
  const { supabase, profile } = await requireOrg();
  const [{ data: records }, { data: entities }, { data: properties }] = await Promise.all([
    supabase
      .from("income_records")
      .select("id, year, received_date, period, payer, payee_name, entity_id, property_id, income_type, amount, basis, confidence, needs_review, source, notes")
      .order("year", { ascending: false })
      .order("received_date", { ascending: false, nullsFirst: false }),
    supabase.from("entities").select("id, name").order("name"),
    supabase.from("properties").select("id, name, entity_id").order("name"),
  ]);
  const all = (records ?? []) as IncomeRecordRow[];
  const years = Array.from(new Set(all.map((r) => r.year))).sort((a, b) => b - a);
  const year = sp.year === "all" ? null : Number(sp.year) || null;
  const rows = all.filter(
    (r) =>
      (!year || r.year === year) &&
      (!sp.entity || r.entity_id === sp.entity) &&
      (!sp.type || r.income_type === sp.type) &&
      (sp.review !== "1" || r.needs_review)
  );
  const reviewCount = all.filter((r) => r.needs_review).length;
  const total = rows.reduce((s, r) => s + Number(r.amount), 0);
  const summary = totalsByYear(rows);
  const typesInView = Array.from(new Set(rows.map((r) => r.income_type))) as IncomeRecordType[];

  const q = (over: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const cur: Record<string, string | null> = { year: sp.year ?? null, entity: sp.entity ?? null, type: sp.type ?? null, review: sp.review ?? null, ...over };
    for (const [k, v] of Object.entries(cur)) if (v) p.set(k, v);
    const s = p.toString();
    return `/income/records${s ? `?${s}` : ""}`;
  };
  const chip = (active: boolean) =>
    "rounded-lg px-2.5 py-1 text-xs font-medium " + (active ? "bg-kelly-500 text-white" : "bg-white text-gray-600 hover:bg-gray-50");

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
      <div>
        <p className="text-sm text-gray-500">
          <Link href="/income" className="hover:underline">
            Income
          </Link>{" "}
          /
        </p>
        <h1 className="text-xl font-semibold text-gray-900">Income records</h1>
        <p className="mt-0.5 max-w-3xl text-sm text-gray-600">
          Income received outside a lease payment or a timber sale: rent history from the old books, solar and tower payments,
          building rent. The Income page counts each record as received in its year. Records marked{" "}
          <span className="font-semibold text-amber-800">Check</span> came from a source that was unclear; open the note, fix
          the property or type if needed, then clear the mark.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap gap-1">
          <Link href={q({ year: "all" })} className={chip(!year)}>
            All years
          </Link>
          {years.map((y) => (
            <Link key={y} href={q({ year: String(y) })} className={chip(year === y)}>
              {y}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Link href={q({ entity: null })} className={chip(!sp.entity)}>
            All entities
          </Link>
          {(entities ?? []).map((e) => (
            <Link key={e.id} href={q({ entity: e.id })} className={chip(sp.entity === e.id)}>
              {e.name}
            </Link>
          ))}
          <span className="mx-1 text-gray-300">|</span>
          <Link href={q({ review: sp.review === "1" ? null : "1" })} className={chip(sp.review === "1")}>
            Needs a check ({reviewCount})
          </Link>
          {sp.type ? (
            <Link href={q({ type: null })} className={chip(true)}>
              {INCOME_RECORD_TYPE_LABELS[sp.type as IncomeRecordType] ?? sp.type} ×
            </Link>
          ) : null}
        </div>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <p className="text-2xl font-semibold text-pine-900">{formatDollars(total)}</p>
          <p className="text-sm text-gray-600">
            {rows.length} record{rows.length === 1 ? "" : "s"}
            {year ? ` in ${year}` : ""}
          </p>
        </div>
        {summary.length > 1 ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-xs">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="py-1 pr-3">Year</th>
                  {typesInView.map((t) => (
                    <th key={t} className="py-1 pr-3 text-right">
                      <Link href={q({ type: t })} className="hover:underline">
                        {INCOME_RECORD_TYPE_LABELS[t] ?? t}
                      </Link>
                    </th>
                  ))}
                  <th className="py-1 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((s) => (
                  <tr key={s.year} className="border-t border-gray-100">
                    <td className="py-1 pr-3">
                      <Link href={q({ year: String(s.year) })} className="font-medium text-gray-900 hover:underline">
                        {s.year}
                      </Link>
                    </td>
                    {typesInView.map((t) => (
                      <td key={t} className="py-1 pr-3 text-right tabular-nums text-gray-700">
                        {s.byType.get(t) ? formatDollars(s.byType.get(t)!) : ""}
                      </td>
                    ))}
                    <td className="py-1 text-right font-medium tabular-nums text-gray-900">{formatDollars(s.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <IncomeRecordsClient
        orgId={profile.organization_id!}
        rows={rows}
        entities={entities ?? []}
        properties={properties ?? []}
        defaultYear={year ?? new Date().getFullYear()}
      />
    </div>
  );
}
