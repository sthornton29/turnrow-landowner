// Post-sync tenant-data drift recompute for one organization: compare
// every committed, tenant-sourced assumption value against what the Use
// helper would fill from the freshly synced cache, and reconcile the
// lease_assumption_drift table (upsert changed, delete stale). Runs
// after every sync (cron, manual, connect) from lib/farmSync.ts, and the
// lease page reconciles its own lease-year on every assumption save so
// accepting or hand-editing clears a flag immediately.
//
// SERVICE-ROLE SAFE: the cron client bypasses RLS, so EVERY query here
// filters organization_id explicitly and never relies on a policy.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

import {
  computeLeaseYearDrift,
  driftKey,
  type ComputedDrift,
} from "@/lib/assumptionDrift";
import { leaseFarmScope, type ScopeMappingRow } from "@/lib/leaseFarmScope";
import { cropAssumptions, type YearAssumptions } from "@/lib/leaseLogic";
import { buildTenantCropRows } from "@/lib/tenantData";
import type { FarmFieldDataRow } from "@/lib/farmDisplay";
import type { ProjectedYieldRow, TenantPriceRow } from "@/lib/leasePricing";

interface DriftDbRow extends ComputedDrift {
  id: string;
}

export async function recomputeOrgDrift(
  supabase: AnyClient,
  organizationId: string
): Promise<{ leases: number; rows: number }> {
  const [leasesR, assumptionsR, landsR, mappingsR, tenantsR, fieldsR, connectionsR, farmDataR, yieldsR, pricesR, existingR] =
    await Promise.all([
      supabase
        .from("leases")
        .select("id, tenant_id, status")
        .eq("organization_id", organizationId)
        .in("status", ["draft", "active"]),
      supabase
        .from("lease_year_assumptions")
        .select("lease_id, year, data")
        .eq("organization_id", organizationId),
      supabase
        .from("lease_lands")
        .select("lease_id, property_id, field_id")
        .eq("organization_id", organizationId),
      supabase
        .from("field_mappings")
        .select("farm_connection_id, remote_field_id, local_field_id, local_property_id, remote_entity_id")
        .eq("organization_id", organizationId)
        .eq("status", "confirmed"),
      supabase
        .from("tenants")
        .select("id, farm_connection_id, farm_entity_id, farm_entity_name")
        .eq("organization_id", organizationId),
      supabase
        .from("fields")
        .select("id, property_id")
        .eq("organization_id", organizationId),
      supabase
        .from("farm_connections")
        .select("id, scopes, last_synced_at")
        .eq("organization_id", organizationId),
      supabase.from("farm_field_data").select("*").eq("organization_id", organizationId),
      supabase.from("farm_projected_yields").select("*").eq("organization_id", organizationId),
      supabase.from("farm_marketing_prices").select("*").eq("organization_id", organizationId),
      supabase
        .from("lease_assumption_drift")
        .select("id, lease_id, year, crop, practice, field, committed_value, tenant_value, tenant_kind, tenant_as_of, is_final_price, farm_connection_id")
        .eq("organization_id", organizationId),
    ]);
  const leases = (leasesR.data ?? []) as Array<{ id: string; tenant_id: string | null; status: string }>;
  const assumptions = (assumptionsR.data ?? []) as Array<{ lease_id: string; year: number; data: YearAssumptions | null }>;
  const lands = (landsR.data ?? []) as Array<{ lease_id: string; property_id: string; field_id: string | null }>;
  const mappings = (mappingsR.data ?? []) as ScopeMappingRow[];
  const tenants = (tenantsR.data ?? []) as Array<{ id: string; farm_connection_id: string | null; farm_entity_id: string | null; farm_entity_name: string | null }>;
  const fields = (fieldsR.data ?? []) as Array<{ id: string; property_id: string }>;
  const connections = (connectionsR.data ?? []) as Array<{ id: string; scopes: Record<string, boolean> | null; last_synced_at: string | null }>;
  const farmData = (farmDataR.data ?? []) as FarmFieldDataRow[];
  const projectedYields = (yieldsR.data ?? []) as ProjectedYieldRow[];
  const prices = (pricesR.data ?? []) as TenantPriceRow[];
  const existing = (existingR.data ?? []) as DriftDbRow[];

  const fieldPropertyById = new Map(fields.map((f) => [f.id, f.property_id]));
  const tenantById = new Map(tenants.map((t) => [t.id, t]));
  const landsByLease = new Map<string, Array<{ property_id: string; field_id: string | null }>>();
  for (const l of lands) {
    const list = landsByLease.get(l.lease_id) ?? [];
    list.push({ property_id: l.property_id, field_id: l.field_id });
    landsByLease.set(l.lease_id, list);
  }
  const assumptionsByLease = new Map<string, Array<{ year: number; data: YearAssumptions | null }>>();
  for (const a of assumptions) {
    const list = assumptionsByLease.get(a.lease_id) ?? [];
    list.push({ year: a.year, data: a.data });
    assumptionsByLease.set(a.lease_id, list);
  }
  const yieldsScope = new Set(connections.filter((c) => c.scopes?.yields).map((c) => c.id));
  const projectedYieldScope = new Set(connections.filter((c) => c.scopes?.projected_yields).map((c) => c.id));
  const priceScope = new Set(connections.filter((c) => c.scopes?.projected_prices).map((c) => c.id));
  const syncedAtOf = new Map(connections.map((c) => [c.id, c.last_synced_at]));

  const desired = new Map<string, ComputedDrift>();
  let leasesTouched = 0;

  for (const lease of leases) {
    const leaseAssumptions = assumptionsByLease.get(lease.id) ?? [];
    // Only committed tenant-sourced values can drift; skip fast when
    // the lease has none.
    const taggedYears = leaseAssumptions.filter(({ data }) =>
      cropAssumptions(data).some(
        (e) => e.sources && (e.sources.acres || e.sources.expected_yield || e.sources.expected_price)
      )
    );
    if (taggedYears.length === 0) continue;

    const tenant = lease.tenant_id ? tenantById.get(lease.tenant_id) : null;
    const tenantEntity =
      tenant?.farm_connection_id && tenant.farm_entity_id
        ? {
            connectionId: tenant.farm_connection_id,
            entityId: tenant.farm_entity_id,
            entityName: tenant.farm_entity_name ?? null,
          }
        : null;
    const scope = leaseFarmScope({
      lands: landsByLease.get(lease.id) ?? [],
      mappings,
      fieldPropertyById,
      tenantEntity,
    });
    if (scope.connectionIds.length === 0) continue; // no cache: no drift

    const syncedAt =
      scope.connectionIds
        .map((id) => syncedAtOf.get(id))
        .filter(Boolean)
        .sort()
        .pop() ?? null;

    let touched = false;
    for (const { year, data } of taggedYears) {
      const savedEntries = cropAssumptions(data);
      const tenantRows = buildTenantCropRows({
        farmData,
        projectedYields,
        prices,
        relevantKeys: scope.keys,
        relevantConnectionIds: scope.connectionIds,
        yieldsScope,
        projectedYieldScope,
        priceScope,
        year,
        leaseCrops: savedEntries.map((e) => e.crop ?? null),
        tenantEntity,
      });
      const drift = computeLeaseYearDrift({
        leaseId: lease.id,
        year,
        savedEntries,
        tenantRows,
        connectionId: scope.connectionIds[0] ?? null,
        syncedAt: syncedAt as string | null,
      });
      for (const d of drift) {
        desired.set(driftKey(d), d);
        touched = true;
      }
    }
    if (touched) leasesTouched++;
  }

  // Reconcile: upsert new/changed rows, delete stale ones. Unchanged
  // rows are skipped so detected_at stays the honest first-seen time.
  const existingByKey = new Map(existing.map((r) => [driftKey(r), r]));
  const toUpsert: Array<Record<string, unknown>> = [];
  for (const [key, d] of desired) {
    const prior = existingByKey.get(key);
    const changed =
      !prior ||
      Math.abs(prior.committed_value - d.committed_value) > 1e-9 ||
      Math.abs(prior.tenant_value - d.tenant_value) > 1e-9 ||
      prior.tenant_kind !== d.tenant_kind ||
      (prior.tenant_as_of ?? null) !== (d.tenant_as_of ?? null) ||
      prior.is_final_price !== d.is_final_price;
    if (!changed) continue;
    toUpsert.push({
      organization_id: organizationId,
      ...d,
      detected_at: new Date().toISOString(),
    });
  }
  if (toUpsert.length > 0) {
    const { error } = await supabase
      .from("lease_assumption_drift")
      .upsert(toUpsert, { onConflict: "lease_id,year,crop,practice,field" });
    if (error) throw new Error(`Saving drift rows failed: ${error.message}`);
  }
  const staleIds = existing.filter((r) => !desired.has(driftKey(r))).map((r) => r.id);
  if (staleIds.length > 0) {
    const { error } = await supabase
      .from("lease_assumption_drift")
      .delete()
      .eq("organization_id", organizationId)
      .in("id", staleIds);
    if (error) throw new Error(`Clearing stale drift rows failed: ${error.message}`);
  }

  return { leases: leasesTouched, rows: desired.size };
}
