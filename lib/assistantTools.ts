// "Ask about your land": the data assistant's curated tools.
//
// TENANT ISOLATION IS POSTGRES RLS, NOT PROMPT LANGUAGE. Every tool runs
// its reads through the USER'S OWN session client (their JWT via
// lib/supabase/server), never the service role, so the
// organization_id = private.user_org_id() policies filter every row
// before any engine sees it. Another organization's data simply does not
// exist here.
//
// The curated tools reuse the SAME lib engines the pages run (income
// summaries, tax status, timber allocation, easement catalog), so the
// assistant's numbers match the screens. run_sql covers the long tail
// through the assistant_query() RPC (SECURITY INVOKER, read-only, capped).

import { loadGovInputs, projectForPaymentYear } from "@/lib/gov/govData";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Anthropic from "@anthropic-ai/sdk";
import { formatAcres, formatDollars, formatNumber } from "@/lib/format";
import {
  allocateToProperties,
  loadIncomeInputs,
  summarizeByYear,
  UNASSIGNED,
  type IncomeType,
} from "@/lib/income";
import { taxStatus, type TaxStatus } from "@/lib/tax";
import { STAND_TYPE_LABELS, ASSET_TYPES } from "@/lib/assetTypes";
import {
  EASEMENT_CATEGORY_LABELS,
  easementCategory,
  easementTypeLabel,
  EASEMENT_RELATIONSHIP_LABELS,
} from "@/lib/easements";
import { guardSql } from "@/lib/assistantSql";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

export interface ToolResult {
  // Plain-language description of what was consulted, for the answer to
  // cite ("across your 3 properties in Lawrence County").
  sources: string[];
  [key: string]: unknown;
}

type ToolImpl = (supabase: Client, input: Record<string, unknown>) => Promise<ToolResult>;

// ---------------------------------------------------------------- helpers

async function all<T>(
  q: PromiseLike<{ data: unknown; error: { message: string } | null }>
): Promise<T[]> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data as unknown) as T[]) ?? [];
}

const num = (v: unknown) => Number(v) || 0;
export const r1 = (v: number) => Math.round(v * 10) / 10;
export const r2 = (v: number) => Math.round(v * 100) / 100;

// "3 properties in Lawrence County" / "2 properties in Lawrence and
// Colbert counties". Pure; unit-tested.
export function describeProperties(
  props: Array<{ county: string | null; state?: string | null }>
): string {
  if (props.length === 0) return "no properties yet";
  const counties = Array.from(
    new Set(props.map((p) => (p.county ?? "").trim()).filter(Boolean))
  );
  const n = `${props.length} propert${props.length === 1 ? "y" : "ies"}`;
  if (counties.length === 0) return n;
  if (counties.length === 1) return `${n} in ${counties[0]} County`;
  if (counties.length === 2) return `${n} in ${counties[0]} and ${counties[1]} counties`;
  return `${n} across ${counties.length} counties`;
}

// Tax status with the same rule as the Property Taxes page. Pure.
export function statusCounts(
  statements: Array<{ id: string; amount_due: number; delinquent_date: string | null }>,
  paidByStatement: Map<string, number>,
  today = new Date()
): Record<TaxStatus, number> {
  const out: Record<TaxStatus, number> = { paid: 0, partial: 0, unpaid: 0, delinquent: 0 };
  for (const s of statements) {
    out[taxStatus(s, paidByStatement.get(s.id) ?? 0, today)] += 1;
  }
  return out;
}

type PropertyRow = {
  id: string;
  name: string;
  county: string | null;
  state: string | null;
  acres: number | null;
  entity_id: string | null;
};

async function fetchProperties(supabase: Client): Promise<PropertyRow[]> {
  return all<PropertyRow>(
    supabase.from("properties_geo").select("id, name, county, state, acres, entity_id").order("name")
  );
}

async function fetchEntities(supabase: Client) {
  return all<{ id: string; name: string; entity_type: string | null }>(
    supabase.from("entities").select("id, name, entity_type").order("name")
  );
}

// ---------------------------------------------------------------- tools

const listProperties: ToolImpl = async (supabase) => {
  const [props, entities] = await Promise.all([fetchProperties(supabase), fetchEntities(supabase)]);
  const entityName = new Map(entities.map((e) => [e.id, e.name]));
  return {
    sources: [describeProperties(props)],
    properties: props.map((p) => ({
      id: p.id,
      name: p.name,
      county: p.county,
      state: p.state,
      acres: p.acres === null ? null : r1(num(p.acres)),
      entity: p.entity_id ? (entityName.get(p.entity_id) ?? null) : null,
    })),
    entities: entities.map((e) => ({ id: e.id, name: e.name, entity_type: e.entity_type })),
  };
};

