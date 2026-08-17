import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import type { AssetGeo } from "@/types/db";
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

  const [{ data: asset }, { data: properties }, { data: wells }] =
    await Promise.all([
      supabase.from("assets_geo").select("*").eq("id", id).single(),
      supabase.from("properties").select("id, name").order("name"),
      supabase
        .from("assets")
        .select("id, name")
        .eq("asset_type", "well")
        .eq("is_active", true)
        .order("name"),
    ]);
  if (!asset) notFound();

  return (
    <>
      <div className="mx-auto max-w-4xl px-4 pt-4 md:px-6 md:pt-6">
        <MapThumb
          geometry={(asset as AssetGeo).geom_geojson}
          focus={`asset:${id}`}
        />
      </div>
      <AssetDetail
        asset={asset as AssetGeo}
        properties={properties ?? []}
        wells={(wells ?? []).filter((w) => w.id !== id)}
        orgId={profile.organization_id!}
      />
    </>
  );
}
