import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import type { AssetGeo } from "@/types/db";
import AssetDetail from "./AssetDetail";

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
    <AssetDetail
      asset={asset as AssetGeo}
      properties={properties ?? []}
      wells={(wells ?? []).filter((w) => w.id !== id)}
      orgId={profile.organization_id!}
    />
  );
}