const landSummary: ToolImpl = async (supabase, input) => {
  const county = typeof input.county === "string" ? input.county.trim().toLowerCase() : null;
  const entityFilter = typeof input.entity === "string" ? input.entity.trim().toLowerCase() : null;
  const [props, entities, fields, pastures, wetlands, stands, parcels] = await Promise.all([
    fetchProperties(supabase),
    fetchEntities(supabase),
    all<{ id: string; property_id: string; acres: number | null; irrigated_acres: number | null }>(
      supabase.from("fields").select("id, property_id, acres, irrigated_acres")
    ),
    all<{ id: string; property_id: string; acres: number | null }>(
      supabase.from("pastures").select("id, property_id, acres")
    ),
    all<{ id: string; property_id: string; acres: number | null }>(
      supabase.from("wetlands").select("id, property_id, acres")
    ),
    all<{ id: string; property_id: string; stand_type: string | null; acres: number | null }>(
      supabase.from("timber_stands").select("id, property_id, stand_type, acres")
    ),
    all<{ id: string; property_id: string; acres: number | null; deeded_acres: number | null }>(
      supabase.from("parcels").select("id, property_id, acres, deeded_acres")
    ),
  ]);
  const entityName = new Map(entities.map((e) => [e.id, e.name]));
  const selected = props.filter((p) => {
    if (county && !(p.county ?? "").toLowerCase().includes(county.replace(/\s+county$/, ""))) return false;
    if (entityFilter) {
      const name = p.entity_id ? (entityName.get(p.entity_id) ?? "") : "";
      if (!name.toLowerCase().includes(entityFilter)) return false;
    }
    return true;
  });
  const ids = new Set(selected.map((p) => p.id));
  const sum = (rows: Array<{ property_id: string; acres: number | null }>, pid?: string) =>
    rows
      .filter((r) => ids.has(r.property_id) && (!pid || r.property_id === pid))
      .reduce((a, r) => a + num(r.acres), 0);

  const perProperty = selected.map((p) => {
    const timberByType: Record<string, number> = {};
    for (const s of stands.filter((s) => s.property_id === p.id)) {
      const key = s.stand_type ?? "other";
      timberByType[key] = r1((timberByType[key] ?? 0) + num(s.acres));
    }
    const fieldAcres = sum(fields, p.id);
    const irrigated = fields
      .filter((f) => f.property_id === p.id)
      .reduce((a, f) => a + num(f.irrigated_acres), 0);
    return {
      id: p.id,
      name: p.name,
      county: p.county,
      state: p.state,
      entity: p.entity_id ? (entityName.get(p.entity_id) ?? null) : null,
      total_acres: r1(num(p.acres)),
      parcels: parcels.filter((x) => x.property_id === p.id).length,
      deeded_acres: r1(parcels.filter((x) => x.property_id === p.id).reduce((a, x) => a + num(x.deeded_acres), 0)),
      ag_field_acres: r1(fieldAcres),
      irrigated_acres: r1(irrigated),
      dryland_acres: r1(Math.max(fieldAcres - irrigated, 0)),
      pasture_acres: r1(sum(pastures, p.id)),
      wetland_acres: r1(sum(wetlands, p.id)),
      timber_acres: r1(sum(stands, p.id)),
      timber_by_type: Object.fromEntries(
        Object.entries(timberByType).map(([k, v]) => [STAND_TYPE_LABELS[k] ?? k, v])
      ),
    };
  });

  const byCounty: Record<string, { properties: number; acres: number }> = {};
  const byEntity: Record<string, { properties: number; acres: number }> = {};
  for (const p of selected) {
    const c = p.county ? `${p.county} County${p.state ? ", " + p.state : ""}` : "Unknown county";
    byCounty[c] = { properties: (byCounty[c]?.properties ?? 0) + 1, acres: r1((byCounty[c]?.acres ?? 0) + num(p.acres)) };
    const e = p.entity_id ? (entityName.get(p.entity_id) ?? "Unknown entity") : "No entity (own name)";
    byEntity[e] = { properties: (byEntity[e]?.properties ?? 0) + 1, acres: r1((byEntity[e]?.acres ?? 0) + num(p.acres)) };
  }

  return {
    sources: [
      describeProperties(selected) + (county || entityFilter ? " (filtered)" : ""),
      "ag field, pasture, wetland, and timber stand boundaries",
    ],
    total_acres: r1(selected.reduce((a, p) => a + num(p.acres), 0)),
    ag_field_acres: r1(sum(fields)),
    irrigated_acres: r1(fields.filter((f) => ids.has(f.property_id)).reduce((a, f) => a + num(f.irrigated_acres), 0)),
    pasture_acres: r1(sum(pastures)),
    wetland_acres: r1(sum(wetlands)),
    timber_acres: r1(sum(stands)),
    by_county: byCounty,
    by_entity: byEntity,
    properties: perProperty,
    note: "Acres are computed from the drawn or imported boundaries (GIS acres). Deeded acres come from county records when imported.",
  };
};

