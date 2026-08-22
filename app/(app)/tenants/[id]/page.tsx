import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import { formatDollars } from "@/lib/format";
import { insuranceBadge } from "@/lib/insurance";
import { LEASE_STATUS_LABELS, type LeaseStatus } from "@/lib/leaseLogic";
import EntityDocuments from "@/components/documents/EntityDocuments";
import TenantFarmEntity, {
  type ConnectionEntities,
  type EntitySuggestion,
} from "@/components/tenants/TenantFarmEntity";
import { updateTenant, deleteTenant } from "../actions";

export const metadata = { title: "Tenant" };

const inputClass = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";

export default async function TenantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, profile } = await requireOrg();

  const [{ data: tenant }, { data: leases }, { data: connections }] = await Promise.all([
    supabase.from("tenants").select("*").eq("id", id).single(),
    supabase
      .from("leases")
      .select("id, name, lease_type, status, start_date, end_date")
      .eq("tenant_id", id)
      .order("start_date", { ascending: false }),
    supabase.from("farm_connections").select("id, label, entities").neq("status", "revoked").order("created_at"),
  ]);
  if (!tenant) notFound();

  const badge = insuranceBadge(tenant);

  // Farming entity suggestion: the tenant's leased land -> confirmed
  // field mappings on it -> the entities those fields belong to. One
  // non-null entity covering everything is worth a one-tap link.
  const connectionList: ConnectionEntities[] = (connections ?? []).map((c) => ({
    id: c.id,
    label: c.label,
    entities: Array.isArray(c.entities) ? (c.entities as ConnectionEntities["entities"]) : [],
  }));
  let suggestion: EntitySuggestion | null = null;
  const leaseIds = (leases ?? []).map((l) => l.id);
  if (!tenant.farm_connection_id && leaseIds.length > 0 && connectionList.length > 0) {
    const { data: lands } = await supabase
      .from("lease_lands")
      .select("property_id, field_id")
      .in("lease_id", leaseIds);
    const fieldIds = new Set((lands ?? []).map((l) => l.field_id).filter(Boolean) as string[]);
    const propertyIds = new Set((lands ?? []).filter((l) => !l.field_id).map((l) => l.property_id as string));
    if (fieldIds.size > 0 || propertyIds.size > 0) {
      const [{ data: mappings }, { data: fields }] = await Promise.all([
        supabase
          .from("field_mappings")
          .select("farm_connection_id, local_field_id, local_property_id, remote_entity_id, remote_entity_name")
          .eq("status", "confirmed"),
        supabase.from("fields").select("id, property_id"),
      ]);
      const fieldProperty = new Map((fields ?? []).map((f) => [f.id, f.property_id]));
      const seen = new Map<string, { connectionId: string; entityId: string | null; entityName: string | null }>();
      for (const m of mappings ?? []) {
        const onLand =
          (m.local_field_id && (fieldIds.has(m.local_field_id) || propertyIds.has(fieldProperty.get(m.local_field_id) ?? ""))) ||
          (m.local_property_id && propertyIds.has(m.local_property_id));
        if (!onLand) continue;
        const key = `${m.farm_connection_id}|${m.remote_entity_id ?? ""}`;
        seen.set(key, { connectionId: m.farm_connection_id, entityId: m.remote_entity_id, entityName: m.remote_entity_name });
      }
      if (seen.size === 1) {
        const only = [...seen.values()][0];
        const conn = connectionList.find((c) => c.id === only.connectionId);
        if (only.entityId && conn) {
          suggestion = {
            connectionId: conn.id,
            connectionLabel: conn.label,
            entityId: only.entityId,
            entityName: only.entityName ?? conn.entities.find((e) => e.id === only.entityId)?.name ?? "this entity",
          };
        }
      }
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <div>
        <Link href="/tenants" className="text-sm text-gray-500 hover:underline">
          &larr; Tenants
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-gray-900">{tenant.name}</h1>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.className}`}>
            {badge.label}
          </span>
        </div>
      </div>

      <form
        action={updateTenant}
        className="space-y-3 rounded-xl border border-gray-200 bg-white p-4"
      >
        <input type="hidden" name="id" value={tenant.id} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Name</label>
            <input name="name" defaultValue={tenant.name} required className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Contact person</label>
            <input name="contact_person" defaultValue={tenant.contact_person ?? ""} className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Phone</label>
            <input name="phone" defaultValue={tenant.phone ?? ""} className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Email</label>
            <input name="email" type="email" defaultValue={tenant.email ?? ""} className={inputClass} />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-gray-700">Mailing address</label>
            <textarea
              name="mailing_address"
              rows={2}
              defaultValue={tenant.mailing_address ?? ""}
              className={inputClass}
            />
          </div>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <input
                type="checkbox"
                name="insurance_on_file"
                defaultChecked={tenant.insurance_on_file}
                className="h-4 w-4 accent-kelly-500"
              />
              Insurance certificate on file
            </label>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Insurance expires
            </label>
            <input
              name="insurance_expires"
              type="date"
              defaultValue={tenant.insurance_expires ?? ""}
              className={inputClass}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-gray-700">Notes</label>
            <textarea name="notes" rows={2} defaultValue={tenant.notes ?? ""} className={inputClass} />
          </div>
        </div>
        <button
          type="submit"
          className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600"
        >
          Save changes
        </button>
      </form>

      <TenantFarmEntity
        tenantId={tenant.id}
        linked={
          tenant.farm_connection_id
            ? {
                connectionId: tenant.farm_connection_id,
                entityId: tenant.farm_entity_id ?? null,
                entityName: tenant.farm_entity_name ?? null,
              }
            : null
        }
        connections={connectionList}
        suggestion={suggestion}
      />

      <section>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">Leases</h2>
        {(leases ?? []).length === 0 ? (
          <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">
            No leases with this tenant yet.{" "}
            <Link href="/leases/new" className="font-medium text-kelly-700 hover:underline">
              Create one
            </Link>
            .
          </p>
        ) : (
          <ul className="space-y-2">
            {(leases ?? []).map((l) => (
              <li key={l.id} className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/leases/${l.id}`} className="font-medium text-gray-900 hover:underline">
                    {l.name}
                  </Link>
                  <span className="text-sm capitalize text-gray-500">{l.lease_type}</span>
                  <span className="ml-auto text-sm text-gray-500">
                    {l.start_date} to {l.end_date} ·{" "}
                    {LEASE_STATUS_LABELS[l.status as LeaseStatus] ?? l.status}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-lg font-semibold text-gray-900">
          Documents (insurance certificates, W-9s)
        </h2>
        <EntityDocuments
          orgId={profile.organization_id!}
          entityType="tenant"
          entityId={tenant.id}
        />
      </section>

      <section className="border-t border-gray-200 pt-4">
        <form action={deleteTenant}>
          <input type="hidden" name="id" value={tenant.id} />
          <button
            type="submit"
            className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
          >
            Delete tenant
          </button>
          <p className="mt-1 text-xs text-gray-500">
            Only possible when the tenant has no leases (delete or reassign those first).
          </p>
        </form>
      </section>
    </div>
  );
}
