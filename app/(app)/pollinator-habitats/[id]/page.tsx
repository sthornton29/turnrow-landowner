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

export const metadata = { title: "Pollinator habitat" };

// A pollinator habitat's page (migration 0043): the planting's
// details, its spot on the map, and its photos. Photos are the point
// here: a stand of wildflowers changes through the season and from
// year to year, and a program (CRP CP-42, EQIP) may ask for evidence
// of establishment, so the gallery and the Add photos button lead.
export default async function PollinatorHabitatSummaryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, profile } = await requireOrg();

  const { data: habitat } = await supabase
    .from("pollinator_habitats_geo")
    .select("*")
    .eq("id", id)
    .single();
  if (!habitat) notFound();

  const { data: property } = await supabase
    .from("properties")
    .select("id, name")
    .eq("id", habitat.property_id)
    .single();

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <SummaryHeader
        typeLabel="Pollinator habitat"
        name={habitat.name}
        keyFigure={`${formatAcres(habitat.acres)} acres`}
        breadcrumb={[
          { href: "/properties", label: "Properties" },
          ...(property
            ? [{ href: `/properties/${property.id}`, label: property.name }]
            : []),
          { href: `/pollinator-habitats/${id}`, label: habitat.name },
        ]}
        actions={
          <ActionLink href={`/map?focus=pollinator_habitat:${id}`} primary>
            View on map
          </ActionLink>
        }
      >
        <p className="mt-1 text-xs text-gray-500">
          Wildflowers and native grasses planted or managed for bees,
          butterflies, and other pollinators (CRP CP-42, EQIP, a monarch
          waystation, a field border). Add photos through the season to
          show how the stand is coming along.
        </p>
      </SummaryHeader>

      <MapThumb geometry={habitat.boundary_geojson} focus={`pollinator_habitat:${id}`} />

      <DetailsCard
        rows={[
          ["Acres", formatAcres(habitat.acres)],
          ["Program", habitat.program],
          ["Year established", habitat.year_established != null ? String(habitat.year_established) : null],
          ["Seed mix", habitat.seed_mix],
          ["Notes", habitat.notes],
        ]}
      />
      <RowEditor entityType="pollinator_habitat" row={habitat} />

      <RelatedSection title="Photos and documents">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <EntityDocuments
            orgId={profile.organization_id!}
            entityType="pollinator_habitat"
            entityId={id}
            label={`Pollinator habitat ${habitat.name}`}
          />
        </div>
      </RelatedSection>
    </div>
  );
}
