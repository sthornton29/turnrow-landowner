import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import { formatNumber } from "@/lib/format";
import { ROAD_TYPE_LABELS } from "@/lib/assetTypes";
import {
  ActionLink,
  DetailsCard,
  MapThumb,
  RelatedSection,
  SummaryHeader,
} from "@/components/summary/Summary";
import EntityDocuments from "@/components/documents/EntityDocuments";
import RowEditor from "@/components/lists/RowEditor";

export const metadata = { title: "Road" };

export default async function RoadSummaryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, profile } = await requireOrg();

  const { data: road } = await supabase
    .from("roads_geo")
    .select("*")
    .eq("id", id)
    .single();
  if (!road) notFound();

  const { data: property } = await supabase
    .from("properties")
    .select("id, name")
    .eq("id", road.property_id)
    .single();

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <SummaryHeader
        typeLabel={road.road_type ? ROAD_TYPE_LABELS[road.road_type] : "Road"}
        name={road.name}
        keyFigure={`${formatNumber(Math.round(road.length_feet ?? 0))} ft (${(road.miles ?? 0).toFixed(2)} mi)`}
        breadcrumb={[
          { href: "/properties", label: "Properties" },
          ...(property
            ? [{ href: `/properties/${property.id}`, label: property.name }]
            : []),
          { href: `/roads/${id}`, label: road.name },
        ]}
        actions={
          <ActionLink href={`/map?focus=road:${id}`} primary>
            View on map
          </ActionLink>
        }
      />

      <MapThumb geometry={road.geom_geojson} focus={`road:${id}`} />

      <DetailsCard
        rows={[
          ["Length", `${formatNumber(Math.round(road.length_feet ?? 0))} ft`],
          ["Miles", (road.miles ?? 0).toFixed(2)],
          ["Road type", road.road_type ? ROAD_TYPE_LABELS[road.road_type] : null],
          ["Notes", road.notes],
        ]}
      />
      <RowEditor entityType="road" row={road} />

      <RelatedSection title="Documents and photos">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <EntityDocuments
            orgId={profile.organization_id!}
            entityType="road"
            entityId={id}
          />
        </div>
      </RelatedSection>
    </div>
  );
}
