import type { FarmFieldDataRow, FieldMappingRow } from "@/lib/farmDisplay";

// Summary rollups for the Farm Data page: acres in crops, crop mix,
// harvest progress, and (where the tenant shares them) yields and
// prices, by entity, by tenant (the farming entity the farm data
// names, linked to a tenants row), and by property.
// Pure functions over rows already synced for ONE crop year, so the
// card totals are the same sums as the field table underneath them.

export interface RollupField {
  id: string;
  name: string;
  property_id: string | null;
}

export interface RollupProperty {
  id: string;
  name: string;
  entity_id: string | null;
}

export interface RollupEntity {
  id: string;
  name: string;
}

export interface RollupConnection {
  id: string;
  label: string;
  operation_name: string | null;
  scopes: { yields?: boolean; projected_yields?: boolean; projected_prices?: boolean } | null;
  // The share's farming entities (migration 0031; absent pre-entity).
  entities?: Array<{ id: string; name: string }> | null;
}

export interface ProjectedYieldRow {
  farm_connection_id: string;
  remote_field_id: string;
  crop: string;
  planted_acres: number | null;
  yield_per_acre: number | null;
  unit: string | null; // bu_per_ac | lbs_per_ac
  basis: string | null; // expected | actual
}

export interface PriceRow {
  farm_connection_id: string;
  crop: string;
  projected_avg_price: number | null;
  unit: string | null; // usd_per_bu | cents_per_lb
  is_final: boolean;
  // null = the whole operation; set = one farming entity's price.
  remote_entity_id?: string | null;
}

export interface CropAcres {
  crop: string;
  acres: number;
}

export interface CropYield {
  crop: string;
  yieldPerAcre: number | null;
  unit: string | null; // "bu/ac" | "lbs/ac"
  basis: "actual" | "projected" | null;
}

// A tenant as the farm data names it: the farming entity of one
// connection, or the whole operation when the farm API sends no
// entities. Linked to a tenants row by the sync (migration 0031).
export interface RollupTenant {
  id: string;
  name: string;
  farm_connection_id: string | null;
  farm_entity_id: string | null;
}

export interface CropPrice {
  crop: string;
  price: number;
  unit: string | null;
  isFinal: boolean;
  tenant: string; // operation name, for entities spanning connections
}

export interface Rollup {
  key: string;
  name: string;
  subtitle: string | null;
  plantedAcres: number;
  harvestedAcres: number;
  plantings: number;
  cropMix: CropAcres[];
  yieldByCrop: CropYield[];
  prices: CropPrice[];
  sharedYields: boolean;
  sharedPrices: boolean;
  propertyCount: number;
  unmappedAcres: number;
  connectionIds: string[];
  // Tenant rollups only: the tenants row the farming entity is linked
  // to (null when the sync has not created it yet), its connection,
  // and the farm-side entity id (null = the whole operation).
  tenantId: string | null;
  connectionId: string | null;
  remoteEntityId: string | null;
}

export interface RollupInput {
  plantings: FarmFieldDataRow[];
  mappings: FieldMappingRow[];
  fields: RollupField[];
  properties: RollupProperty[];
  entities: RollupEntity[];
  connections: RollupConnection[];
  projectedYields: ProjectedYieldRow[];
  prices: PriceRow[];
  // Optional for older callers and tests; names the tenant cards.
  tenants?: RollupTenant[];
}

export const NO_ENTITY_KEY = "none";

export interface ResolvedPlanting {
  row: FarmFieldDataRow;
  propertyId: string | null;
  entityKey: string; // entity id, or NO_ENTITY_KEY
}

export function tenantName(c: Pick<RollupConnection, "label" | "operation_name">): string {
  return (c.operation_name ?? "").trim() || c.label;
}

// Key of a tenant card: the connection, plus the farming entity when
// the farm data names one.
export function tenantKey(connectionId: string, remoteEntityId: string | null | undefined): string {
  return remoteEntityId ? `conn:${connectionId}|ent:${remoteEntityId}` : `conn:${connectionId}`;
}

