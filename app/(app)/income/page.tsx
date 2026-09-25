import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { formatDollars } from "@/lib/format";
import { NO_ENTITY, parseEntityParam } from "@/lib/entities";
import {
  UNASSIGNED,
  allocateToProperties,
  emptyTotals,
  informationalGovPayments,
  loadIncomeInputs,
  summarizeByYear,
  sumPropertyScope,
  type IncomeType,
  type PropertyTotals,
  govShareRows,
  leaseYearRows,
} from "@/lib/income";
import { cropAssumptions } from "@/lib/leaseLogic";
import { STRUCTURE_LABELS, structureOf } from "@/lib/leaseExplain";
import RentUpload from "@/components/payments/RentUpload";
import EntityFilterChips from "@/components/entities/EntityFilterChips";

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

  const [inputs, { data: properties }, { data: entities }, { data: leaseNames }, { data: tenants }] =
    await Promise.all([
      loadIncomeInputs(supabase),
      supabase.from("properties").select("id, name, entity_id").order("name"),
      supabase.from("entities").select("id, name").order("name"),
      supabase.from("leases").select("id, name, tenant_id"),
      supabase.from("tenants").select("id, name"),
    ]);
  // Which assumption values behind the projections came from tenant
  // data (they fill and refresh automatically every sync): drives the
  // wording of the projection note below so the reader knows these
  // figures rest on the tenant's own projections.
  const tenantKinds = new Set<string>();
  for (const a of inputs.assumptions) {
    for (const e of cropAssumptions(a.data)) {
      for (const s of Object.values(e.sources ?? {})) {
        if (s?.kind) tenantKinds.add(s.kind);
      }
    }
  }
  const usesTenantData = tenantKinds.size > 0;
  const hasFinalPrices = tenantKinds.has("tenant_final");

  const byYear = summarizeByYear(inputs);
  const currentYear = new Date().getFullYear();
  const years = Array.from(new Set([...byYear.keys(), currentYear])).sort();
  const selectedYear = Number(yearParam) || currentYear;

  // Entity filter: MULTI-SELECT (empty = all entities). EVERY number on
  // the page recomputes within the selection by summing the per-property
  // allocation over the selected entities' properties - the old code
  // filtered only the by-property groups and left the totals, chart,
  // gov line, and tax rows org-wide (the reported bug).
  const entityList = entities ?? [];
  const hasEntities = entityList.length > 0;
  const entityOfProperty = new Map(
    (properties ?? []).map((p) => [p.id, p.entity_id ?? NO_ENTITY])
  );
  const selectedKeys = parseEntityParam(entityParam).filter(
    (k) => k === NO_ENTITY || entityList.some((e) => e.id === k)
  );
  const filtering = selectedKeys.length > 0;
  const selectedSet = new Set(selectedKeys);
  // The property scope the selection resolves to (null = everything,
  // which includes Unassigned; a concrete selection never does).
  const scope = filtering
    ? new Set(
        (properties ?? [])
          .filter((p) => selectedSet.has(p.entity_id ?? NO_ENTITY))
          .map((p) => p.id)
      )
    : null;

  const byProperty = allocateToProperties(inputs, selectedYear);
  const totals = filtering
    ? sumPropertyScope(byProperty, scope)
    : (byYear.get(selectedYear) ?? emptyTotals());
  const sumTypes = (r: Record<IncomeType, number>) =>
    r.agricultural + r.hunting + r.timber + r.government;
  const totalExpected = sumTypes(totals.expected);
  const totalReceived = sumTypes(totals.received);

  // Government payments line, scoped the same way (the rows carry their
  // property).
  const govInfo = informationalGovPayments(inputs, selectedYear);
  const govInfoTotal = scope
    ? Array.from(govInfo.byProperty.entries()).reduce(
        (s, [pid, amount]) => (scope.has(pid) ? s + amount : s),
        0
      )
    : govInfo.total;
  const govRowsYear = govShareRows(inputs, selectedYear).filter(
    (r) => !scope || scope.has(r.propertyId)
  );
  const fsaDirectShare = govRowsYear.some((r) => r.landownerAmount > 0 && r.receivedVia === "fsa_direct");
  const tenantRemitShare = govRowsYear.some((r) => r.landownerAmount > 0 && r.receivedVia === "tenant_remits");

  const propertyName = new Map((properties ?? []).map((p) => [p.id, p.name]));

  // By lease: every lease with expected or received rent in the year,
  // each row a door into how its number was figured. Under an entity
  // filter each lease scales to its acres inside the selection, so the
  // column adds up to the agricultural and hunting lines above.
  const leaseMeta = new Map((leaseNames ?? []).map((l) => [l.id, l]));
  const tenantName = new Map((tenants ?? []).map((t) => [t.id, t.name]));
  const leaseById = new Map(inputs.leases.map((l) => [l.id, l]));
  const leaseRows = leaseYearRows(inputs, selectedYear, scope).map((r) => {
    const lease = leaseById.get(r.leaseId);
    const meta = leaseMeta.get(r.leaseId);
    return {
      ...r,
      name: meta?.name ?? "Lease",
      tenant: meta ? (tenantName.get(meta.tenant_id) ?? null) : null,
      structure: lease ? STRUCTURE_LABELS[structureOf(lease)] : "Lease",
      expectedScoped: r.expected * r.scopeShare,
      receivedScoped: r.received * r.scopeShare,
      partial: r.scopeShare < 0.9999,
    };
  });
  const leaseTotals = leaseRows.reduce(
    (s, r) => ({ expected: s.expected + r.expectedScoped, received: s.received + r.receivedScoped }),
    { expected: 0, received: 0 }
  );

  // Entity level: group the by-property rows under the entity that holds
  // each property. Unassigned income (no land linked) and unmatched taxes
  // belong to no entity and only show in the "All entities" view.
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
      if (filtering && !selectedSet.has(key)) continue;
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

  // Chart data: expected vs received vs taxes paid per year, computed
  // within the entity selection (per-year allocation; the years list is
  // small).
  const chartYears = years.map((y) => {
    const t = filtering
      ? sumPropertyScope(
          y === selectedYear ? byProperty : allocateToProperties(inputs, y),
          scope
        )
      : (byYear.get(y) ?? emptyTotals());
    return {
      year: y,
      expected: sumTypes(t.expected),
      received: sumTypes(t.received),
      taxes: t.taxesPaid,
    };
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
              href={`/income?year=${y}${filtering ? `&entity=${selectedKeys.join(",")}` : ""}`}
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
        <EntityFilterChips
          entities={entityList}
          selected={selectedKeys}
          basePath="/income"
          extraParams={{ year: String(selectedYear) }}
        />
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
            each year{"'"}s assumptions.
            {usesTenantData ? (
              <>
                {" "}
                Those assumptions are based on your tenant{"'"}s own
                PROJECTED prices and yields where shared; they fill in and
                update automatically with every sync, so these figures are
                estimates that will move as your tenant revises projections
                {hasFinalPrices
                  ? " (prices your farmer has marked final are settlement numbers, not projections)"
                  : ""}
                . Each lease shows every value{"'"}s source and as-of date,
                and a value you enter by hand there is never changed
                automatically.
              </>
            ) : (
              <> Projections change as those numbers update.</>
            )}{" "}
            Generating a lease{"'"}s expected payments replaces its
            projection with the payment schedule.
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
                    {type === "government" && (fsaDirectShare || tenantRemitShare) ? (
                      <span className="block text-xs font-normal text-gray-500">
                        {fsaDirectShare && tenantRemitShare
                          ? "Part paid by FSA directly, part remitted by the tenant"
                          : fsaDirectShare
                            ? "Paid by FSA directly (not expected in tenant checks)"
                            : "Remitted by the tenant (expected each October)"}
                      </span>
                    ) : null}
                    {type === "government" && govInfoTotal > 0 ? (
                      <span className="block text-xs font-normal text-gray-500">
                        Base acres on your land generate approximately{" "}
                        {formatDollars(govInfoTotal)}/yr to your tenant
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

      {/* Selected year: by lease, each row opening its breakdown */}
      <section className="rounded-xl border border-gray-200 bg-white">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-200 px-4 py-3">
          <h2 className="text-base font-semibold text-gray-900">{selectedYear} by lease</h2>
          <p className="text-xs text-gray-500">Tap a lease to see how its number is figured.</p>
        </div>
        {leaseRows.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">
            No lease rent expected or received in {selectedYear}
            {filtering ? " for the selected entities" : ""}.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-2">Lease</th>
                  <th className="px-4 py-2">Basis</th>
                  <th className="px-4 py-2 text-right">Expected</th>
                  <th className="px-4 py-2 text-right">Received</th>
                  <th className="px-4 py-2 text-right">Outstanding</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {leaseRows.map((r) => (
                  <tr key={r.leaseId} className="group border-b border-gray-100 last:border-0 hover:bg-kelly-50/40">
                    <td className="px-4 py-2">
                      <Link
                        href={`/leases/${r.leaseId}/breakdown?year=${selectedYear}`}
                        className="font-medium text-gray-900 hover:underline"
                      >
                        {r.name}
                      </Link>
                      <p className="text-xs text-gray-500">
                        {[r.tenant, r.structure].filter(Boolean).join(" · ")}
                        {r.partial ? " · part of this lease is outside the selected entities" : ""}
                      </p>
                    </td>
                    <td className="px-4 py-2">
                      {r.incomplete ? (
                        <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">
                          Incomplete
                        </span>
                      ) : r.projection ? (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                          Projection
                        </span>
                      ) : r.expected > 0 ? (
                        <span className="rounded-full bg-kelly-50 px-2 py-0.5 text-[11px] font-medium text-pine-900">
                          Schedule
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">Received only</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatDollars(r.expectedScoped)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatDollars(r.receivedScoped)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatDollars(Math.max(r.expectedScoped - r.receivedScoped, 0))}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <Link
                        href={`/leases/${r.leaseId}/breakdown?year=${selectedYear}`}
                        aria-label={`How ${r.name} is figured`}
                        className="text-sm font-medium text-kelly-700 opacity-70 group-hover:opacity-100 hover:underline"
                      >
                        How &rarr;
                      </Link>
                    </td>
                  </tr>
                ))}
                {leaseRows.length > 1 ? (
                  <tr className="font-semibold text-gray-900">
                    <td className="px-4 py-2">All leases</td>
                    <td className="px-4 py-2"></td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatDollars(leaseTotals.expected)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatDollars(leaseTotals.received)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatDollars(Math.max(leaseTotals.expected - leaseTotals.received, 0))}
                    </td>
                    <td className="px-2 py-2"></td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Selected year: by property */}
      <section className="rounded-xl border border-gray-200 bg-white">
        <h2 className="border-b border-gray-200 px-4 py-3 text-base font-semibold text-gray-900">
          {selectedYear} by property
        </h2>
        {entityGroups.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">
            {filtering
              ? `No income recorded or projected for the selected entities in ${selectedYear}.`
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
