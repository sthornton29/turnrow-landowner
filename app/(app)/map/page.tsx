import { requireOrg } from "@/lib/auth";
import MapClient from "./MapClient";

export const metadata = { title: "Map" };

export default async function MapPage() {
  const { profile } = await requireOrg();
  return <MapClient orgId={profile.organization_id!} />;
}
