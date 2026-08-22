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

export const metadata = { title: "Cemetery" };

// A family or church plot inside farmland: a drawn plot (acres) or a
// single marker. Same summary template as the other land types.
export default async function CemeterySummaryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, profile } = await requireOrg();

  const { data: cemetery } = await supabase
    .from("cemeteries_geo")
    .select("*")
    .eq("id", id)
    .single();
  if (!cemetery) notFound();

  const { data: property } = await supabase
    .from("properties")
    .select("id, name")
    .eq("id", cemetery.property_id)
    .single();

  const isPlot = cemetery.acres !== null && cemetery.acres !== undefined;

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <SummaryHeader
        typeLabel="Cemetery"
        name={cemetery.name}
        keyFigure={isPlot ? `${formatAcres(cemetery.acres)} acres` : "Marked by a pin"}
        breadcrumb={[
          { href: "/properties", label: "Properties" },
          ...(property
            ? [{ href: `/properties/${property.id}`, label: property.name }]
            : []),
          { href: `/cemeteries/${id}`, label: cemetery.name },
        ]}
        actions={
          <ActionLink href={`/map?focus=cemetery:${id}`} primary>
            View on map
          </ActionLink>
        }
      />

      <MapThumb geometry={cemetery.geom_geojson} focus={`cemetery:${id}`} />

      <DetailsCard
        rows={[
          ["Acres", isPlot ? formatAcres(cemetery.acres) : null],
          ["Notes", cemetery.notes],
        ]}
      />
      <RowEditor entityType="cemetery" row={cemetery} />

      <RelatedSection title="Documents and photos">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <EntityDocuments
            orgId={profile.organization_id!}
            entityType="cemetery"
            entityId={id}
          />
        </div>
      </RelatedSection>
    </div>
  );
}
