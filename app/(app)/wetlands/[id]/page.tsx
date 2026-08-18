import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import { formatAcres } from "@/lib/format";
import {
  ActionLink,
  DetailsCard,
  MapThumb,
  RelatedSection,
  SummaryHeader,
} from "@/components/summary/Summary";
import EntityDocuments from "@/components/documents/EntityDocuments";
import RowEditor from "@/components/lists/RowEditor";

export const metadata = { title: "Wetland" };

export default async function WetlandSummaryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, profile } = await requireOrg();

  const { data: wetland } = await supabase
    .from("wetlands_geo")
    .select("*")
    .eq("id", id)
    .single();
  if (!wetland) notFound();

  const { data: property } = await supabase
    .from("properties")
    .select("id, name")
    .eq("id", wetland.property_id)
    .single();

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 md:p-6">
      <SummaryHeader
        typeLabel="Wetland"
        name={wetland.name}
        keyFigure={`${formatAcres(wetland.acres)} acres`}
        breadcrumb={[
          { href: "/properties", label: "Properties" },
          ...(property
            ? [{ href: `/properties/${property.id}`, label: property.name }]
            : []),
          { href: `/wetlands/${id}`, label: wetland.name },
        ]}
        actions={
          <ActionLink href={`/map?focus=wetland:${id}`} primary>
            View on map
          </ActionLink>
        }
      >
        <p className="mt-1 text-xs text-gray-500">
          Open wetland (marsh, slough, duck hole, easement ground). Forested
          bottomland is tracked as a timber stand.
        </p>
      </SummaryHeader>

      <MapThumb geometry={wetland.boundary_geojson} focus={`wetland:${id}`} />

      <DetailsCard
        rows={[
          ["Acres", formatAcres(wetland.acres)],
          ["Notes", wetland.notes],
        ]}
      />
      <RowEditor entityType="wetland" row={wetland} />

      <RelatedSection title="Documents and photos">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <EntityDocuments
            orgId={profile.organization_id!}
            entityType="wetland"
            entityId={id}
          />
        </div>
      </RelatedSection>
    </div>
  );
}