export function parseTenantKey(key: string): { connectionId: string; remoteEntityId: string | null } | null {
  const m = /^conn:([^|]+)(?:\|ent:(.+))?$/.exec(key);
  return m ? { connectionId: m[1], remoteEntityId: m[2] ?? null } : null;
}

// The name a tenant card shows: the linked tenants row first (the
// owner may have renamed it), else the farm data's entity name, else
// the connection's entity list, else the operation.
export function tenantDisplayName(
  input: Pick<RollupInput, "tenants" | "connections" | "plantings">,
  connectionId: string,
  remoteEntityId: string | null
): { name: string; tenantId: string | null } {
  const linked = (input.tenants ?? []).find(
    (t) => t.farm_connection_id === connectionId && (t.farm_entity_id ?? null) === (remoteEntityId ?? null)
  );
  if (linked) return { name: linked.name, tenantId: linked.id };
  const c = input.connections.find((x) => x.id === connectionId);
  if (remoteEntityId) {
    const fromPlanting = input.plantings.find(
      (p) => p.farm_connection_id === connectionId && p.remote_entity_id === remoteEntityId && p.remote_entity_name
    )?.remote_entity_name;
    const fromList = c?.entities?.find((e) => e.id === remoteEntityId)?.name;
    return { name: fromPlanting ?? fromList ?? "Unnamed entity", tenantId: null };
  }
  return { name: c ? tenantName(c) : "Tenant", tenantId: null };
}

// Resolve each planting to its property (mapping -> local field ->
// property, else the mapping's whole-property target) and entity.
export function resolvePlantings(input: RollupInput): ResolvedPlanting[] {
  const fieldById = new Map(input.fields.map((f) => [f.id, f]));
  const propById = new Map(input.properties.map((p) => [p.id, p]));
  const mappingByKey = new Map(
    input.mappings.map((m) => [`${m.farm_connection_id}|${m.remote_field_id}`, m])
  );
  return input.plantings.map((row) => {
    const mapping = mappingByKey.get(`${row.farm_connection_id}|${row.remote_field_id}`) ?? null;
    const localField = mapping?.local_field_id ? fieldById.get(mapping.local_field_id) : null;
    const propertyId = localField?.property_id ?? mapping?.local_property_id ?? null;
    const entityId = propertyId ? (propById.get(propertyId)?.entity_id ?? null) : null;
    return { row, propertyId, entityKey: entityId ?? NO_ENTITY_KEY };
  });
}

