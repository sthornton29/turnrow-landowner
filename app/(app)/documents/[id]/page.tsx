import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import type { DocumentEntityType, DocumentRow, DocumentVersionRow } from "@/types/db";
import DocumentPageClient, { type PrimaryAttachment } from "./DocumentPageClient";

export const metadata = { title: "Document" };

// One document's page: file preview beside an editable info panel
// (title, type, properties, extracted fields, notes), its follow-on
// actions, utilities (download, replace, delete), previous versions,
// and the upload footer. Session client only: RLS scopes everything.
export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, profile } = await requireOrg();
  const { data: doc } = await supabase.from("documents").select("*").eq("id", id).single();
  if (!doc) notFound();
  const row = doc as DocumentRow;

  const [links, versions, properties, uploader, farm] = await Promise.all([
    supabase.from("document_properties").select("property_id, evidence").eq("document_id", id),
    supabase.from("document_versions").select("*").eq("document_id", id).order("replaced_at", { ascending: false }),
    supabase.from("properties").select("id, name, county, state").order("name"),
    row.uploaded_by
      ? supabase.from("profiles").select("full_name, email").eq("id", row.uploaded_by).maybeSingle()
      : Promise.resolve({ data: null }),
    row.doc_type === "fsa_156ez"
      ? supabase.from("fsa_farms").select("id, farm_number").eq("source_document_id", id).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const primary = await primaryAttachment(supabase, row.entity_type, row.entity_id);

  return (
    <DocumentPageClient
      doc={row}
      links={(links.data ?? []) as Array<{ property_id: string; evidence: string | null }>}
      versions={(versions.data ?? []) as DocumentVersionRow[]}
      properties={(properties.data ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        county: p.county ?? null,
        state: p.state ?? null,
      }))}
      uploadedBy={(uploader.data?.full_name as string | null) || (uploader.data?.email as string | null) || null}
      primary={primary}
      fsaFarm={farm.data ? { id: farm.data.id as string, farmNumber: String(farm.data.farm_number) } : null}
      orgId={profile.organization_id!}
    />
  );
}

// Label and link for the primary non-property attachment (a lease, an
// easement, an entity...). Properties are shown through the links list.
async function primaryAttachment(
  supabase: Awaited<ReturnType<typeof requireOrg>>["supabase"],
  entityType: DocumentEntityType,
  entityId: string
): Promise<PrimaryAttachment | null> {
  const simple: Partial<Record<DocumentEntityType, { table: string; prefix: string; href: string; col?: string }>> = {
    parcel: { table: "parcels", prefix: "Parcel", href: "/parcels", col: "parcel_number" },
    field: { table: "fields", prefix: "Ag field", href: "/fields" },
    pasture: { table: "pastures", prefix: "Pasture", href: "/pastures" },
    wetland: { table: "wetlands", prefix: "Wetland", href: "/wetlands" },
    timber_stand: { table: "timber_stands", prefix: "Stand", href: "/timber" },
    road: { table: "roads", prefix: "Road", href: "/roads" },
    easement: { table: "easements", prefix: "Easement", href: "/easements" },
    asset: { table: "assets", prefix: "Asset", href: "/assets" },
    lease: { table: "leases", prefix: "Lease", href: "/leases" },
    timber_sale: { table: "timber_sales", prefix: "Timber sale", href: "/timber-sales", col: "sale_name" },
    entity: { table: "entities", prefix: "Entity", href: "/entities" },
    tenant: { table: "tenants", prefix: "Tenant", href: "/tenants" },
  };
  if (entityType === "property" || entityType === "organization") return null;
  if (entityType === "tax_statement") {
    const { data } = await supabase
      .from("tax_statements")
      .select("tax_year, county, account_number, taxpayer_name_printed")
      .eq("id", entityId)
      .maybeSingle();
    const who = data ? [data.county, data.account_number ?? data.taxpayer_name_printed].filter(Boolean).join(", ") : "";
    return {
      label: data ? `${data.tax_year} tax statement${who ? ` (${who})` : ""}` : "Tax statement",
      href: data ? `/taxes?year=${data.tax_year}` : "/taxes",
    };
  }
  const s = simple[entityType];
  if (!s) return null;
  const col = s.col ?? "name";
  const { data } = await supabase.from(s.table).select(col).eq("id", entityId).maybeSingle();
  const name = (data as Record<string, unknown> | null)?.[col];
  return { label: `${s.prefix} ${name ?? ""}`.trim(), href: `${s.href}/${entityId}` };
}
