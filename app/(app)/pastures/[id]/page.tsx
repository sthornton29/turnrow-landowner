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

export const metadata = { title: "Pasture" };

export default async function PastureSummaryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, profile } = await requireOrg();

  const { data: pasture } = await supabase
    .from("pastures_geo")
    .select("*")
    .eq("id", id)
    .single();
  if (!pasture) notFound();

  const { data: property } = await supabase
    .from("properties")
    .select("id, name")
    .eq("id", pasture.property_id)
    .single();

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <SummaryHeader
        typeLabel="Pasture"
        name={pasture.name}
        keyFigure={`${formatAcres(pasture.acres)} acres`}
        breadcrumb={[
          { href: "/properties", label: "Properties" },
          ...(property
            ? [{ href: `/properties/${property.id}`, label: property.name }]
            : []),
          { href: `/pastures/${id}`, label: pasture.name },
        ]}
        actions={
          <ActionLink href={`/map?focus=pasture:${id}`} primary>
            View on map
          </ActionLink>
        }
      />

      <MapThumb geometry={pasture.boundary_geojson} focus={`pasture:${id}`} />

      <DetailsCard
        rows={[
          ["Acres", formatAcres(pasture.acres)],
          ["Notes", pasture.notes],
        ]}
      />
      <RowEditor entityType="pasture" row={pasture} />

      <RelatedSection title="Documents and photos">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <EntityDocuments
            orgId={profile.organization_id!}
            entityType="pasture"
            entityId={id}
          />
        </div>
      </RelatedSection>
    </div>
  );
}
