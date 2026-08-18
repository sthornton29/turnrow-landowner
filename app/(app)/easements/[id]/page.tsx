import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import { formatAcres, formatNumber } from "@/lib/format";
import { EASEMENT_TYPE_LABELS, easementAcres } from "@/lib/assetTypes";
import {
  ActionLink,
  DetailsCard,
  MapThumb,
  RelatedSection,
  SummaryHeader,
} from "@/components/summary/Summary";
import EntityDocuments from "@/components/documents/EntityDocuments";
import RowEditor from "@/components/lists/RowEditor";

export const metadata = { title: "Utility easement" };

export default async function EasementSummaryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, profile } = await requireOrg();

  const { data: easement } = await supabase
    .from("utility_easements_geo")
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

  const acres = easementAcres(easement.length_feet, easement.width_ft);

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 md:p-6">
      <SummaryHeader
        typeLabel={EASEMENT_TYPE_LABELS[easement.easement_type] ?? "Utility easement"}
        name={easement.name}
        keyFigure={
          `${formatNumber(Math.round(easement.length_feet ?? 0))} ft (${(easement.miles ?? 0).toFixed(2)} mi)` +
          (acres !== null ? ` · ${formatAcres(acres)} corridor acres` : "")
        }
        breadcrumb={[
          { href: "/properties", label: "Properties" },
          ...(property
            ? [{ href: `/properties/${property.id}`, label: property.name }]
            : []),
          { href: `/easements/${id}`, label: easement.name },
        ]}
        actions={
          <ActionLink href={`/map?focus=utility_easement:${id}`} primary>
            View on map
          </ActionLink>
        }
      />

      <MapThumb geometry={easement.geom_geojson} focus={`utility_easement:${id}`} />

      <DetailsCard
        rows={[
          [
            "Easement type",
            EASEMENT_TYPE_LABELS[easement.easement_type] ?? easement.easement_type,
          ],
          ["Holder", easement.holder],
          ["Length", `${formatNumber(Math.round(easement.length_feet ?? 0))} ft`],
          [
            "Corridor width",
            easement.width_ft != null ? `${formatNumber(easement.width_ft)} ft` : null,
          ],
          ["Corridor acres", acres !== null ? formatAcres(acres) : null],
          ["Recorded ref", easement.recorded_ref],
          ["Notes", easement.notes],
        ]}
      />
      <RowEditor entityType="utility_easement" row={easement} />

      <RelatedSection title="Documents">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="mb-2 text-xs text-gray-500">
            The recorded easement deed belongs here; it is exactly the
            document that gets lost.
          </p>
          <EntityDocuments
            orgId={profile.organization_id!}
            entityType="utility_easement"
            entityId={id}
          />
        </div>
      </RelatedSection>
    </div>
  );
}
