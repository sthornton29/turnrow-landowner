import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import SectionTabs from "@/components/leases/SectionTabs";
import DriftReview from "@/components/leases/DriftReview";
import type { DriftRow } from "@/lib/acceptDrift";

export const metadata = { title: "Tenant data updates" };

// Org-wide review of tenant-data drift: every committed assumption whose
// synced tenant number moved, across all leases, with per-value and
// per-lease accept. Each acceptance is an explicit press; nothing here
// runs on its own.
export default async function LeaseUpdatesPage() {
  const { supabase } = await requireOrg();
  const [{ data: drift }, { data: leases }, { data: tenants }] = await Promise.all([
    supabase
      .from("lease_assumption_drift")
      .select("*")
      .order("detected_at", { ascending: false }),
    supabase.from("leases").select("id, name, tenant_id"),
    supabase.from("tenants").select("id, name"),
  ]);

  const tenantName = new Map((tenants ?? []).map((t) => [t.id, t.name]));
  const leaseById = new Map(
    ((leases ?? []) as Array<{ id: string; name: string; tenant_id: string | null }>).map((l) => [
      l.id,
      { name: l.name, tenant: l.tenant_id ? tenantName.get(l.tenant_id) ?? null : null },
    ])
  );

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <SectionTabs active="/leases" />
      <div>
        <p className="text-sm text-gray-500">
          <Link href="/leases" className="hover:underline">
            &larr; Leases
          </Link>
        </p>
        <h1 className="mt-1 text-xl font-semibold text-gray-900">
          Review tenant data updates
        </h1>
        <p className="mt-0.5 text-sm text-gray-600">
          Values you saved from tenant data whose synced number has since
          changed. Accepting updates the saved assumption and its source tag
          immediately, the same as pressing Use and Save on the lease page.
        </p>
      </div>
      <DriftReview
        initialRows={(drift ?? []) as DriftRow[]}
        leaseInfo={Object.fromEntries(leaseById)}
      />
    </div>
  );
}
