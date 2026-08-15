import { requireOrg } from "@/lib/auth";
import type { AssetGeo } from "@/types/db";
import AssetsList from "./AssetsList";

export const metadata = { title: "Assets" };

export default async function AssetsPage() {
  const { supabase } = await requireOrg();

  const [{ data: assets }, { data: properties }] = await Promise.all([
    supabase.from("assets_geo").select("*").order("name"),
    supabase.from("properties").select("id, name").order("name"),
  ]);

  return (
    <AssetsList
      assets={(assets as AssetGeo[]) ?? []}
      properties={properties ?? []}
    />
  );
}
