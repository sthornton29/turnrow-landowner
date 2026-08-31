// Which farm connections and remote fields cover one lease's land. This
// is THE matching layer between a lease and the synced farm cache,
// extracted verbatim from the lease page so the post-sync drift
// recompute (lib/assumptionDriftSync.ts) and the page resolve the exact
// same rows. Pure; unit tested in leaseFarmScope.test.ts.

import type { TenantEntityRef } from "@/lib/leasePricing";

export interface LeaseFarmScope {
  // `${connection_id}|${remote_field_id}` for every mapped remote field
  // on this lease's land.
  keys: Set<string>;
  connectionIds: string[];
  scopedToEntity: boolean;
}

export interface ScopeMappingRow {
  farm_connection_id: string;
  remote_field_id: string;
  local_field_id: string | null;
  local_property_id: string | null;
  remote_entity_id?: string | null;
}

export function leaseFarmScope(args: {
  lands: Array<{ property_id: string; field_id: string | null }>;
  // Confirmed mappings only; the caller filters status.
  mappings: ScopeMappingRow[];
  // Local field id -> its property id (for whole-property land links).
  fieldPropertyById: Map<string, string>;
  // The lease tenant's farming entity, when linked (tenants.farm_*).
  tenantEntity: TenantEntityRef | null;
}): LeaseFarmScope {
  const { lands, mappings, fieldPropertyById, tenantEntity } = args;
  const keys = new Set<string>();
  const connectionIds = new Set<string>();
  const leasedFieldIds = new Set(lands.map((l) => l.field_id).filter(Boolean));
  const wholePropertyIds = new Set(
    lands.filter((l) => !l.field_id).map((l) => l.property_id)
  );
  const onLeaseMappings = mappings.filter((m) => {
    const mappedFieldProperty = m.local_field_id
      ? fieldPropertyById.get(m.local_field_id) ?? null
      : null;
    return Boolean(
      (m.local_field_id && leasedFieldIds.has(m.local_field_id)) ||
        (mappedFieldProperty && wholePropertyIds.has(mappedFieldProperty)) ||
        (m.local_property_id && wholePropertyIds.has(m.local_property_id))
    );
  });
  // The tenant IS a farming entity: when linked, only that entity's
  // fields on the lease land count. Fall back to every mapping on the
  // land when none carries an entity (a pre-entity farm API).
  const entityScoped = tenantEntity
    ? onLeaseMappings.filter(
        (m) =>
          m.farm_connection_id === tenantEntity.connectionId &&
          m.remote_entity_id === tenantEntity.entityId
      )
    : [];
  const chosen = entityScoped.length > 0 ? entityScoped : onLeaseMappings;
  for (const m of chosen) {
    keys.add(`${m.farm_connection_id}|${m.remote_field_id}`);
    connectionIds.add(m.farm_connection_id);
  }
  return {
    keys,
    connectionIds: Array.from(connectionIds),
    scopedToEntity: entityScoped.length > 0,
  };
}