const TYPE_LABELS: Record<IncomeType, string> = {
  agricultural: "Agricultural leases",
  hunting: "Hunting leases",
  timber: "Timber sales",
  government: "Government payments (landowner share)",
};

const incomeSummary: ToolImpl = async (supabase, input) => {
  const year = Number(input.year) || new Date().getFullYear();
  const [inputs, props, entities] = await Promise.all([
    loadIncomeInputs(supabase),
    fetchProperties(supabase),
    fetchEntities(supabase),
  ]);
  const byYear = summarizeByYear(inputs);
  const totals = byYear.get(year);
  const perProperty = allocateToProperties(inputs, year);
  const entityName = new Map(entities.map((e) => [e.id, e.name]));
  const propName = new Map(props.map((p) => [p.id, p]));
  const propertyRows = Array.from(perProperty.entries()).map(([pid, t]) => {
    const p = propName.get(pid);
    return {
      property: pid === UNASSIGNED ? "Unassigned" : (p?.name ?? pid),
      entity: p?.entity_id ? (entityName.get(p.entity_id) ?? null) : null,
      expected_income: r2(t.expected),
      received_income: r2(t.received),
      taxes_due: r2(t.taxesDue),
      taxes_paid: r2(t.taxesPaid),
      net_expected: r2(t.expected - t.taxesDue),
    };
  });
  const years = Array.from(byYear.keys()).sort();
  const lineItems = (Object.keys(TYPE_LABELS) as IncomeType[]).map((t) => ({
    type: TYPE_LABELS[t],
    expected: r2(totals?.expected[t] ?? 0),
    received: r2(totals?.received[t] ?? 0),
  }));
  const gov = (totals?.expected as Record<string, number> | undefined)?.government;
  if (gov !== undefined) {
    lineItems.push({
      type: "Government payments (landowner share)",
      expected: r2(gov),
      received: r2((totals?.received as Record<string, number>).government ?? 0),
    });
  }
  const grossExpected = lineItems.reduce((a, l) => a + l.expected, 0);
  const grossReceived = lineItems.reduce((a, l) => a + l.received, 0);
  return {
    sources: [
      `${inputs.leases.length} lease${inputs.leases.length === 1 ? "" : "s"}, ${inputs.settlements.length} timber settlement${inputs.settlements.length === 1 ? "" : "s"}, and tax statements for ${year}`,
      describeProperties(props),
    ],
    year,
    years_with_data: years,
    has_projection: totals?.hasProjection ?? false,
    projection_note: totals?.hasProjection
      ? "Some expected amounts are projections from lease terms and assumptions; they change as prices and yields update."
      : null,
    by_type: lineItems,
    gross_expected: r2(grossExpected),
    gross_received: r2(grossReceived),
    taxes_due: r2(totals?.taxesDue ?? 0),
    taxes_paid: r2(totals?.taxesPaid ?? 0),
    net_expected: r2(grossExpected - (totals?.taxesDue ?? 0)),
    net_received: r2(grossReceived - (totals?.taxesPaid ?? 0)),
    by_property: propertyRows,
    formatting: `Dollars: ${formatDollars(grossExpected)} style (commas, 2 decimals).`,
  };
};

