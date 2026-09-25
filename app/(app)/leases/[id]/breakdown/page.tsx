import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import { formatAcres, formatDollars } from "@/lib/format";
import { govShareRows, loadIncomeInputs } from "@/lib/income";
import { explainLeaseYear } from "@/lib/leaseExplain";
import { isGovShareLabel, LEASE_STATUS_LABELS, type LeaseStatus } from "@/lib/leaseLogic";
import { ActionLink, SummaryHeader } from "@/components/summary/Summary";
import LeaseBreakdown from "@/components/leases/LeaseBreakdown";

export const metadata = { title: "How this rent is figured" };

// /leases/[id]/breakdown?year=YYYY: one lease-year's number, explained.
// Reads the same org-wide income inputs the Income page reads, so the
// figures here are the ones in its tables, then adds the lease's own
// schedule rows and payments for the actual-versus-expected view.
export default async function LeaseBreakdownPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ year?: string }>;
}) {
  const { id } = await params;
  const { year: yearParam } = await searchParams;
  const { supabase } = await requireOrg();

  const [{ data: lease }, inputs] = await Promise.all([
    supabase
      .from("leases")
      .select(
        "id, name, tenant_id, lease_type, rent_structure, status, terms, payment_schedule, start_date, end_date"
      )
      .eq("id", id)
      .single(),
    loadIncomeInputs(supabase),
  ]);
  if (!lease) notFound();

  const [{ data: tenant }, { data: lands }, { data: properties }, { data: expectedRows }, { data: payments }] =
    await Promise.all([
      supabase.from("tenants").select("id, name").eq("id", lease.tenant_id).single(),
      supabase.from("lease_lands").select("property_id, leased_acres").eq("lease_id", id),
      supabase.from("properties").select("id, name"),
      supabase
        .from("expected_payments")
        .select("id, year, label, due_date, expected_amount")
        .eq("lease_id", id),
      supabase
        .from("payments")
        .select("amount, received_date, expected_payment_id, memo")
        .eq("lease_id", id)
        .order("received_date"),
    ]);

  // Years worth offering: the lease's span plus anything dated outside it.
  const currentYear = new Date().getFullYear();
  const yearSet = new Set<number>();
  if (lease.start_date && lease.end_date) {
    for (let y = Number(lease.start_date.slice(0, 4)); y <= Number(lease.end_date.slice(0, 4)); y++) {
      yearSet.add(y);
    }
  }
  for (const r of expectedRows ?? []) yearSet.add(r.year);
  for (const p of payments ?? []) yearSet.add(Number(p.received_date.slice(0, 4)));
  if (yearSet.size === 0) yearSet.add(currentYear);
  const years = Array.from(yearSet).sort();
  const requested = Number(yearParam);
  const year = years.includes(requested)
    ? requested
    : years.includes(currentYear)
      ? currentYear
      : years[years.length - 1];

  const propertyName = new Map((properties ?? []).map((p) => [p.id, p.name]));
  const assumptions = inputs.assumptions.find((a) => a.lease_id === id && a.year === year)?.data;
  // Rent only: a tenant-remitted government share is matched to its own
  // expected row and counted under Government payments, as on the Income
  // page, so it is kept out of this lease's received.
  const govRowIds = new Set(
    (expectedRows ?? []).filter((r) => isGovShareLabel(r.label)).map((r) => r.id)
  );

  const x = explainLeaseYear({
    lease,
    year,
    lands: (lands ?? []).map((l) => ({
      propertyId: l.property_id,
      propertyName: propertyName.get(l.property_id) ?? "Property",
      leasedAcres: l.leased_acres,
    })),
    assumptions,
    expectedRows: (expectedRows ?? [])
      .filter((r) => r.year === year && !isGovShareLabel(r.label))
      .map((r) => ({ id: r.id, label: r.label ?? "", due_date: r.due_date, expected_amount: r.expected_amount })),
    payments: (payments ?? []).filter(
      (p) => !p.expected_payment_id || !govRowIds.has(p.expected_payment_id)
    ),
    gov: govShareRows(inputs, year).filter((r) => r.leaseId === id),
  });

  const dates =
    lease.start_date && lease.end_date
      ? `${lease.start_date} to ${lease.end_date}`
      : "No dates set";

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <SummaryHeader
        typeLabel="How this rent is figured"
        name={lease.name}
        keyFigure={`${formatDollars(x.expected)} expected in ${year}`}
        breadcrumb={[
          { href: `/income?year=${year}`, label: "Income" },
          { href: `/leases/${id}`, label: lease.name },
          { href: `/leases/${id}/breakdown?year=${year}`, label: `${year} breakdown` },
        ]}
        actions={
          <ActionLink href={`/leases/${id}`} primary>
            Open the lease
          </ActionLink>
        }
      >
        <p className="mt-1 text-sm text-gray-600">
          {x.structureLabel} · {tenant?.name ?? "Tenant"} · {dates} ·{" "}
          {formatAcres(x.totalAcres)} leased acres ·{" "}
          {LEASE_STATUS_LABELS[lease.status as LeaseStatus] ?? lease.status}
        </p>
        {years.length > 1 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {years.map((y) => (
              <Link
                key={y}
                href={`/leases/${id}/breakdown?year=${y}`}
                className={
                  "rounded-full px-3 py-1 text-sm font-medium " +
                  (y === year
                    ? "bg-kelly-500 text-white"
                    : "border border-gray-300 text-gray-700 hover:bg-gray-50")
                }
              >
                {y}
              </Link>
            ))}
          </div>
        ) : null}
      </SummaryHeader>

      <LeaseBreakdown x={x} leaseId={id} leaseName={lease.name} />
    </div>
  );
}
