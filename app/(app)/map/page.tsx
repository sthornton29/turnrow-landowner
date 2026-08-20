import { requireOrg } from "@/lib/auth";
import type { EntityType } from "@/types/db";
import type { SelectedFeature } from "@/components/map/types";
import MapClient from "./MapClient";

export const metadata = { title: "Map" };

const ENTITY_TYPES: EntityType[] = [
  "property",
  "parcel",
  "field",
  "pasture",
  "wetland",
  "timber_stand",
  "road",
  "easement",
  "asset",
];

// /map?focus=asset:<id> selects and zooms to that entity after load.
export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string }>;
}) {
  const { supabase, profile } = await requireOrg();
  const { focus: focusParam } = await searchParams;
  const { data: org } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", profile.organization_id)
    .single();

  let focus: SelectedFeature | null = null;
  if (focusParam) {
    const [entityType, id] = focusParam.split(":");
    if (ENTITY_TYPES.includes(entityType as EntityType) && id) {
      focus = { entityType: entityType as EntityType, id };
    }
  }

  return (
    <MapClient
      orgId={profile.organization_id!}
      orgName={org?.name ?? null}
      focus={focus}
    />
  );
}
