import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { formatDollars } from "@/lib/format";
import { NO_ENTITY } from "@/lib/entities";
import {
  UNASSIGNED,
  allocateToProperties,
  emptyTotals,
  informationalGovPayments,
  loadIncomeInputs,
  summarizeByYear,
  type IncomeType,
  type PropertyTotals,
} from "@/lib/income";
import RentUpload from "@/components/payments/RentUpload";

export const metadata = { title: "Income" };

const TYPE_LABELS: Record<IncomeType, string> = {
  agricultural: "Agricultural leases",
  hunting: "Hunting leases",
  timber: "Timber",
  government: "Government payments (your share)",
};

export default async function IncomePage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; entity?: string }>;
}) {
  const { supabase, profile } = await requireOrg();
  const { year: yearParam, entity: entityParam } = await searchParams;

  const [inputs, { data: properties }, { data: entities }] = await Promise.all([
    loadIncomeInputs(supabase),
    supabase.from("properties").select("id, name, entity_id").order("name"),
    supabase.from("entities").select("id, name").order("name"),
  ]);

  const byYear = summarizeByYear(inputs);
  const currentYear = new Date().getFullYear();
  const years = Array.from(new Set([...byYear.keys(), currentYear])).sort();
  const selectedYear = Number(yearParam) || currentYear;

  const totals = byYear.get(selectedYear) ?? emptyTotals();
  const sumTypes = (r: Record<IncomeType, number>) =>
    r.agricultural + r.hunting + r.timber + r.government;
  const totalExpected = sumTypes(totals.expected);
  const totalReceived = sumTypes(totals.received);
  const govInfo = informationalGovPayments(inputs, selectedYear);

  const byProperty = allocateToProperties(inputs, selectedYear);
  const propertyName = new Map((properties ?? []).map((p) => [p.id, p.name]));

  // Entity level: group the by-property rows under the entity that holds
  // each property. Unassigned income (no land linked) and unmatched taxes
  // belong to no entity and only show in the "All entities" view.
  const entityList = entities ?? [];
  const hasEntities = entityList.length > 0;
  const entityOfProperty = new Map(
    (properties ?? []).map((p) => [p.id, p.entity_id ?? NO_ENTITY])
  );
  const entityFilter = entityParam ?? "";
  const entityGroups: Array<{
    key: string;
    name: string | null;
    rows: Array<[string, PropertyTotals]>;
  }> = [];
  {
    const orderedKeys = [
      ...entityList.map((e) => e.id),
      NO_ENTITY,
      UNASSIGNED,
    ];
    for (const key of orderedKeys) {
      if (entityFilter && key !== entityFilter) continue;
      const rows = Array.from(byProperty.entries())
        .filter(([propertyId]) =>
          key === UNASSIGNED
            ? propertyId === UNASSIGNED
            : propertyId !== UNASSIGNED &&
              (entityOfProperty.get(propertyId) ?? NO_ENTITY) === key
        )
        .sort((a, b) => b[1].expected - a[1].expected);
      if (rows.length === 0) continue;
      entityGroups.push({
        key,
        name:
          key === UNASSIGNED
            ? null
            : key === NO_ENTITY
              ? "No entity"
              : (entityList.find((e) => e.id === key)?.name ?? "Entity"),
        rows,
      });
    }
  }
  const subtotalOf = (rows: Array<[string, PropertyTotals]>) =>
    rows.reduce(
      (acc, [, v]) => ({
        expected: acc.expected + v.expected,
        received: acc.received + v.received,
        taxesDue: acc.taxesDue + v.taxesDue,
        taxesPaid: acc.taxesPaid + v.taxesPaid,
      }),
      { expected: 0, received: 0, taxesDue: 0, taxesPaid: 0 }
    );

  // Chart data: expected vs received vs taxes paid per year
  const chartYears = years.map((y) => {
    const t = byYear.get(y);
    const expected = t ? sumTypes(t.expected) : 0;
    const received = t ? sumTypes(t.received) : 0;
    return { year: y, expected, received, taxes: t?.taxesPaid ?? 0 };
  });
  const maxValue = Math.max(
    1,
    ...chartYears.flatMap((c) => [c.expected, c.received, c.taxes])
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-gray-900">Income</h1>
        <RentUpload orgId={profile.organization_id!} />
        <div className="ml-auto flex gap-1">
          {years.map((y) => (
            <Link
              key={y}
              href={`/income?year=${y}${entityFilter ? `&entity=${entityFilter}` : ""}`}
              className={
                "rounded-lg px-3 py-1.5 text-sm font-medium " +
                (y === selectedYear
                  ? "bg-kelly-500 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50")
              }
            >
              {y}
            </Link>
          ))}
        </div>
      </div>

      {hasEntities ? (
        <div className="flex flex-wrap gap-1.5">
          {[
            { key: "", label: "All entities" },
            ...entityList.map((e) => ({ key: e.id, label: e.name })),
            { key: NO_ENTITY, label: "No entity" },
          ].map((chip) => (
            <Link
              key={chip.key || "all"}
              href={`/income?year=${selectedYear}${chip.key ? `&entity=${chip.key}` : ""}`}
              className={
                "rounded-full border px-3 py-1 text-sm font-medium " +
                (entityFilter === chip.key
                  ? "border-kelly-500 bg-kelly-50 text-pine-900"
                  : "border-gray-200 bg-white text-gray-600 hover:border-gray-300")
              }
            >
              {chip.label}
            </Link>
          ))}
        </div>
      ) : null}

      {/* Expected vs received by year */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center gap-4">
          <h2 className="text-base font-semibold text-gray-900">
            Expected vs received by year
          </h2>
          <span className="flex items-center gap-1.5 text-xs text-gray-600">
            <span className="h-3 w-3 rounded-[2px] border border-gray-300 bg-gray-200" />
            Expected
          </span>
          <span className="flex items-center gap-1.5 text-xs text-gray-600">
            <span className="h-3 w-3 rounded-[2px] bg-kelly-500" />
            Received
          </span>
          <span className="flex items-center gap-1.5 text-xs text-gray-600">
            <span className="h-3 w-3 rounded-[2px] bg-pine-900" />
            Taxes paid
          </span>
        </div>
        <div className="flex items-end gap-6 overflow-x-auto pb-1" style={{ height: 180 }}>
          {chartYears.map((c) => (
            <div key={c.year} className="flex h-full min-w-28 flex-col justify-end">
              <div className="flex h-[calc(100%-1.5rem)] items-end justify-center gap-[2px]">
                <div className="flex w-8 flex-col items-center justify-end self-stretch">
                  <span className="mb-0.5 text-[10px] tabular-nums text-gray-500">
                    {c.expected > 0 ? formatDollars(c.expected) : ""}
                  </span>
                  <div
                    className="w-full rounded-t-[4px] border border-gray-300 bg-gray-200"
                    style={{ height: `${(c.expected / maxValue) * 100}%` }}
                  />
                </div>
                <div className="flex w-8 flex-col items-center justify-end self-stretch">
                  <span className="mb-0.5 text-[10px] tabular-nums text-gray-500">
                    {c.received > 0 ? formatDollars(c.received) : ""}
                  </span>
                  <div
                    className="w-full rounded-t-[4px] bg-kelly-500"
                    style={{ height: `${(c.received / maxValue) * 100}%` }}
                  />
                </div>
                <div className="flex w-8 flex-col items-center justify-end self-stretch">
                  <span className="mb-0.5 text-[10px] tabular-nums text-gray-500">
                    {c.taxes > 0 ? formatDollars(c.taxes) : ""}
                  </span>
                  <div
                    className="w-full rounded-t-[4px] bg-pine-900"
                    style={{ height: `${(c.taxes / maxValue) * 100}%` }}
                  />
                </div>
              </div>
              <p
                className={
                  "mt-1 h-5 text-center text-xs " +
                  (c.year === selectedYear ? "font-semibold text-pine-900" : "text-gray-500")
                }
              >
                {c.year}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Selected year: by type */}
      <section className="rounded-xl border border-gray-200 bg-white">
        <h2 className="border-b border-gray-200 px-4 py-3 text-base font-semibold text-gray-900">
          {selectedYear} by income type
        </h2>
        {totals.hasProjection ? (
          <p className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-900">
            Expected includes PROJECTED rent, computed from lease terms and
            each year{"'"}s assumptions (your tenant{"'"}s prices and yields).
            Projections change as those numbers update. Generating a lease
            {"'"}s expected payments replaces its projection with the payment
            schedule.
          </p>
        ) : null}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2 text-right">Expected</th>
                <th className="px-4 py-2 text-right">Received</th>
                <th className="px-4 py-2 text-right">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(TYPE_LABELS) as IncomeType[]).map((type) => (
                <tr key={type} className="border-b border-gray-100 last:border-0">
                  <td className="px-4 py-2">
                    {TYPE_LABELS[type]}
                    {type === "government" && govInfo.total > 0 ? (
                      <span className="block text-xs font-normal text-gray-500">
                        Base acres on your land generate approximately{" "}
                        {formatDollars(govInfo.total)}/yr to your tenant
                        {totals.expected.government > 0 ? "" : " (no share under your leases)"}.{" "}
                        <Link href="/gov-payments" className="text-kelly-700 hover:underline">
                          Details
                        </Link>
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatDollars(totals.expected[type])}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatDollars(totals.received[type])}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatDollars(Math.max(totals.expected[type] - totals.received[type], 0))}
                  </td>
                </tr>
              ))}
              <tr className="border-b border-gray-100 font-semibold text-gray-900">
                <td className="px-4 py-2">Gross income</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatDollars(totalExpected)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatDollars(totalReceived)}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {formatDollars(Math.max(totalExpected - totalReceived, 0))}
                </td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="px-4 py-2">Property taxes</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  ({formatDollars(totals.taxesDue)})
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  ({formatDollars(totals.taxesPaid)})
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  ({formatDollars(Math.max(totals.taxesDue - totals.taxesPaid, 0))})
                </td>
              </tr>
              <tr className="font-semibold text-pine-900">
                <td className="px-4 py-2">Net</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {formatDollars(totalExpected - totals.taxesDue)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {formatDollars(totalReceived - totals.taxesPaid)}
                </td>
                <td className="px-4 py-2"></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Selected year: by property */}
      <section className="rounded-xl border border-gray-200 bg-white">
        <h2 className="border-b border-gray-200 px-4 py-3 text-base font-semibold text-gray-900">
          {selectedYear} by property
        </h2>
        {entityGroups.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">
            {entityFilter
              ? `No income recorded or projected for this entity in ${selectedYear}.`
              : `No income recorded or projected for ${selectedYear} yet. Lump sums
                 allocate across a lease's linked properties by leased acres.`}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-2">Property</th>
                  <th className="px-4 py-2 text-right">Expected</th>
                  <th className="px-4 py-2 text-right">Received</th>
                  <th className="px-4 py-2 text-right">Taxes due</th>
                  <th className="px-4 py-2 text-right">Taxes paid</th>
                  <th className="px-4 py-2 text-right">Net received</th>
                </tr>
              </thead>
              <tbody>
                {entityGroups.map((group) => {
                  const subtotal = subtotalOf(group.rows);
                  return [
                    hasEntities && group.name ? (
                      <tr
                        key={`${group.key}-header`}
                        className="border-b border-gray-100 bg-gray-50 font-semibold text-pine-900"
                      >
                        <td className="px-4 py-2">
                          {group.key !== NO_ENTITY ? (
                            <Link
                              href={`/entities/${group.key}`}
                              className="hover:underline"
                            >
                              {group.name}
                            </Link>
                          ) : (
                            <span className="text-gray-500">{group.name}</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {formatDollars(subtotal.expected)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {formatDollars(subtotal.received)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {subtotal.taxesDue ? `(${formatDollars(subtotal.taxesDue)})` : ""}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {subtotal.taxesPaid ? `(${formatDollars(subtotal.taxesPaid)})` : ""}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {formatDollars(subtotal.received - subtotal.taxesPaid)}
                        </td>
                      </tr>
                    ) : null,
                    ...group.rows.map(([propertyId, v]) => (
                      <tr key={propertyId} className="border-b border-gray-100 last:border-0">
                        <td className={"px-4 py-2" + (hasEntities && group.name ? " pl-7" : "")}>
                          {propertyId === UNASSIGNED ? (
                            <span className="text-gray-500">
                              Unassigned (no land linked)
                            </span>
                          ) : (
                            <Link
                              href={`/properties/${propertyId}`}
                              className="font-medium text-gray-900 hover:underline"
                            >
                              {propertyName.get(propertyId) ?? "Property"}
                            </Link>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {formatDollars(v.expected)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {formatDollars(v.received)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {v.taxesDue ? `(${formatDollars(v.taxesDue)})` : ""}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {v.taxesPaid ? `(${formatDollars(v.taxesPaid)})` : ""}
                        </td>
                        <td className="px-4 py-2 text-right font-medium tabular-nums text-pine-900">
                          {formatDollars(v.received - v.taxesPaid)}
                        </td>
                      </tr>
                    )),
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
