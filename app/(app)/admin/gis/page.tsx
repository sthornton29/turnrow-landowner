import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import AdminGisClient from "./AdminGisClient";

export const metadata = { title: "GIS services" };

export default async function AdminGisPage() {
  const { supabase, profile } = await requireOrg();
  if (!profile.is_platform_admin) redirect("/dashboard");

  const { data: services } = await supabase
    .from("county_gis_services")
    .select("*")
    .order("state")
    .order("county");

  return <AdminGisClient initialServices={services ?? []} />;
}
