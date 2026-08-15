import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { formatAcres } from "@/lib/format";
import { LEASE_STATUS_LABELS, type LeaseStatus } from "@/lib/leaseLogic";
import SectionTabs from "@/components/leases/SectionTabs";

export const metadata = { title: "Leases" };

const STATUS_CLASSES: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  active: "bg-kelly-50 text-pine-900",
  expired: "bg-amber-50 text-amber-800",
  terminated: "bg-red-50 text-red-700",
};

export default async function LeasesPage() {
  const { supabase } = await requireOrg();

  const [{ data: leases }, { data: tenants }, { data: lands }] = await Promise.all([
    supabase
      .from("leases")
      .select("id, tenant_id, lease_type, name, status, start_date, end_date")
      .order("status")
      .order("end_date", { ascending: false }),
    supabase.from("tenants").select("id, name"),
    supabase.from("lease_lands").select("lease_id, leased_acres"),
  ]);

  const tenantName = new Map((tenants ?? []).map((t) => [t.id, t.name]));
  const acresByLease = new Map<string, number>();
  for (const l of lands ?? []) {
    acresByLease.set(l.lease_id, (acresByLease.get(l.lease_id) ?? 0) + (l.leased_acres ?? 0));
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <SectionTabs active="/leases" />

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">
          Agricultural and hunting leases. Income shows on the{" "}
          <Link href="/income" className="font-medium text-kelly-700 hover:underline">
            Income page
          </Link>
          .
        </p>
        <Link
          href="/leases/new"
          className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600"
        >
          + New lease
        </Link>
      </div>

      {(leases ?? []).length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          No leases yet. Create one by uploading the lease document (the AI
          extracts the terms for your review) or by entering terms manually.
        </div>
      ) : (
        <ul className="space-y-2">
          {(leases ?? []).map((l) => (
            <li key={l.id} className="rounded-xl border border-gray-200 bg-white p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/leases/${l.id}`} className="font-medium text-gray-900 hover:underline">
                  {l.name}
                </Link>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium capitalize text-gray-600">
                  {l.lease_type}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[l.status] ?? ""}`}
                >
                  {LEASE_STATUS_LABELS[l.status as LeaseStatus] ?? l.status}
                </span>
                <span className="ml-auto text-sm text-gray-500">
                  {tenantName.get(l.tenant_id) ?? "Unknown tenant"}
                  {" · "}
                  {formatAcres(acresByLease.get(l.id) ?? 0)} ac
                  {l.start_date && l.end_date ? ` · ${l.start_date} to ${l.end_date}` : ""}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
