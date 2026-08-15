import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { formatNumber } from "@/lib/format";
import { insuranceBadge } from "@/lib/insurance";
import SectionTabs from "@/components/leases/SectionTabs";
import { createTenant } from "./actions";

export const metadata = { title: "Tenants" };

export default async function TenantsPage() {
  const { supabase } = await requireOrg();

  const [{ data: tenants }, { data: leases }] = await Promise.all([
    supabase
      .from("tenants")
      .select("id, name, contact_person, phone, email, insurance_on_file, insurance_expires")
      .order("name"),
    supabase.from("leases").select("id, tenant_id, status"),
  ]);

  const leaseCount = new Map<string, number>();
  for (const l of leases ?? []) {
    if (l.status === "active") {
      leaseCount.set(l.tenant_id, (leaseCount.get(l.tenant_id) ?? 0) + 1);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <SectionTabs active="/tenants" />

      <details className="rounded-xl border border-gray-200 bg-white">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-kelly-700">
          + New tenant
        </summary>
        <form action={createTenant} className="flex flex-wrap gap-2 px-4 pb-4">
          <input
            name="name"
            required
            placeholder="Name (person or entity)"
            className="min-w-48 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <input
            name="contact_person"
            placeholder="Contact person"
            className="w-44 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <input
            name="phone"
            placeholder="Phone"
            className="w-36 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <input
            name="email"
            type="email"
            placeholder="Email"
            className="w-52 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600"
          >
            Create
          </button>
        </form>
      </details>

      {(tenants ?? []).length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          No tenants yet. Add the people or entities who lease your land.
        </div>
      ) : (
        <ul className="space-y-2">
          {(tenants ?? []).map((t) => {
            const badge = insuranceBadge(t);
            return (
              <li key={t.id} className="rounded-xl border border-gray-200 bg-white p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/tenants/${t.id}`}
                    className="font-medium text-gray-900 hover:underline"
                  >
                    {t.name}
                  </Link>
                  <span className="text-sm text-gray-500">
                    {[t.contact_person, t.phone, t.email].filter(Boolean).join(" · ")}
                  </span>
                  <span className="ml-auto flex items-center gap-2">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.className}`}>
                      {badge.label}
                    </span>
                    <span className="text-sm text-gray-500">
                      {formatNumber(leaseCount.get(t.id) ?? 0)} active lease
                      {(leaseCount.get(t.id) ?? 0) === 1 ? "" : "s"}
                    </span>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