const taxesStatus: ToolImpl = async (supabase, input) => {
  const year = Number(input.year) || new Date().getFullYear();
  const [statements, payments, parcels, props] = await Promise.all([
    all<{
      id: string; parcel_id: string | null; tax_year: number; county: string | null;
      amount_due: number; due_date: string | null; delinquent_date: string | null;
      parcel_number_raw: string | null; owner_name_raw: string | null;
    }>(supabase.from("tax_statements").select("id, parcel_id, tax_year, county, amount_due, due_date, delinquent_date, parcel_number_raw, owner_name_raw").eq("tax_year", year)),
    all<{ tax_statement_id: string; amount: number; paid_date: string }>(
      supabase.from("tax_payments").select("tax_statement_id, amount, paid_date")
    ),
    all<{ id: string; property_id: string; parcel_number: string; county: string | null }>(
      supabase.from("parcels").select("id, property_id, parcel_number, county")
    ),
    fetchProperties(supabase),
  ]);
  const paidBy = new Map<string, number>();
  for (const p of payments) paidBy.set(p.tax_statement_id, (paidBy.get(p.tax_statement_id) ?? 0) + num(p.amount));
  const propName = new Map(props.map((p) => [p.id, p.name]));
  const parcelById = new Map(parcels.map((p) => [p.id, p]));
  const rows = statements.map((s) => {
    const paid = paidBy.get(s.id) ?? 0;
    const parcel = s.parcel_id ? parcelById.get(s.parcel_id) : null;
    return {
      statement_id: s.id,
      parcel_number: parcel?.parcel_number ?? s.parcel_number_raw,
      property: parcel ? (propName.get(parcel.property_id) ?? null) : null,
      county: s.county ?? parcel?.county ?? null,
      amount_due: r2(num(s.amount_due)),
      paid: r2(paid),
      balance: r2(Math.max(num(s.amount_due) - paid, 0)),
      due_date: s.due_date,
      delinquent_date: s.delinquent_date,
      status: taxStatus(s, paid),
      matched_to_parcel: !!parcel,
    };
  });
  const covered = new Set(statements.map((s) => s.parcel_id).filter(Boolean));
  const missing = parcels
    .filter((p) => !covered.has(p.id))
    .map((p) => ({ parcel_number: p.parcel_number, property: propName.get(p.property_id) ?? null, county: p.county }));
  return {
    sources: [
      `${statements.length} tax statement${statements.length === 1 ? "" : "s"} for ${year} and ${payments.length} recorded tax payment${payments.length === 1 ? "" : "s"}`,
      `${parcels.length} parcel${parcels.length === 1 ? "" : "s"} on ${describeProperties(props)}`,
    ],
    year,
    counts: statusCounts(statements, paidBy),
    total_due: r2(statements.reduce((a, s) => a + num(s.amount_due), 0)),
    total_paid: r2(statements.reduce((a, s) => a + (paidBy.get(s.id) ?? 0), 0)),
    statements: rows,
    parcels_without_a_statement: missing,
    note: "Status is computed from payments against the statement amount; a parcel with no statement for the year may simply not have been uploaded yet.",
  };
};

const timberSalesSummary: ToolImpl = async (supabase, input) => {
  const year = input.year ? Number(input.year) : null;
  const [sales, settlements, payments, saleStands, stands, props] = await Promise.all([
    all<{
      id: string; sale_name: string; buyer_name: string | null; sale_type: string; status: string;
      harvest_type: string | null; contract_date: string | null; harvest_deadline: string | null;
      sale_acres: number | null; lump_sum_price: number | null;
    }>(supabase.from("timber_sales").select("id, sale_name, buyer_name, sale_type, status, harvest_type, contract_date, harvest_deadline, sale_acres, lump_sum_price")),
    all<{ timber_sale_id: string; settlement_date: string; total_amount: number }>(
      supabase.from("timber_settlements").select("timber_sale_id, settlement_date, total_amount")
    ),
    all<{ timber_sale_id: string | null; received_date: string; amount: number }>(
      supabase.from("payments").select("timber_sale_id, received_date, amount").not("timber_sale_id", "is", null)
    ),
    all<{ timber_sale_id: string; timber_stand_id: string }>(
      supabase.from("timber_sale_stands").select("timber_sale_id, timber_stand_id")
    ),
    all<{ id: string; name: string; property_id: string; acres: number | null }>(
      supabase.from("timber_stands").select("id, name, property_id, acres")
    ),
    fetchProperties(supabase),
  ]);
  const propName = new Map(props.map((p) => [p.id, p.name]));
  const standById = new Map(stands.map((s) => [s.id, s]));
  const inYear = (d: string) => year === null || new Date(d + "T00:00:00").getFullYear() === year;
  const rows = sales.map((s) => {
    const settled = settlements.filter((x) => x.timber_sale_id === s.id && inYear(x.settlement_date));
    const paid = payments.filter((x) => x.timber_sale_id === s.id && inYear(x.received_date));
    const linked = saleStands.filter((x) => x.timber_sale_id === s.id).map((x) => standById.get(x.timber_stand_id)).filter(Boolean);
    return {
      sale: s.sale_name,
      buyer: s.buyer_name,
      sale_type: s.sale_type,
      harvest_type: s.harvest_type,
      status: s.status,
      contract_date: s.contract_date,
      harvest_deadline: s.harvest_deadline,
      sale_acres: s.sale_acres === null ? null : r1(num(s.sale_acres)),
      lump_sum_price: s.lump_sum_price === null ? null : r2(num(s.lump_sum_price)),
      settlements_count: settled.length,
      settlements_total: r2(settled.reduce((a, x) => a + num(x.total_amount), 0)),
      lump_sum_payments_received: r2(paid.reduce((a, x) => a + num(x.amount), 0)),
      stands: linked.map((st) => ({ name: st!.name, property: propName.get(st!.property_id) ?? null, acres: r1(num(st!.acres)) })),
    };
  });
  const totalReceived = rows.reduce((a, r) => a + r.settlements_total + r.lump_sum_payments_received, 0);
  return {
    sources: [
      `${sales.length} timber sale${sales.length === 1 ? "" : "s"}, ${settlements.length} settlement${settlements.length === 1 ? "" : "s"}, and lump sum payments${year ? ` dated in ${year}` : ""}`,
    ],
    year,
    sales: rows,
    total_received: r2(totalReceived),
    note: "Pay-as-cut settlements count directly as received timber income; lump sum receipts are recorded payments against the sale.",
  };
};

