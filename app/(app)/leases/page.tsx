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
  const { supabase, profile } = await requireOrg();
  // Cosmetic gate only: creating org-structure records is admin work
  // (RLS enforces it; migration 0034).
  const isAdmin = profile.role === "admin";

  const [{ data: leases }, { data: tenants }, { data: lands }, { data: drift }] = await Promise.all([
    supabase
      .from("leases")
      .select("id, tenant_id, lease_type, name, status, start_date, end_date")
      .order("status")
      .order("end_date", { ascending: false }),
    supabase.from("tenants").select("id, name"),
    supabase.from("lease_lands").select("lease_id, leased_acres"),
    supabase.from("lease_assumption_drift").select("lease_id, is_final_price"),
  ]);

  const tenantName = new Map((tenants ?? []).map((t) => [t.id, t.name]));
  const acresByLease = new Map<string, number>();
  for (const l of lands ?? []) {
    acresByLease.set(l.lease_id, (acresByLease.get(l.lease_id) ?? 0) + (l.leased_acres ?? 0));
  }
  // Tenant-data drift chips: synced tenant numbers that differ from a
  // committed assumption (written after each sync; accepted per value).
  const driftByLease = new Map<string, { count: number; final: boolean }>();
  for (const d of (drift ?? []) as Array<{ lease_id: string; is_final_price: boolean }>) {
    const cur = driftByLease.get(d.lease_id) ?? { count: 0, final: false };
    driftByLease.set(d.lease_id, {
      count: cur.count + 1,
      final: cur.final || d.is_final_price,
    });
  }
  const driftTotal = (drift ?? []).length;

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
        {isAdmin ? (
          <Link
            href="/leases/new"
            className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600"
          >
            + New lease
          </Link>
        ) : null}
      </div>

      {driftTotal > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <span>
            {driftTotal} tenant data update{driftTotal === 1 ? "" : "s"} to
            review across your leases.
          </span>
          <Link
            href="/leases/updates"
            className="font-semibold text-kelly-700 hover:underline"
          >
            Review
          </Link>
        </div>
      ) : null}

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
                {driftByLease.has(l.id) ? (
                  <Link
                    href={`/leases/${l.id}#assumptions`}
                    className={
                      "rounded-full px-2 py-0.5 text-xs font-medium " +
                      (driftByLease.get(l.id)!.final
                        ? "bg-pine-800 text-white"
                        : "bg-amber-100 text-amber-800")
                    }
                    title="A synced tenant number differs from a saved assumption on this lease"
                  >
                    {driftByLease.get(l.id)!.final
                      ? "Final price available"
                      : "Newer tenant data"}
                  </Link>
                ) : null}
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
