"use client";

import dynamic from "next/dynamic";

// Mapbox GL touches browser-only APIs, so the map loads client-side only.
const MapView = dynamic(() => import("@/components/map/MapView"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[calc(100dvh-3.5rem-4rem)] items-center justify-center text-sm text-gray-500 md:h-[calc(100dvh-3.5rem)]">
      Loading map...
    </div>
  ),
});

export default function MapClient({ orgId }: { orgId: string }) {
  if (!process.env.NEXT_PUBLIC_MAPBOX_TOKEN) {
    return (
      <div className="p-8 text-sm text-red-600">
        NEXT_PUBLIC_MAPBOX_TOKEN is not set. Add it to .env.local and restart.
      </div>
    );
  }
  return <MapView orgId={orgId} />;
}
