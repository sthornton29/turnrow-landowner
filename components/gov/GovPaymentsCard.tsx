import Link from "next/link";
import { formatAcres, formatDollars } from "@/lib/format";
import { COMMODITY_LABELS } from "@/lib/gov/govPayments";
import { loadGovInputs, projectForPaymentYear } from "@/lib/gov/govData";

// Base acres and the projected ARC/PLC payment for the current payment
// year, for one property or one entity (its properties). Server
// component; renders nothing when no FSA farm is linked to the land.
export default async function GovPaymentsCard({
  supabase,
  propertyIds,
  title = "Base acres and government payments",
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  propertyIds: string[];
  title?: string;
}) {
  if (propertyIds.length === 0) return null;
  const gov = await loadGovInputs(supabase);
  const linked = gov.links.some((l) => propertyIds.includes(l.property_id));
  if (!linked) return null;
  const paymentYear = new Date().getFullYear();
  const projection = projectForPaymentYear(gov, paymentYear);
  const acresByCommodity = new Map<string, number>();
  let net = 0;
  for (const pid of propertyIds) {
    net += projection.netByProperty.get(pid) ?? 0;
    for (const [c, a] of projection.baseAcresByProperty.get(pid) ?? []) {
      acresByCommodity.set(c, (acresByCommodity.get(c) ?? 0) + a);
    }
  }
  if (acresByCommodity.size === 0) return null;
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{title}</h2>
        <Link href={`/gov-payments?year=${paymentYear}`} className="text-sm font-medium text-kelly-700 hover:underline">
          Government Payments
        </Link>
      </div>
      <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        {Array.from(acresByCommodity.entries()).map(([c, a]) => (
          <div key={c} className="flex justify-between gap-3">
            <dt className="text-gray-500">{COMMODITY_LABELS[c as keyof typeof COMMODITY_LABELS] ?? c} base</dt>
            <dd className="font-medium text-gray-900">{formatAcres(a)} ac</dd>
          </div>
        ))}
        <div className="flex justify-between gap-3 sm:col-span-2">
          <dt className="text-gray-500">
            Projected ARC/PLC, {projection.programYear} program year (paid Oct {paymentYear})
          </dt>
          <dd className="font-semibold text-pine-900">{formatDollars(Math.round(net * 100) / 100)}</dd>
        </div>
      </dl>
      <p className="mt-1 text-xs text-gray-500">
        Estimate for the base acres on this land; it goes to whoever farms it unless a lease gives you a share.
      </p>
    </section>
  );
}
