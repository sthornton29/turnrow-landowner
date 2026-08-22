import type { FarmFieldDataRow, FieldMappingRow } from "@/lib/farmDisplay";

// Summary rollups for the Farm Data page: acres in crops, crop mix,
// harvest progress, and (where the tenant shares them) yields and
// prices, by entity, by tenant (farm connection), and by property.
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
  // Tenant rollups only: one sub-rollup per farming entity when the
  // connection's plantings span more than one; null otherwise.
  entityBreakdown: Rollup[] | null;
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
    entityBreakdown: null,
  };
}

// Sub-rollups per farming entity for one connection's plantings, only
// when more than one distinct entity is present. Plantings without an
// entity form an "Unassigned" sub-rollup beside the named ones.
function entityBreakdownFor(
  connection: RollupConnection,
  items: ResolvedPlanting[],
  input: RollupInput
): Rollup[] | null {
  const ids = new Set(items.map((i) => i.row.remote_entity_id).filter((x): x is string => !!x));
  if (ids.size < 2) return null;
  const nameOf = (id: string): string =>
    items.find((i) => i.row.remote_entity_id === id && i.row.remote_entity_name)?.row.remote_entity_name ??
    connection.entities?.find((e) => e.id === id)?.name ??
    "Unnamed entity";
  const groups = new Map<string, ResolvedPlanting[]>();
  for (const it of items) {
    const k = it.row.remote_entity_id ?? "";
    groups.set(k, [...(groups.get(k) ?? []), it]);
  }
  const out = [...groups.entries()]
    .map(([id, list]) =>
      build(id || "unassigned", id ? nameOf(id) : "Unassigned", null, list, input, { countUnmapped: true, entityId: id || null })
    )
    .sort((a, b) => (a.key === "unassigned" ? 1 : 0) - (b.key === "unassigned" ? 1 : 0) || b.plantedAcres - a.plantedAcres);
  // An Unassigned sub-rollup would otherwise carry the whole-operation
  // prices as if they were its own.
  for (const r of out) if (r.key === "unassigned") r.prices = [];
  return out;
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

  const byTenantMap = new Map<string, ResolvedPlanting[]>();
  for (const r of resolved) {
    const k = r.row.farm_connection_id;
    byTenantMap.set(k, [...(byTenantMap.get(k) ?? []), r]);
  }
  const byTenant = input.connections
    .filter((c) => byTenantMap.has(c.id))
    .map((c) => {
      const items = byTenantMap.get(c.id)!;
      const r = build(c.id, tenantName(c), null, items, input, { countUnmapped: true });
      r.entityBreakdown = entityBreakdownFor(c, items, input);
      return r;
    });

  return { byEntity, byTenant };
}

// Per-property rows for the drill-in under one entity or one tenant
// (or everything when no filter is given). Unmapped plantings are not
// properties and are left out here.
export function propertyRollups(
  input: RollupInput,
  filter: { entityId?: string | null; connectionId?: string | null } = {}
): Rollup[] {
  const resolved = resolvePlantings(input).filter((r) => {
    if (r.propertyId === null) return false;
    if (filter.entityId && r.entityKey !== filter.entityId) return false;
    if (filter.connectionId && r.row.farm_connection_id !== filter.connectionId) return false;
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
export function scopedRollup(
  input: RollupInput,
  filter: { entityId?: string | null; connectionId?: string | null; propertyId?: string | null },
  name: string,
  subtitle: string | null = null
): Rollup {
  const resolved = resolvePlantings(input).filter((r) => {
    if (filter.entityId && r.entityKey !== filter.entityId) return false;
    if (filter.connectionId && r.row.farm_connection_id !== filter.connectionId) return false;
    if (filter.propertyId && r.propertyId !== filter.propertyId) return false;
    return true;
  });
  // Entity and property scopes are land scopes: unmapped plantings do
  // not belong to them. A tenant scope alone keeps them (with the count).
  const countUnmapped = Boolean(filter.connectionId) && !filter.entityId && !filter.propertyId;
  const r = build("scoped", name, subtitle, resolved, input, { countUnmapped });
  if (filter.connectionId && !filter.entityId && !filter.propertyId) {
    const c = input.connections.find((x) => x.id === filter.connectionId);
    if (c) r.entityBreakdown = entityBreakdownFor(c, resolved, input);
  }
  return r;
}
