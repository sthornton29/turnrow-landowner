// Tenant data flows into lease assumptions AUTOMATICALLY: after every
// sync this pass fills and refreshes each crop-share lease-year's
// assumption values from the synced cache, through the same matching
// layer and the same value semantics as the panel's Use buttons, so
// projections work with zero per-lease taps. The one rule that keeps it
// safe: A VALUE THE USER HAND-ENTERED OR HAND-EDITED IS NEVER TOUCHED
// (hand edits clear the provenance tag, and only empty or tenant-tagged
// values auto-fill/refresh). Provenance tags {kind, as_of} land on every
// auto-filled value, so the lease page and income wording can say
// exactly what rests on tenant projections.
//
// Crop rows: a year whose entries are ALL tenant-managed (every value
// empty or tagged, no shared expenses entered) also gets missing tenant
// crops added automatically; once the user hand-touches anything in a
// year, the year's crop LIST is theirs and only matched entries keep
// refreshing. Entries whose tenant row vanished keep their last values
// and as-of labels (never deleted).
//
// SERVICE-ROLE SAFE: the cron client bypasses RLS, so EVERY query here
// filters organization_id explicitly and never relies on a policy.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

import { matchCrop } from "@/lib/crops";
import { leaseFarmScope, type ScopeMappingRow } from "@/lib/leaseFarmScope";
import {
  cropAssumptions,
  normalizeCropEntries,
  type CropAssumption,
  type ValueSourceKind,
  type YearAssumptions,
} from "@/lib/leaseLogic";
import { buildTenantCropRows, type TenantCropRow } from "@/lib/tenantData";
import type { FarmFieldDataRow } from "@/lib/farmDisplay";
import type { ProjectedYieldRow, TenantPriceRow } from "@/lib/leasePricing";

export type AutoFillField = "acres" | "expected_yield" | "expected_price";
const FIELDS: AutoFillField[] = ["acres", "expected_yield", "expected_price"];
const EPSILON = 1e-9;

// What a Use fill would put in one field for one tenant row (mirrors
// fillFor in TenantDataPanel.tsx, including the price's own as-of
// beating the connection sync time and cents/lb arriving in dollars).
export function tenantFillFor(
  row: TenantCropRow,
  field: AutoFillField,
  syncedAt: string | null
): { value: number; kind: ValueSourceKind; asOf: string | null } | null {
  if (field === "acres") {
    if (!(row.plantedAcres > 0)) return null;
    return { value: row.plantedAcres, kind: "tenant_actual", asOf: syncedAt };
  }
  if (field === "expected_yield") {
    if (typeof row.yieldCell !== "object" || !row.yieldCell) return null;
    return {
      value: row.yieldCell.value,
      kind: row.yieldCell.basis === "actual" ? "tenant_actual" : "tenant_projected",
      asOf: syncedAt,
    };
  }
  if (typeof row.priceCell !== "object" || !row.priceCell) return null;
  return {
    value: row.priceCell.fillValue,
    kind: row.priceCell.isFinal ? "tenant_final" : "tenant_projected",
    asOf: row.priceCell.asOf ?? syncedAt,
  };
}

// An entry the auto-fill owns: every value empty or tenant-tagged and
// no hand-entered shared expenses. Hand-editing any value clears its
// tag (LeaseDetail.setEntry), which flips this false and freezes the
// year's crop list.
export function entryIsTenantManaged(e: CropAssumption): boolean {
  if (e.expected_shared_expenses != null) return false;
  return FIELDS.every((f) => e[f] == null || Boolean(e.sources?.[f]));
}

// Fill/refresh one year's entries from its tenant rows, in place on a
// copy. Returns the new entries and how many values changed. Pure;
// unit tested in tenantAutoFill.test.ts.
export function autoFillYearEntries(args: {
  entries: CropAssumption[];
  tenantRows: TenantCropRow[];
  syncedAt: string | null;
}): { entries: CropAssumption[]; filled: number } {
  const { tenantRows, syncedAt } = args;
  const entries = args.entries.map((e) => ({ ...e, sources: { ...(e.sources ?? {}) } }));
  const yearIsTenantManaged = entries.every(entryIsTenantManaged);
  let filled = 0;

  for (const row of tenantRows) {
    const crops = entries.map((e) => e.crop ?? null);
    const match = matchCrop(row.crop, crops);
    let entry = match
      ? entries.find(
          (e) => e.crop === match && (e.practice ?? "blended") === (row.practice ?? "blended")
        )
      : undefined;
    if (!entry) {
      // A tenant crop the year does not carry yet: add it only while
      // the whole year is still tenant-managed (a hand-curated year's
      // crop list belongs to the user).
      if (!yearIsTenantManaged) continue;
      entry = {
        crop: row.matchedLeaseCrop ?? row.crop,
        practice: row.practice ?? null,
        sources: {},
      };
      entries.push(entry);
    }
    for (const field of FIELDS) {
      const fill = tenantFillFor(row, field, syncedAt);
      if (!fill) continue; // nothing shared for this field: leave as is
      const tagged = Boolean(entry.sources?.[field]);
      if (entry[field] != null && !tagged) continue; // hand edits win, always
      const current = entry[field];
      const currentKind = entry.sources?.[field]?.kind ?? null;
      if (
        current != null &&
        Math.abs(current - fill.value) <= EPSILON &&
        currentKind === fill.kind
      ) {
        continue; // unchanged: keep the original as-of
      }
      entry[field] = fill.value;
      entry.sources = { ...(entry.sources ?? {}), [field]: { kind: fill.kind, as_of: fill.asOf } };
      filled++;
    }
  }
  return { entries, filled };
}