const farmActivity: ToolImpl = async (supabase, input) => {
  const year = Number(input.year) || new Date().getFullYear();
  const [data, mappings, fields, props, connections] = await Promise.all([
    all<{
      farm_connection_id: string; remote_field_id: string; crop_year: number; crop: string;
      planted_acres: number | null; irrigated_acres: number | null; dryland_acres: number | null;
      planting_date: string | null; harvested_acres: number | null; production_units: number | null;
      production_unit: string | null; yield_shared: boolean;
    }>(supabase.from("farm_field_data").select("farm_connection_id, remote_field_id, crop_year, crop, planted_acres, irrigated_acres, dryland_acres, planting_date, harvested_acres, production_units, production_unit, yield_shared").eq("crop_year", year)),
    all<{ farm_connection_id: string; remote_field_id: string; remote_name: string | null; local_field_id: string | null; local_property_id: string | null; status: string }>(
      supabase.from("field_mappings").select("farm_connection_id, remote_field_id, remote_name, local_field_id, local_property_id, status").eq("status", "confirmed")
    ),
    all<{ id: string; name: string; property_id: string }>(supabase.from("fields").select("id, name, property_id")),
    fetchProperties(supabase),
    all<{ id: string; label: string; operation_name: string | null; status: string; last_synced_at: string | null }>(
      supabase.from("farm_connections").select("id, label, operation_name, status, last_synced_at")
    ),
  ]);
  const propName = new Map(props.map((p) => [p.id, p.name]));
  const fieldById = new Map(fields.map((f) => [f.id, f]));
  const mapKey = (c: string, r: string) => `${c}|${r}`;
  const mapping = new Map(mappings.map((m) => [mapKey(m.farm_connection_id, m.remote_field_id), m]));
  const connName = new Map(connections.map((c) => [c.id, c.operation_name ?? c.label]));
  const rows = data.map((d) => {
    const m = mapping.get(mapKey(d.farm_connection_id, d.remote_field_id));
    const local = m?.local_field_id ? fieldById.get(m.local_field_id) : null;
    const propertyId = local?.property_id ?? m?.local_property_id ?? null;
    const yieldPerAcre =
      d.yield_shared && d.production_units !== null && num(d.harvested_acres) > 0
        ? r1(num(d.production_units) / num(d.harvested_acres))
        : null;
    return {
      tenant: connName.get(d.farm_connection_id) ?? "Tenant",
      field: local?.name ?? m?.remote_name ?? d.remote_field_id,
      property: propertyId ? (propName.get(propertyId) ?? null) : null,
      mapped_to_your_land: !!m,
      crop: d.crop,
      planted_acres: d.planted_acres === null ? null : r1(num(d.planted_acres)),
      irrigated_acres: d.irrigated_acres === null ? null : r1(num(d.irrigated_acres)),
      dryland_acres: d.dryland_acres === null ? null : r1(num(d.dryland_acres)),
      planting_date: d.planting_date,
      harvested_acres: d.harvested_acres === null ? null : r1(num(d.harvested_acres)),
      yield_shared: d.yield_shared,
      production: d.yield_shared && d.production_units !== null ? `${formatNumber(Math.round(num(d.production_units)))} ${d.production_unit ?? ""}`.trim() : null,
      yield_per_acre: yieldPerAcre,
      yield_unit: d.production_unit ? `${d.production_unit}/ac` : null,
    };
  });
  const byCrop: Record<string, { planted_acres: number; fields: number }> = {};
  for (const r of rows) {
    byCrop[r.crop] = { planted_acres: r1((byCrop[r.crop]?.planted_acres ?? 0) + (r.planted_acres ?? 0)), fields: (byCrop[r.crop]?.fields ?? 0) + 1 };
  }
  return {
    sources: [
      `${connections.length} connected farm${connections.length === 1 ? "" : "s"} sharing ${data.length} field record${data.length === 1 ? "" : "s"} for ${year}`,
    ],
    year,
    connections: connections.map((c) => ({ name: c.operation_name ?? c.label, status: c.status, last_synced_at: c.last_synced_at })),
    by_crop: byCrop,
    fields: rows,
    note: "Yields show only when the farmer chose to share them. Unmapped fields are shared by the tenant but not yet matched to your land.",
  };
};