const num = (v: number | string | null | undefined): number => {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function unitLabel(u: string | null | undefined): string | null {
  if (!u) return null;
  if (u === "lbs" || u === "lbs_per_ac") return "lbs/ac";
  if (u === "bu" || u === "bu_per_ac") return "bu/ac";
  return u;
}

// Build one rollup from a set of resolved plantings.
function build(
  key: string,
  name: string,
  subtitle: string | null,
  items: ResolvedPlanting[],
  input: RollupInput,
  opts: { countUnmapped: boolean; entityId?: string | null }
): Rollup {
  const connById = new Map(input.connections.map((c) => [c.id, c]));
  const rows = opts.countUnmapped ? items : items.filter((i) => i.propertyId !== null);
  let planted = 0;
  let harvested = 0;
  let unmapped = 0;
  const mix = new Map<string, number>();
  const props = new Set<string>();
  const conns = new Set<string>();
  for (const it of rows) {
    const a = num(it.row.planted_acres);
    planted += a;
    harvested += num(it.row.harvested_acres);
    if (it.propertyId) props.add(it.propertyId);
    else unmapped += a;
    conns.add(it.row.farm_connection_id);
    const crop = it.row.crop || "Unknown";
    mix.set(crop, (mix.get(crop) ?? 0) + a);
  }
  const cropMix = [...mix.entries()]
    .map(([crop, acres]) => ({ crop, acres }))
    .sort((x, y) => y.acres - x.acres || x.crop.localeCompare(y.crop));

  const involved = [...conns].map((id) => connById.get(id)).filter(Boolean) as RollupConnection[];
  const sharedYields = involved.some((c) => c.scopes?.yields || c.scopes?.projected_yields);
  const sharedPrices = involved.some((c) => c.scopes?.projected_prices);

  // Yields per crop: actual (acres-weighted production / harvested
  // acres) when any row carries production, else the tenant's
  // projected yields weighted by planted acres, else null.
  const projByKey = new Map(
    input.projectedYields.map((p) => [`${p.farm_connection_id}|${p.remote_field_id}|${p.crop}`, p])
  );
  const yieldByCrop: CropYield[] = cropMix.map(({ crop }) => {
    const cropRows = rows.filter((r) => (r.row.crop || "Unknown") === crop);
    let prodUnits = 0;
    let prodAcres = 0;
    let prodUnit: string | null = null;
    for (const r of cropRows) {
      if (r.row.production_units !== null && r.row.production_units !== undefined && num(r.row.harvested_acres) > 0) {
        prodUnits += num(r.row.production_units);
        prodAcres += num(r.row.harvested_acres);
        prodUnit = prodUnit ?? unitLabel(r.row.production_unit) ?? "bu/ac";
      }
    }
    if (prodAcres > 0) {
      return { crop, yieldPerAcre: prodUnits / prodAcres, unit: prodUnit, basis: "actual" };
    }
    let wSum = 0;
    let wAcres = 0;
    let pUnit: string | null = null;
    for (const r of cropRows) {
      const p = projByKey.get(`${r.row.farm_connection_id}|${r.row.remote_field_id}|${r.row.crop}`);
      if (!p || p.yield_per_acre === null || p.yield_per_acre === undefined) continue;
      const acres = num(p.planted_acres) || num(r.row.planted_acres);
      if (acres <= 0) continue;
      wSum += num(p.yield_per_acre) * acres;
      wAcres += acres;
      pUnit = pUnit ?? unitLabel(p.unit);
    }
    if (wAcres > 0) return { crop, yieldPerAcre: wSum / wAcres, unit: pUnit ?? "bu/ac", basis: "projected" };
    return { crop, yieldPerAcre: null, unit: null, basis: null };
  });

  const cropSet = new Set(cropMix.map((c) => c.crop));
  // Whole-operation prices for a plain rollup; an entity sub-rollup
  // takes that entity's rows instead.
  const wantEntity = opts.entityId ?? null;
  const prices: CropPrice[] = input.prices
    .filter((p) => (p.remote_entity_id ?? null) === wantEntity)
    .filter((p) => conns.has(p.farm_connection_id) && p.projected_avg_price !== null && cropSet.has(p.crop))
    .map((p) => ({
      crop: p.crop,
      price: num(p.projected_avg_price),
      unit: p.unit,
      isFinal: p.is_final,
      tenant: tenantName(connById.get(p.farm_connection_id) ?? { label: "Tenant", operation_name: null }),
    }))
    .sort((a, b) => a.crop.localeCompare(b.crop) || a.tenant.localeCompare(b.tenant));

  return {
    key,
    name,
    subtitle,
    plantedAcres: planted,
    harvestedAcres: harvested,
    plantings: rows.length,
    cropMix,
    yieldByCrop,
    prices,
    sharedYields,
    sharedPrices,
    propertyCount: props.size,
    unmappedAcres: unmapped,
    connectionIds: [...conns],
    tenantId: null,
    connectionId: null,
    remoteEntityId: null,
  };
}

export interface Rollups {
  byEntity: Rollup[];
  byTenant: Rollup[];
}

export function rollups(input: RollupInput): Rollups {
  const resolved = resolvePlantings(input);
  const entityName = new Map(input.entities.map((e) => [e.id, e.name]));

  const byEntityMap = new Map<string, ResolvedPlanting[]>();
  for (const r of resolved) {
    if (r.propertyId === null) continue; // unmapped: tenant only
    byEntityMap.set(r.entityKey, [...(byEntityMap.get(r.entityKey) ?? []), r]);
  }
  const entityOrder = [...input.entities.map((e) => e.id), NO_ENTITY_KEY];
  const byEntity = entityOrder
    .filter((k) => byEntityMap.has(k))
    .map((k) =>
      build(k, k === NO_ENTITY_KEY ? "No entity" : (entityName.get(k) ?? "Entity"), null, byEntityMap.get(k)!, input, {
        countUnmapped: false,
      })
    );

  // By tenant = by farming entity: one card per (connection, entity)
  // the farm data names, plus one per connection for plantings with no
  // entity (the whole operation on a pre-entity farm API). Order
  // follows the connection list, then acres.
  const byTenantMap = new Map<string, ResolvedPlanting[]>();
  for (const r of resolved) {
    const k = tenantKey(r.row.farm_connection_id, r.row.remote_entity_id ?? null);
    byTenantMap.set(k, [...(byTenantMap.get(k) ?? []), r]);
  }
  const byTenant: Rollup[] = [];
  for (const c of input.connections) {
    const cards = [...byTenantMap.entries()]
      .filter(([k]) => parseTenantKey(k)?.connectionId === c.id)
      .map(([k, items]) => {
        const parsed = parseTenantKey(k)!;
        const { name, tenantId } = tenantDisplayName(input, c.id, parsed.remoteEntityId);
        const subtitle = parsed.remoteEntityId && tenantName(c) !== name ? tenantName(c) : null;
        const r = build(k, name, subtitle, items, input, { countUnmapped: true, entityId: parsed.remoteEntityId });
        r.tenantId = tenantId;
        r.connectionId = c.id;
        r.remoteEntityId = parsed.remoteEntityId;
        return r;
      })
      .sort((a, b) => b.plantedAcres - a.plantedAcres || a.name.localeCompare(b.name));
    byTenant.push(...cards);
  }

  return { byEntity, byTenant };
}

// Per-property rows for the drill-in under one entity or one tenant
// (or everything when no filter is given). Unmapped plantings are not
// properties and are left out here.
export function propertyRollups(
  input: RollupInput,
  filter: { entityId?: string | null; connectionId?: string | null; remoteEntityId?: string | null } = {}
): Rollup[] {
  const resolved = resolvePlantings(input).filter((r) => {
    if (r.propertyId === null) return false;
    if (filter.entityId && r.entityKey !== filter.entityId) return false;
    if (filter.connectionId && r.row.farm_connection_id !== filter.connectionId) return false;
    if (filter.connectionId && filter.remoteEntityId !== undefined && (r.row.remote_entity_id ?? null) !== (filter.remoteEntityId ?? null)) return false;
    return true;
  });
  const propName = new Map(input.properties.map((p) => [p.id, p.name]));
  const byProp = new Map<string, ResolvedPlanting[]>();
  for (const r of resolved) byProp.set(r.propertyId!, [...(byProp.get(r.propertyId!) ?? []), r]);
  return [...byProp.entries()]
    .map(([id, items]) => build(id, propName.get(id) ?? "Property", null, items, input, { countUnmapped: false }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// One rollup for a single filter combination (the drill-in header card).
// remoteEntityId: undefined = any entity on the connection; null = the
// no-entity (whole operation) card; a string = that farming entity.
export function scopedRollup(
  input: RollupInput,
  filter: { entityId?: string | null; connectionId?: string | null; remoteEntityId?: string | null; propertyId?: string | null },
  name: string,
  subtitle: string | null = null
): Rollup {
  const resolved = resolvePlantings(input).filter((r) => {
    if (filter.entityId && r.entityKey !== filter.entityId) return false;
    if (filter.connectionId && r.row.farm_connection_id !== filter.connectionId) return false;
    if (filter.connectionId && filter.remoteEntityId !== undefined && (r.row.remote_entity_id ?? null) !== (filter.remoteEntityId ?? null)) return false;
    if (filter.propertyId && r.propertyId !== filter.propertyId) return false;
    return true;
  });
  // Entity and property scopes are land scopes: unmapped plantings do
  // not belong to them. A tenant scope alone keeps them (with the count).
  const countUnmapped = Boolean(filter.connectionId) && !filter.entityId && !filter.propertyId;
  const r = build("scoped", name, subtitle, resolved, input, {
    countUnmapped,
    entityId: filter.connectionId ? (filter.remoteEntityId ?? null) : null,
  });
  if (filter.connectionId) {
    r.connectionId = filter.connectionId;
    r.remoteEntityId = filter.remoteEntityId ?? null;
    r.tenantId = tenantDisplayName(input, filter.connectionId, filter.remoteEntityId ?? null).tenantId;
  }
  return r;
}
