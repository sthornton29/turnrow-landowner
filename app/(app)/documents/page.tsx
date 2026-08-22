import { requireOrg } from "@/lib/auth";
import type { DocumentRow } from "@/types/db";
import DocumentsClient, { type AttachTarget } from "./DocumentsClient";

export const metadata = { title: "Documents" };

// Every document in the organization as one recent-first list with
// search, a property/entity filter, the taxonomy as a rail, and upload.
// Loads small id/name lookups so each row can name and link what it is
// attached to. Session client only: RLS scopes everything to the org.
export default async function DocumentsPage() {
  const { supabase, profile } = await requireOrg();
  const [
    docs, properties, parcels, fields, pastures, wetlands, stands, roads,
    easements, assets, leases, sales, entities, tenants, taxStatements, links,
    cemeteries, issues,
  ] = await Promise.all([
    supabase.from("documents").select("*").order("created_at", { ascending: false }),
    supabase.from("properties").select("id, name, entity_id, county, state").order("name"),
    supabase.from("parcels").select("id, parcel_number, property_id"),
    supabase.from("fields").select("id, name, property_id"),
    supabase.from("pastures").select("id, name, property_id"),
    supabase.from("wetlands").select("id, name, property_id"),
    supabase.from("timber_stands").select("id, name, property_id"),
    supabase.from("roads").select("id, name, property_id"),
    supabase.from("easements").select("id, name, property_id"),
    supabase.from("assets").select("id, name, property_id"),
    supabase.from("leases").select("id, name"),
    supabase.from("timber_sales").select("id, sale_name"),
    supabase.from("entities").select("id, name").order("name"),
    supabase.from("tenants").select("id, name"),
    supabase
      .from("tax_statements")
      .select("id, tax_year, county, account_number, taxpayer_name_printed, tax_statement_lines(parcel_id, line_no)"),
    supabase.from("document_properties").select("document_id, property_id"),
    supabase.from("cemeteries").select("id, name, property_id"),
    supabase.from("maintenance_issues").select("id, label, issue_type, property_id"),
  ]);

  type Row = { id: string; name?: string | null; property_id?: string | null };
  const targets: AttachTarget[] = [];
  const push = (
    entityType: AttachTarget["entityType"],
    rows: Row[] | null,
    label: (r: Row) => string,
    href: (r: Row) => string
  ) => {
    for (const r of rows ?? []) {
      targets.push({
        entityType,
        id: r.id,
        label: label(r),
        href: href(r),
        propertyId: r.property_id ?? (entityType === "property" ? r.id : null),
      });
    }
  };
  push("property", properties.data as Row[], (r) => r.name ?? "", (r) => `/properties/${r.id}`);
  push(
    "parcel",
    (parcels.data ?? []).map((p) => ({ id: p.id, name: `Parcel ${p.parcel_number}`, property_id: p.property_id })),
    (r) => r.name ?? "",
    (r) => `/parcels/${r.id}`
  );
  push("field", fields.data as Row[], (r) => `Ag field ${r.name ?? ""}`, (r) => `/fields/${r.id}`);
  push("pasture", pastures.data as Row[], (r) => `Pasture/Grassland ${r.name ?? ""}`, (r) => `/pastures/${r.id}`);
  push("wetland", wetlands.data as Row[], (r) => `Wetland ${r.name ?? ""}`, (r) => `/wetlands/${r.id}`);
  push("timber_stand", stands.data as Row[], (r) => `Stand ${r.name ?? ""}`, (r) => `/timber/${r.id}`);
  push("road", roads.data as Row[], (r) => `Road ${r.name ?? ""}`, (r) => `/roads/${r.id}`);
  push("easement", easements.data as Row[], (r) => `Easement ${r.name ?? ""}`, (r) => `/easements/${r.id}`);
  push("asset", assets.data as Row[], (r) => `Asset ${r.name ?? ""}`, (r) => `/assets/${r.id}`);
  push("cemetery", cemeteries.data as Row[], (r) => `Cemetery ${r.name ?? ""}`, (r) => `/cemeteries/${r.id}`);
  push(
    "maintenance_issue",
    (issues.data ?? []).map((i) => ({ id: i.id, name: i.label ?? i.issue_type, property_id: i.property_id })),
    (r) => `Maintenance issue ${r.name ?? ""}`,
    () => "/maintenance"
  );
  push("lease", leases.data as Row[], (r) => `Lease ${r.name ?? ""}`, (r) => `/leases/${r.id}`);
  push(
    "timber_sale",
    (sales.data ?? []).map((s) => ({ id: s.id, name: s.sale_name })),
    (r) => `Timber sale ${r.name ?? ""}`,
    (r) => `/timber-sales/${r.id}`
  );
  push("entity", entities.data as Row[], (r) => `Entity ${r.name ?? ""}`, (r) => `/entities/${r.id}`);
  push("tenant", tenants.data as Row[], (r) => `Tenant ${r.name ?? ""}`, (r) => `/tenants/${r.id}`);
  const parcelProperty = new Map(
    (parcels.data ?? []).map((p) => [p.id, { property_id: p.property_id, number: p.parcel_number }])
  );
  push(
    "tax_statement",
    (taxStatements.data ?? []).map((t) => {
      // Header + lines (migration 0030): the first matched line's parcel
      // places the statement on a property.
      const lines = (t.tax_statement_lines ?? []) as Array<{ parcel_id: string | null; line_no: number }>;
      const first = [...lines].sort((a, b) => a.line_no - b.line_no).find((l) => l.parcel_id);
      const who = t.account_number ?? t.taxpayer_name_printed ?? "";
      return {
        id: t.id,
        name: `${t.tax_year} tax statement (${[t.county, who].filter(Boolean).join(", ")})`,
        property_id: first?.parcel_id ? (parcelProperty.get(first.parcel_id)?.property_id ?? null) : null,
      };
    }),
    (r) => r.name ?? "",
    () => "/taxes"
  );

  return (
    <DocumentsClient
      orgId={profile.organization_id!}
      docs={(docs.data as DocumentRow[]) ?? []}
      targets={targets}
      properties={(properties.data ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        entityId: p.entity_id ?? null,
        county: p.county ?? null,
        state: p.state ?? null,
      }))}
      entities={(entities.data ?? []).map((e) => ({ id: e.id, name: e.name }))}
      links={(links.data ?? []) as Array<{ document_id: string; property_id: string }>}
    />
  );
}
