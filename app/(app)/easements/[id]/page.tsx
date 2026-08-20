import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import { formatAcres, formatNumber } from "@/lib/format";
import {
  EASEMENT_RELATIONSHIP_LABELS,
  easementTypeLabel,
} from "@/lib/easements";
import {
  ActionLink,
  DetailsCard,
  MapThumb,
  RelatedSection,
  SummaryHeader,
} from "@/components/summary/Summary";
import EntityDocuments from "@/components/documents/EntityDocuments";
import RowEditor from "@/components/lists/RowEditor";

export const metadata = { title: "Easement" };

export default async function EasementSummaryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, profile } = await requireOrg();

  const { data: easement } = await supabase
    .from("easements_geo")
    .select("*")
    .eq("id", id)
    .single();
  if (!easement) notFound();

  const { data: property } = easement.property_id
    ? await supabase
        .from("properties")
        .select("id, name")
        .eq("id", easement.property_id)
        .single()
    : { data: null };

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 md:p-6">
      <SummaryHeader
        typeLabel={`${easementTypeLabel(easement.easement_type)} easement`}
        name={easement.name}
        keyFigure={
          easement.geom_geojson
            ? `${formatNumber(Math.round(easement.length_feet ?? 0))} ft`
            : `${formatAcres(easement.acres)} acres`
        }
        breadcrumb={[
          { href: "/properties", label: "Properties" },
          ...(property
            ? [{ href: `/properties/${property.id}`, label: property.name }]
            : []),
          { href: `/easements/${id}`, label: easement.name },
        ]}
        actions={
          <ActionLink href={`/map?focus=easement:${id}`} primary>
            View on map
          </ActionLink>
        }
      />

      <MapThumb
        geometry={easement.boundary_geojson ?? easement.geom_geojson}
        focus={`easement:${id}`}
      />

      <DetailsCard
        rows={[
          ["Easement type", easementTypeLabel(easement.easement_type)],
          [
            "Relationship",
            EASEMENT_RELATIONSHIP_LABELS[
              easement.relationship as keyof typeof EASEMENT_RELATIONSHIP_LABELS
            ] ?? easement.relationship,
          ],
          ["Holder", easement.holder],
          easement.geom_geojson
            ? [
                "Length",
                `${formatNumber(Math.round(easement.length_feet ?? 0))} ft (${Number(easement.miles ?? 0).toFixed(2)} mi)`,
              ]
            : ["Acres", formatAcres(easement.acres)],
          easement.geom_geojson && easement.width_ft != null
            ? ["Width", `${formatNumber(easement.width_ft)} ft (informational)`]
            : ["Width", null],
          ["Recorded ref", easement.recorded_ref],
          ["Expires", easement.expiration_date ?? "Permanent / indefinite"],
          [
            "Flowage elevation",
            easement.elevation_ft != null ? `${formatNumber(easement.elevation_ft)} ft` : null,
          ],
          ["Program / holder detail", easement.program],
          ["Restrictions", easement.restrictions],
          ["Notes", easement.notes],
        ]}
      />
      <RowEditor entityType="easement" row={easement} />

      <RelatedSection title="Documents">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="mb-2 text-xs text-gray-500">
            The recorded easement deed belongs here; it is exactly the
            document that gets lost. (Severed mineral rights are not an
            easement; a future encumbrances area will hold those.)
          </p>
          <EntityDocuments
            orgId={profile.organization_id!}
            entityType="easement"
            entityId={id}
          />
        </div>
      </RelatedSection>
    </div>
  );
}