export async function autoFillTenantAssumptions(
  supabase: AnyClient,
  organizationId: string
): Promise<{ leases: number; values: number }> {
  const [leasesR, assumptionsR, landsR, mappingsR, tenantsR, fieldsR, connectionsR, farmDataR, yieldsR, pricesR] =
    await Promise.all([
      supabase
        .from("leases")
        .select("id, tenant_id, status, lease_type, rent_structure, start_date, end_date")
        .eq("organization_id", organizationId)
        .eq("lease_type", "agricultural")
        .eq("rent_structure", "crop_share")
        .in("status", ["draft", "active"]),
      supabase
        .from("lease_year_assumptions")
        .select("id, lease_id, year, data")
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
    ]);

  const leases = (leasesR.data ?? []) as Array<{
    id: string;
    tenant_id: string | null;
    start_date: string | null;
    end_date: string | null;
  }>;
  const assumptions = (assumptionsR.data ?? []) as Array<{
    id: string;
    lease_id: string;
    year: number;
    data: YearAssumptions | null;
  }>;
  const lands = (landsR.data ?? []) as Array<{ lease_id: string; property_id: string; field_id: string | null }>;
  const mappings = (mappingsR.data ?? []) as ScopeMappingRow[];
  const tenants = (tenantsR.data ?? []) as Array<{ id: string; farm_connection_id: string | null; farm_entity_id: string | null; farm_entity_name: string | null }>;
  const fields = (fieldsR.data ?? []) as Array<{ id: string; property_id: string }>;
  const connections = (connectionsR.data ?? []) as Array<{ id: string; scopes: Record<string, boolean> | null; last_synced_at: string | null }>;
  const farmData = (farmDataR.data ?? []) as FarmFieldDataRow[];
  const projectedYields = (yieldsR.data ?? []) as ProjectedYieldRow[];
  const prices = (pricesR.data ?? []) as TenantPriceRow[];

  const fieldPropertyById = new Map(fields.map((f) => [f.id, f.property_id]));
  const tenantById = new Map(tenants.map((t) => [t.id, t]));
  const landsByLease = new Map<string, Array<{ property_id: string; field_id: string | null }>>();
  for (const l of lands) {
    const list = landsByLease.get(l.lease_id) ?? [];
    list.push({ property_id: l.property_id, field_id: l.field_id });
    landsByLease.set(l.lease_id, list);
  }
  const assumptionByLeaseYear = new Map<string, { id: string; data: YearAssumptions | null }>();
  for (const a of assumptions) {
    assumptionByLeaseYear.set(`${a.lease_id}|${a.year}`, { id: a.id, data: a.data });
  }
  const yieldsScope = new Set(connections.filter((c) => c.scopes?.yields).map((c) => c.id));
  const projectedYieldScope = new Set(connections.filter((c) => c.scopes?.projected_yields).map((c) => c.id));
  const priceScope = new Set(connections.filter((c) => c.scopes?.projected_prices).map((c) => c.id));
  const syncedAtOf = new Map(connections.map((c) => [c.id, c.last_synced_at]));

  let leasesTouched = 0;
  let valuesFilled = 0;

  for (const lease of leases) {
    const startYear = Number((lease.start_date ?? "").slice(0, 4));
    const endYear = Number((lease.end_date ?? "").slice(0, 4));
    if (!startYear || !endYear || endYear < startYear || endYear - startYear > 50) continue;

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
    if (scope.connectionIds.length === 0) continue;
    const syncedAt =
      scope.connectionIds
        .map((id) => syncedAtOf.get(id))
        .filter(Boolean)
        .sort()
        .pop() ?? null;

    let leaseTouched = false;
    for (let year = startYear; year <= endYear; year++) {
      const existing = assumptionByLeaseYear.get(`${lease.id}|${year}`) ?? null;
      const before = cropAssumptions(existing?.data);
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
        leaseCrops: before.map((e) => e.crop ?? null),
        tenantEntity,
      });
      if (tenantRows.length === 0) continue;

      const { entries, filled } = autoFillYearEntries({
        entries: before,
        tenantRows,
        syncedAt: syncedAt as string | null,
      });
      if (filled === 0) continue;

      const nextData: YearAssumptions = {
        ...(existing?.data?.bonus_estimate != null
          ? { bonus_estimate: existing.data.bonus_estimate }
          : {}),
        crops: normalizeCropEntries(entries),
      };
      if (existing) {
        const { error } = await supabase
          .from("lease_year_assumptions")
          .update({ data: nextData })
          .eq("id", existing.id)
          .eq("organization_id", organizationId);
        if (error) throw new Error(`Auto-filling assumptions failed: ${error.message}`);
      } else {
        const { error } = await supabase.from("lease_year_assumptions").insert({
          organization_id: organizationId,
          lease_id: lease.id,
          year,
          data: nextData,
        });
        if (error) throw new Error(`Auto-filling assumptions failed: ${error.message}`);
      }
      valuesFilled += filled;
      leaseTouched = true;
    }
    if (leaseTouched) leasesTouched++;
  }

  return { leases: leasesTouched, values: valuesFilled };
}
