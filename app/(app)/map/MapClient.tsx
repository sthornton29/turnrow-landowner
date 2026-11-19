"use client";

import dynamic from "next/dynamic";
import type { SelectedFeature } from "@/components/map/types";

// Mapbox GL touches browser-only APIs, so the map loads client-side only.
const MapView = dynamic(() => import("@/components/map/MapView"), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-x-0 top-(--header-h) bottom-(--nav-h) flex items-center justify-center text-sm text-gray-500">
      Loading map...
    </div>
  ),
});

export default function MapClient({
  orgId,
  orgName,
  focus,
  isAdmin,
}: {
  orgId: string;
  orgName: string | null;
  focus: SelectedFeature | null;
  isAdmin: boolean;
}) {
  if (!process.env.NEXT_PUBLIC_MAPBOX_TOKEN) {
    return (
      <div className="p-8 text-sm text-red-600">
        NEXT_PUBLIC_MAPBOX_TOKEN is not set. Add it to .env.local and restart.
      </div>
    );
  }
  return <MapView orgId={orgId} orgName={orgName} focus={focus} isAdmin={isAdmin} />;
}