const easementsSummary: ToolImpl = async (supabase, input) => {
  const [rows, props] = await Promise.all([
    all<{
      id: string; property_id: string | null; name: string; easement_type: string; relationship: string;
      holder: string | null; recorded_ref: string | null; expiration_date: string | null;
      width_ft: number | null; elevation_ft: number | null; program: string | null;
      acres: number | null; length_feet: number | null; miles: number | null;
    }>(supabase.from("easements_geo").select("id, property_id, name, easement_type, relationship, holder, recorded_ref, expiration_date, width_ft, elevation_ft, program, acres, length_feet, miles")),
    fetchProperties(supabase),
  ]);
  const propName = new Map(props.map((p) => [p.id, p.name]));
  const filter = typeof input.property === "string" ? input.property.trim().toLowerCase() : null;
  const selected = rows.filter((e) => {
    if (!filter) return true;
    const name = e.property_id ? (propName.get(e.property_id) ?? "") : "";
    return name.toLowerCase().includes(filter);
  });
  const byCategory: Record<string, number> = {};
  for (const e of selected) {
    const c = EASEMENT_CATEGORY_LABELS[easementCategory(e.easement_type)];
    byCategory[c] = (byCategory[c] ?? 0) + 1;
  }
  return {
    sources: [
      `${selected.length} easement${selected.length === 1 ? "" : "s"}${filter ? ` on properties matching "${input.property}"` : ""} across ${describeProperties(props)}`,
    ],
    count: selected.length,
    by_category: byCategory,
    easements: selected.map((e) => ({
      name: e.name,
      type: easementTypeLabel(e.easement_type),
      category: EASEMENT_CATEGORY_LABELS[easementCategory(e.easement_type)],
      relationship: EASEMENT_RELATIONSHIP_LABELS[e.relationship as keyof typeof EASEMENT_RELATIONSHIP_LABELS] ?? e.relationship,
      property: e.property_id ? (propName.get(e.property_id) ?? null) : "Not tied to one property",
      holder: e.holder,
      recorded_ref: e.recorded_ref,
      expires: e.expiration_date ?? "permanent / indefinite",
      acres: e.acres === null ? null : r1(num(e.acres)),
      length_feet: e.length_feet === null ? null : Math.round(num(e.length_feet)),
      width_ft: e.width_ft,
      flowage_elevation_ft: e.elevation_ft,
      program: e.program,
    })),
    note: "Polygon easements report acres; line easements report length. Severed mineral rights are not tracked as easements.",
  };
};

