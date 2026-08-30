import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import { ASSET_TYPES } from "@/lib/assetTypes";
import type { AssetGeo, AssetType } from "@/types/db";
import AssetDetail from "./AssetDetail";
import { MapThumb } from "@/components/summary/Summary";

export const metadata = { title: "Asset" };

export default async function AssetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, profile } = await requireOrg();

  const { data: asset } = await supabase
    .from("assets_geo")
    .select("*")
    .eq("id", id)
    .single();
  if (!asset) notFound();

  // Parent candidates come from the type registry (a pivot's supply
  // well, a bin's bin site); children are whatever links back here (a
  // site's bins, a well's pivots).
  const parentType = ASSET_TYPES[(asset as AssetGeo).asset_type]?.parentType ?? null;
  const [{ data: properties }, { data: parents }, { data: children }] =
    await Promise.all([
      supabase.from("properties").select("id, name").order("name"),
      parentType
        ? supabase
            .from("assets")
            .select("id, name")
            .eq("asset_type", parentType satisfies AssetType)
            .eq("is_active", true)
            .order("name")
        : Promise.resolve({ data: [] }),
      supabase
        .from("assets")
        .select("id, name, asset_type, details, is_active")
        .eq("parent_asset_id", id)
        .order("name"),
    ]);

  return (
    <>
      <div className="mx-auto max-w-5xl px-4 pt-4 md:px-6 md:pt-6">
        <MapThumb
          geometry={(asset as AssetGeo).geom_geojson}
          focus={`asset:${id}`}
        />
      </div>
      <AssetDetail
        asset={asset as AssetGeo}
        properties={properties ?? []}
        parentOptions={(parents ?? []).filter((w) => w.id !== id)}
        childAssets={children ?? []}
        orgId={profile.organization_id!}
      />
    </>
  );
}
