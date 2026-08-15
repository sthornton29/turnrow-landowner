import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import TimberSaleDetail from "./TimberSaleDetail";

export const metadata = { title: "Timber sale" };

export default async function TimberSaleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, profile } = await requireOrg();

  const [{ data: sale }, { data: tenants }, { data: stands }] = await Promise.all([
    supabase.from("timber_sales").select("*").eq("id", id).single(),
    supabase.from("tenants").select("id, name").order("name"),
    supabase
      .from("timber_stands")
      .select("id, property_id, name, acres")
      .order("name"),
  ]);
  if (!sale) notFound();

  return (
    <TimberSaleDetail
      orgId={profile.organization_id!}
      sale={sale}
      tenants={tenants ?? []}
      allStands={stands ?? []}
    />
  );
}