const govPaymentsSummary: ToolImpl = async (supabase, input) => {
  const year = Number(input.year) || new Date().getFullYear();
  // Tables arrive with migration 0021; read defensively so the assistant
  // stays useful before it runs.
  const farmsRes = await supabase
    .from("fsa_farms")
    .select("id, farm_number, state, county, farmland_acres, cropland_acres, dcp_cropland_acres");
  if (farmsRes.error) {
    return {
      sources: ["FSA farm records"],
      available: false,
      note: "Government payment records are not available yet (no FSA farms recorded, or the feature is not set up). The Government Payments page explains how to add a farm or scan an FSA-156EZ.",
    };
  }
  type Farm = { id: string; farm_number: string; state: string | null; county: string | null; farmland_acres: number | null; cropland_acres: number | null; dcp_cropland_acres: number | null };
  const farms = (farmsRes.data as Farm[]) ?? [];
  const [base, links, elections, props] = await Promise.all([
    all<{ fsa_farm_id: string; commodity: string; base_acres: number | null; plc_yield: number | null }>(
      supabase.from("fsa_base_acres").select("fsa_farm_id, commodity, base_acres, plc_yield")
    ),
    all<{ fsa_farm_id: string; property_id: string; allocation_pct: number }>(
      supabase.from("fsa_farm_properties").select("fsa_farm_id, property_id, allocation_pct")
    ),
    all<{ fsa_farm_id: string; commodity: string; program_year: number; election: string }>(
      supabase.from("fsa_elections").select("fsa_farm_id, commodity, program_year, election")
    ),
    fetchProperties(supabase),
  ]);
  const propName = new Map(props.map((p) => [p.id, p.name]));
  // Projection engine: lib/gov/govProjection.ts (item 2). Loaded lazily so
  // this module compiles and runs before that file lands; when present it
  // is the SAME engine the Government Payments page uses.
  // The SAME engine the Government Payments page uses (lib/gov/govData):
  // projections for the PAYMENT year (program year = year - 1).
  let projection: unknown = null;
  let projectionNote =
    "Projected payments use the same ARC/PLC engine as the Government Payments page (estimates; FSA determines actual payments after the marketing year closes). Amounts are for the payment year; the program year is one earlier.";
  try {
    const govInputs = await loadGovInputs(supabase);
    const proj = projectForPaymentYear(govInputs, year);
    projection = {
      program_year: proj.programYear,
      payment_year: proj.paymentYear,
      net_total: Math.round(proj.rows.reduce((a, r) => a + (r.net ?? 0), 0) * 100) / 100,
      by_property: [...proj.netByProperty.entries()].map(([pid, net]) => ({
        property: propName.get(pid) ?? pid,
        net: Math.round(net * 100) / 100,
      })),
      rows: proj.rows.map((r) => ({
        farm_id: r.farmId,
        commodity: r.commodity,
        election: r.election,
        base_acres: r.baseAcres,
        net: r.net,
        flat: r.flat,
        notes: r.notes,
      })),
    };
  } catch {
    projection = null;
    projectionNote = "Projected payments are not available right now; base acres, yields, and elections are listed below.";
  }
  const rows = farms.map((f) => ({
    farm_number: f.farm_number,
    county: f.county,
    state: f.state,
    farmland_acres: f.farmland_acres === null ? null : r1(num(f.farmland_acres)),
    cropland_acres: f.cropland_acres === null ? null : r1(num(f.cropland_acres)),
    dcp_cropland_acres: f.dcp_cropland_acres === null ? null : r1(num(f.dcp_cropland_acres)),
    properties: links.filter((l) => l.fsa_farm_id === f.id).map((l) => ({ property: propName.get(l.property_id) ?? l.property_id, allocation_pct: num(l.allocation_pct) })),
    base_acres: base.filter((b) => b.fsa_farm_id === f.id).map((b) => ({
      commodity: b.commodity,
      base_acres: b.base_acres === null ? null : r1(num(b.base_acres)),
      plc_yield: b.plc_yield,
      election: elections.find((e) => e.fsa_farm_id === f.id && e.commodity === b.commodity && e.program_year === year)?.election ?? "plc (default)",
    })),
  }));
  return {
    sources: [`${farms.length} FSA farm${farms.length === 1 ? "" : "s"} with ${base.length} base acre record${base.length === 1 ? "" : "s"}`],
    available: true,
    program_year: year,
    payment_year_note: `Program year ${year} pays in October ${year + 1}.`,
    farms: rows,
    projection,
    note: projectionNote,
  };
};

const runSql: ToolImpl = async (supabase, input) => {
  const guard = guardSql(String(input.sql ?? ""));
  if (!guard.ok) return { sources: [], error: guard.reason };
  const { data, error } = await supabase.rpc("assistant_query", { q: guard.sql });
  if (error) return { sources: [], error: `Query failed: ${error.message}` };
  const rows = Array.isArray(data) ? data : [];
  return {
    sources: [typeof input.purpose === "string" && input.purpose.trim() ? input.purpose.trim() : "a direct lookup in your records"],
    row_count: rows.length,
    capped_at_200: rows.length >= 200,
    rows,
  };
};

// ---------------------------------------------------------------- registry

const IMPLS: Record<string, ToolImpl> = {
  list_properties: listProperties,
  land_summary: landSummary,
  income_summary: incomeSummary,
  taxes_status: taxesStatus,
  timber_sales_summary: timberSalesSummary,
  farm_activity: farmActivity,
  easements_summary: easementsSummary,
  gov_payments_summary: govPaymentsSummary,
  run_sql: runSql,
};

const yearProp = { type: "number" as const, description: "Calendar year, e.g. 2025" };

