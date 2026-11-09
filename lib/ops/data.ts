// GET /api/ops/data (2026-11-08): the curated datasets an Assignment in
// Turnrow Farm may read from this app (turnrow-farm docs/OPS_API.md). Each
// is the same figures a page here shows, filtered by the organization,
// at most MAX_ROWS rows. No contact details beyond a tenant's name and
// contact person, and nothing secret.

import type { SupabaseClient } from "@supabase/supabase-js";
import { paymentStatus } from "@/lib/leaseLogic";
import { OPS_APP, OPS_LABEL } from "./auth";

export const MAX_ROWS = 500;

export interface DatasetParam { name: string; type: "integer" | "string"; required: boolean; description: string }
export interface DatasetResult { columns: string[]; rows: Array<Array<string | number | boolean | null>>; path: string }
export interface Dataset {
  name: string;
  description: string;
  params: DatasetParam[];
  run: (client: SupabaseClient, orgId: string, params: Record<string, string>, now: Date) => Promise<DatasetResult>;
}

type Row = Record<string, unknown>;
async function rows(q: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<Row[]> {
  const { data, error } = await q;
  if (error) throw new Error(`${what}: ${error.message}`);
  return (data ?? []) as Row[];
}
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
const r2 = (v: number) => Math.round(v * 100) / 100;
const yearParam = (p: Record<string, string>, key: string): number | null => {
  if (!p[key]) return null;
  const y = Number(p[key]);
  if (!Number.isInteger(y) || y < 1900 || y > 2200) throw new ParamError(`${key} must be a year such as 2026.`);
  return y;
};
export class ParamError extends Error {}

async function names(client: SupabaseClient, orgId: string) {
  const [props, ents, leases, tenants, sales] = await Promise.all([
    rows(client.from("properties").select("id, name, entity_id").eq("organization_id", orgId), "properties"),
    rows(client.from("entities").select("id, name").eq("organization_id", orgId), "entities"),
    rows(client.from("leases").select("id, name, tenant_id").eq("organization_id", orgId), "leases"),
    rows(client.from("tenants").select("id, name").eq("organization_id", orgId), "tenants"),
    rows(client.from("timber_sales").select("id, sale_name").eq("organization_id", orgId), "timber sales"),
  ]);
  return {
    property: new Map(props.map((p) => [String(p.id), String(p.name)])),
    propertyEntity: new Map(props.map((p) => [String(p.id), s(p.entity_id)])),
    entity: new Map(ents.map((e) => [String(e.id), String(e.name)])),
    lease: new Map(leases.map((l) => [String(l.id), String(l.name)])),
    tenant: new Map(tenants.map((t) => [String(t.id), String(t.name)])),
    sale: new Map(sales.map((x) => [String(x.id), String(x.sale_name)])),
  };
}

const year = { name: "year", type: "integer", required: false, description: "Only this calendar year (by due or received date)." } as const;

export const DATASETS: Dataset[] = [
  {
    name: "properties",
    description: "Every property: county, state, the entity that holds it, acres, parcel count and FSA farm numbers.",
    params: [],
    async run(client, orgId) {
      const [props, parcels, nm] = await Promise.all([
        rows(client.from("properties").select("id, name, county, state, acres, entity_id, fsa_numbers").eq("organization_id", orgId), "properties"),
        rows(client.from("parcels").select("id, property_id").eq("organization_id", orgId), "parcels"),
        names(client, orgId),
      ]);
      const count = new Map<string, number>();
      for (const p of parcels) if (p.property_id) count.set(String(p.property_id), (count.get(String(p.property_id)) ?? 0) + 1);
      return {
        columns: ["property", "county", "state", "entity", "acres", "parcels", "fsa_farm_numbers"],
        rows: props.sort((a, b) => String(a.name).localeCompare(String(b.name))).map((p) => [s(p.name), s(p.county), s(p.state), p.entity_id ? nm.entity.get(String(p.entity_id)) ?? null : null, n(p.acres) === null ? null : r2(Number(p.acres)), count.get(String(p.id)) ?? 0, Array.isArray(p.fsa_numbers) ? (p.fsa_numbers as string[]).join(", ") : s(p.fsa_numbers)]),
        path: "/properties",
      };
    },
  },
  {
    name: "leases",
    description: "Every lease: tenant, type, status, start and end dates, auto renew, notice days, rent structure, and leased acres with the properties it covers.",
    params: [{ name: "status", type: "string", required: false, description: "active, expired, draft... (default: all)" }],
    async run(client, orgId, p) {
      let q = client.from("leases").select("id, name, status, lease_type, start_date, end_date, auto_renew, termination_notice_days, rent_structure, tenant_id").eq("organization_id", orgId);
      if (p.status) q = q.eq("status", p.status);
      const [leases, lands, nm] = await Promise.all([rows(q, "leases"), rows(client.from("lease_lands").select("lease_id, property_id, leased_acres").eq("organization_id", orgId), "lease lands"), names(client, orgId)]);
      const acres = new Map<string, number>();
      const props = new Map<string, Set<string>>();
      for (const l of lands) {
        const k = String(l.lease_id);
        acres.set(k, (acres.get(k) ?? 0) + Number(l.leased_acres ?? 0));
        if (l.property_id) (props.get(k) ?? props.set(k, new Set()).get(k)!).add(nm.property.get(String(l.property_id)) ?? "?");
      }
      return {
        columns: ["lease", "tenant", "type", "status", "start_date", "end_date", "auto_renew", "notice_days", "rent_structure", "leased_acres", "properties"],
        rows: leases.sort((a, b) => String(a.name).localeCompare(String(b.name))).map((l) => [s(l.name), l.tenant_id ? nm.tenant.get(String(l.tenant_id)) ?? null : null, s(l.lease_type), s(l.status), s(l.start_date), s(l.end_date), l.auto_renew === true, n(l.termination_notice_days), typeof l.rent_structure === "string" ? l.rent_structure : l.rent_structure ? JSON.stringify(l.rent_structure).slice(0, 300) : null, acres.has(String(l.id)) ? r2(acres.get(String(l.id))!) : null, [...(props.get(String(l.id)) ?? [])].join(", ") || null]),
        path: "/leases",
      };
    },
  },
  {
    name: "payments_expected",
    description: "Scheduled payments from leases and timber sales: due date, what for, expected, received so far, still owed, and status (paid, partial, past due, due soon, upcoming).",
    params: [year, { name: "status", type: "string", required: false, description: "paid, partial, past_due, due_soon or upcoming" }],
    async run(client, orgId, p, now) {
      const y = yearParam(p, "year");
      const [expected, paid, nm] = await Promise.all([
        rows(client.from("expected_payments").select("id, lease_id, timber_sale_id, label, due_date, expected_amount").eq("organization_id", orgId), "expected payments"),
        rows(client.from("payments").select("expected_payment_id, amount").eq("organization_id", orgId), "payments"),
        names(client, orgId),
      ]);
      const got = new Map<string, number>();
      for (const x of paid) if (x.expected_payment_id) got.set(String(x.expected_payment_id), (got.get(String(x.expected_payment_id)) ?? 0) + Number(x.amount ?? 0));
      const out = expected
        .filter((e) => !y || String(e.due_date).startsWith(String(y)))
        .map((e) => {
          const amt = Number(e.expected_amount ?? 0), rec = got.get(String(e.id)) ?? 0;
          const st = paymentStatus(amt, rec, String(e.due_date), now);
          return { e, amt, rec, st };
        })
        .filter((x) => !p.status || x.st === p.status)
        .sort((a, b) => String(a.e.due_date).localeCompare(String(b.e.due_date)));
      return {
        columns: ["due_date", "from", "for", "expected", "received", "owed", "status"],
        rows: out.map(({ e, amt, rec, st }) => [s(e.due_date), e.lease_id ? nm.lease.get(String(e.lease_id)) ?? null : e.timber_sale_id ? nm.sale.get(String(e.timber_sale_id)) ?? null : null, s(e.label), r2(amt), r2(rec), r2(Math.max(0, amt - rec)), st]),
        path: "/income",
      };
    },
  },
  {
    name: "payments_received",
    description: "Payments received from leases and timber sales: date, from, amount, method and memo.",
    params: [year],
    async run(client, orgId, p) {
      const y = yearParam(p, "year");
      const [paid, nm] = await Promise.all([rows(client.from("payments").select("received_date, lease_id, timber_sale_id, amount, method, memo").eq("organization_id", orgId), "payments"), names(client, orgId)]);
      return {
        columns: ["received_date", "from", "amount", "method", "memo"],
        rows: paid.filter((x) => !y || String(x.received_date).startsWith(String(y))).sort((a, b) => String(b.received_date).localeCompare(String(a.received_date))).map((x) => [s(x.received_date), x.lease_id ? nm.lease.get(String(x.lease_id)) ?? null : x.timber_sale_id ? nm.sale.get(String(x.timber_sale_id)) ?? null : null, r2(Number(x.amount ?? 0)), s(x.method), s(x.memo)]),
        path: "/income",
      };
    },
  },
  {
    name: "property_taxes",
    description: "Property tax statements: tax year, county, authority, the entity, amount due, paid, still owed, due and delinquent dates.",
    params: [{ name: "tax_year", type: "integer", required: false, description: "Default: every year on file" }],
    async run(client, orgId, p) {
      const y = yearParam(p, "tax_year");
      let q = client.from("tax_statements").select("id, tax_year, county, state, authority_name, entity_id, amount_due, due_date, delinquent_date").eq("organization_id", orgId);
      if (y) q = q.eq("tax_year", y);
      const [st, paid, nm] = await Promise.all([rows(q, "tax statements"), rows(client.from("tax_payments").select("tax_statement_id, amount").eq("organization_id", orgId), "tax payments"), names(client, orgId)]);
      const by = new Map<string, number>();
      for (const x of paid) by.set(String(x.tax_statement_id), (by.get(String(x.tax_statement_id)) ?? 0) + Number(x.amount ?? 0));
      return {
        columns: ["tax_year", "county", "state", "authority", "entity", "amount_due", "paid", "owed", "due_date", "delinquent_date"],
        rows: st.sort((a, b) => Number(b.tax_year) - Number(a.tax_year) || String(a.county).localeCompare(String(b.county))).map((x) => { const due = Number(x.amount_due ?? 0), pd = by.get(String(x.id)) ?? 0; return [n(x.tax_year), s(x.county), s(x.state), s(x.authority_name), x.entity_id ? nm.entity.get(String(x.entity_id)) ?? null : null, r2(due), r2(pd), r2(Math.max(0, due - pd)), s(x.due_date), s(x.delinquent_date)]; }),
        path: "/taxes",
      };
    },
  },
  {
    name: "tax_parcels",
    description: "Each line of the property tax statements: tax year, the parcel it is matched to (and its property), appraised and assessed value, acres, tax due, and whether the match is confirmed.",
    params: [{ name: "tax_year", type: "integer", required: false, description: "Default: every year on file" }],
    async run(client, orgId, p) {
      const y = yearParam(p, "tax_year");
      let q = client.from("tax_statement_lines").select("tax_year, line_type, parcel_id, appraised_value, assessed_value, tax_due, acres, confirmed, legal_description").eq("organization_id", orgId);
      if (y) q = q.eq("tax_year", y);
      const [lines, parcels, nm] = await Promise.all([rows(q, "tax lines"), rows(client.from("parcels").select("id, parcel_number, property_id").eq("organization_id", orgId), "parcels"), names(client, orgId)]);
      const parcel = new Map(parcels.map((x) => [String(x.id), x]));
      return {
        columns: ["tax_year", "line_type", "parcel_number", "property", "appraised_value", "assessed_value", "acres", "tax_due", "confirmed", "legal_description"],
        rows: lines.map((l) => { const pc = l.parcel_id ? parcel.get(String(l.parcel_id)) : undefined; return [n(l.tax_year), s(l.line_type), pc ? s(pc.parcel_number) : null, pc?.property_id ? nm.property.get(String(pc.property_id)) ?? null : null, n(l.appraised_value), n(l.assessed_value), n(l.acres), n(l.tax_due), l.confirmed === true, s(l.legal_description)?.slice(0, 160) ?? null]; }),
        path: "/taxes",
      };
    },
  },
  {
    name: "fsa_farms",
    description: "FSA farms: farm number, county, farmland and cropland acres, base acres and PLC yield by commodity, and the ARC/PLC election for a program year.",
    params: [{ name: "program_year", type: "integer", required: false, description: "The election year to show (default: the latest on file)" }],
    async run(client, orgId, p) {
      const y = yearParam(p, "program_year");
      const [farms, base, elections] = await Promise.all([
        rows(client.from("fsa_farms").select("id, farm_number, state, county, farmland_acres, cropland_acres").eq("organization_id", orgId), "fsa farms"),
        rows(client.from("fsa_base_acres").select("fsa_farm_id, commodity, base_acres, plc_yield").eq("organization_id", orgId), "base acres"),
        rows(client.from("fsa_elections").select("fsa_farm_id, commodity, program_year, election").eq("organization_id", orgId), "elections"),
      ]);
      const latest = y ?? elections.reduce((m, e) => Math.max(m, Number(e.program_year ?? 0)), 0);
      const farm = new Map(farms.map((f) => [String(f.id), f]));
      return {
        columns: ["farm_number", "county", "state", "farmland_acres", "cropland_acres", "commodity", "base_acres", "plc_yield", "program_year", "election"],
        rows: base.map((b) => { const f = farm.get(String(b.fsa_farm_id)); const el = elections.find((e) => e.fsa_farm_id === b.fsa_farm_id && e.commodity === b.commodity && Number(e.program_year) === latest); return [f ? s(f.farm_number) : null, f ? s(f.county) : null, f ? s(f.state) : null, f ? n(f.farmland_acres) : null, f ? n(f.cropland_acres) : null, s(b.commodity), n(b.base_acres), n(b.plc_yield), latest || null, el ? s(el.election) : null]; }),
        path: "/gov-payments",
      };
    },
  },
  {
    name: "timber",
    description: "Timber stands: property, stand type, species, acres, year established, site index, last thinning and burn.",
    params: [],
    async run(client, orgId) {
      const [stands, nm] = await Promise.all([rows(client.from("timber_stands").select("name, property_id, stand_type, species, acres, year_established, site_index, last_thinning_year, last_burn_year").eq("organization_id", orgId), "timber stands"), names(client, orgId)]);
      return {
        columns: ["stand", "property", "stand_type", "species", "acres", "year_established", "site_index", "last_thinning_year", "last_burn_year"],
        rows: stands.map((t) => [s(t.name), t.property_id ? nm.property.get(String(t.property_id)) ?? null : null, s(t.stand_type), Array.isArray(t.species) ? (t.species as string[]).join(", ") : s(t.species), n(t.acres) === null ? null : r2(Number(t.acres)), n(t.year_established), n(t.site_index), n(t.last_thinning_year), n(t.last_burn_year)]),
        path: "/timber",
      };
    },
  },
  {
    name: "timber_sales",
    description: "Timber sales: buyer, lump sum or pay as cut, status, contract date, harvest deadline, sale acres, lump sum price and performance deposit.",
    params: [],
    async run(client, orgId) {
      const sales = await rows(client.from("timber_sales").select("sale_name, buyer_name, sale_type, status, contract_date, harvest_deadline, sale_acres, lump_sum_price, performance_deposit").eq("organization_id", orgId), "timber sales");
      return { columns: ["sale", "buyer", "sale_type", "status", "contract_date", "harvest_deadline", "sale_acres", "lump_sum_price", "performance_deposit"], rows: sales.map((x) => [s(x.sale_name), s(x.buyer_name), s(x.sale_type), s(x.status), s(x.contract_date), s(x.harvest_deadline), n(x.sale_acres), n(x.lump_sum_price), n(x.performance_deposit)]), path: "/timber-sales" };
    },
  },
  {
    name: "maintenance",
    description: "Maintenance issues on the land (washes, sinkholes, terraces, road washouts): type, label, severity, status, property, acres, when noted and resolved.",
    params: [{ name: "status", type: "string", required: false, description: "open or resolved (default: open)" }],
    async run(client, orgId, p) {
      const status = p.status || "open";
      const [issues, nm] = await Promise.all([rows(client.from("maintenance_issues").select("issue_type, label, severity, status, property_id, acres, created_at, resolved_at").eq("organization_id", orgId).eq("status", status), "maintenance"), names(client, orgId)]);
      return { columns: ["issue_type", "label", "severity", "status", "property", "acres", "noted", "resolved"], rows: issues.map((i) => [s(i.issue_type), s(i.label), s(i.severity), s(i.status), i.property_id ? nm.property.get(String(i.property_id)) ?? null : null, n(i.acres) === null ? null : r2(Number(i.acres)), s(i.created_at)?.slice(0, 10) ?? null, s(i.resolved_at)?.slice(0, 10) ?? null]), path: "/maintenance" };
    },
  },
  {
    name: "documents",
    description: "The document index: title, file name, kind, what it is attached to, when uploaded, and whether its title has been checked. Filter with q (words in the title or file name).",
    params: [{ name: "q", type: "string", required: false, description: "Words to look for in the title or file name" }],
    async run(client, orgId, p) {
      const docs = await rows(client.from("documents").select("title, file_name, doc_type, entity_type, created_at, title_reviewed").eq("organization_id", orgId), "documents");
      const words = (p.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      return {
        columns: ["title", "file_name", "doc_type", "attached_to", "uploaded", "title_checked"],
        rows: docs.filter((d) => words.every((w) => `${d.title ?? ""} ${d.file_name ?? ""}`.toLowerCase().includes(w))).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map((d) => [s(d.title), s(d.file_name), s(d.doc_type), s(d.entity_type), s(d.created_at)?.slice(0, 10) ?? null, d.title_reviewed !== false]),
        path: "/documents",
      };
    },
  },
  {
    name: "farm_data",
    description: "What the farming tenant reported through the Turnrow Farm link, per field: crop year, crop, planted, irrigated and harvested acres, harvest status, production, and the farming entity.",
    params: [{ name: "crop_year", type: "integer", required: false, description: "Default: every year synced" }],
    async run(client, orgId, p) {
      const y = yearParam(p, "crop_year");
      let q = client.from("farm_field_data").select("crop_year, crop, planted_acres, irrigated_acres, harvested_acres, harvest_status, production_units, production_unit, remote_entity_name, synced_at").eq("organization_id", orgId);
      if (y) q = q.eq("crop_year", y);
      const data = await rows(q, "farm field data");
      return { columns: ["crop_year", "crop", "planted_acres", "irrigated_acres", "harvested_acres", "harvest_status", "production", "unit", "farming_entity", "synced"], rows: data.map((d) => [n(d.crop_year), s(d.crop), n(d.planted_acres), n(d.irrigated_acres), n(d.harvested_acres), s(d.harvest_status), n(d.production_units), s(d.production_unit), s(d.remote_entity_name), s(d.synced_at)?.slice(0, 10) ?? null]), path: "/farm-activity" };
    },
  },
];

export function datasetIndex() {
  return { app: OPS_APP, label: OPS_LABEL, datasets: DATASETS.map(({ name, description, params }) => ({ name, description, params })) };
}

export async function runDataset(client: SupabaseClient, orgId: string, base: string, name: string, params: Record<string, string>, now: Date = new Date()) {
  const ds = DATASETS.find((d) => d.name === name);
  if (!ds) return null;
  const r = await ds.run(client, orgId, params, now);
  return { app: OPS_APP, dataset: name, as_of: now.toISOString(), columns: r.columns, rows: r.rows.slice(0, MAX_ROWS), total: r.rows.length, truncated: r.rows.length > MAX_ROWS, url: `${base}${r.path}` };
}