export const ASSISTANT_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_properties",
    description: "Every property with county, state, GIS acres, and holding entity, plus the list of entities. Start here to resolve a property or entity the user names.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "land_summary",
    description: "Acres by property, county, and entity with the land breakdown: ag fields (irrigated vs dryland), pastures, wetlands, timber by stand type, parcels and deeded acres. Same numbers as the dashboard and property pages.",
    input_schema: {
      type: "object",
      properties: {
        county: { type: "string", description: "Optional county name filter, e.g. Lawrence" },
        entity: { type: "string", description: "Optional holding entity name filter" },
      },
    },
  },
  {
    name: "income_summary",
    description: "Income for a year: expected and received by type (agricultural leases, hunting leases, timber sales, government payment share), property taxes due and paid, net, and the per-property split. The same engine as the Income page.",
    input_schema: { type: "object", properties: { year: yearProp }, required: ["year"] },
  },
  {
    name: "taxes_status",
    description: "Property tax status for a year: each statement with amount due, paid, balance, computed status (paid, partial, unpaid, delinquent), and parcels with no statement yet (completeness). Same rules as the Property Taxes page.",
    input_schema: { type: "object", properties: { year: yearProp }, required: ["year"] },
  },
  {
    name: "timber_sales_summary",
    description: "Timber sales with buyers, type, status, acres, settlements and lump sum receipts (optionally limited to a year), and the linked stands.",
    input_schema: { type: "object", properties: { year: { type: "number", description: "Optional year to limit receipts to" } } },
  },
  {
    name: "farm_activity",
    description: "What the tenant farmer planted and harvested on your land for a crop year, from the connected farm software: crops, planted and harvested acres, yields when shared.",
    input_schema: { type: "object", properties: { year: yearProp }, required: ["year"] },
  },
  {
    name: "easements_summary",
    description: "Easements on the land: type, category, who holds it, whether it burdens or benefits the property, acres or length, expiration, recorded reference. Optionally filtered by property name.",
    input_schema: { type: "object", properties: { property: { type: "string", description: "Optional property name filter" } } },
  },
  {
    name: "gov_payments_summary",
    description: "FSA farms, base acres, PLC yields, elections, and projected ARC/PLC payments for a program year (paid the following October).",
    input_schema: { type: "object", properties: { year: { type: "number", description: "Program year, e.g. 2025" } } },
  },
  {
    name: "run_sql",
    description: "Long-tail questions the other tools do not cover: run ONE read-only SQL SELECT against this organization's own tables (schema in the system prompt). Returns up to 200 rows. Prefer the curated tools for derived numbers (income projections, tax status, payments).",
    input_schema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "A single SELECT (or WITH ... SELECT) statement" },
        purpose: { type: "string", description: "One plain-language line on what this looks up, used to cite the source" },
      },
      required: ["sql"],
    },
  },
];

export async function runAssistantTool(
  supabase: Client,
  name: string,
  input: unknown
): Promise<ToolResult | { error: string }> {
  const impl = IMPLS[name];
  if (!impl) return { error: `Unknown tool: ${name}` };
  try {
    return await impl(supabase, (input ?? {}) as Record<string, unknown>);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Tool failed." };
  }
}

// Friendly status line while a tool runs (streamed to the user).
export function toolStatusLabel(name: string, input?: unknown): string {
  const year = (input as { year?: unknown } | undefined)?.year;
  const y = typeof year === "number" ? ` for ${year}` : "";
  const map: Record<string, string> = {
    list_properties: "Listing your properties",
    land_summary: "Adding up your acres",
    income_summary: `Looking at income${y}`,
    taxes_status: `Checking property taxes${y}`,
    timber_sales_summary: "Checking timber sales",
    farm_activity: `Checking your tenant's farm data${y}`,
    easements_summary: "Checking easements",
    gov_payments_summary: `Checking FSA base acres and payments${y}`,
    run_sql: "Looking that up in your records",
  };
  return map[name] ?? "Checking your records";
}

export const TOOL_PAGE_LINKS: Record<string, { label: string; href: string }> = {
  list_properties: { label: "Properties", href: "/properties" },
  land_summary: { label: "Dashboard", href: "/dashboard" },
  income_summary: { label: "Income", href: "/income" },
  taxes_status: { label: "Property Taxes", href: "/taxes" },
  timber_sales_summary: { label: "Timber sales", href: "/timber-sales" },
  farm_activity: { label: "Farm Data", href: "/farm-activity" },
  easements_summary: { label: "Map", href: "/map" },
  gov_payments_summary: { label: "Government Payments", href: "/gov-payments" },
};

export const ACRES_EXAMPLE = formatAcres(1234.56);
