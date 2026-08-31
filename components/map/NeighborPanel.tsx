"use client";

import Link from "next/link";
import { formatAcres } from "@/lib/format";

// A tapped parcel from the Neighbors overlay: public county records,
// rendered live and never saved. The two actions hand off to the
// existing county import flow (which enforces the user's permissions).
export interface NeighborInfo {
  owner_name: string;
  parcel_number: string;
  deeded_acres: number | null;
  computed_acres: number | null;
  situs: string | null;
  service_id: string;
}

export interface NeighborServiceInfo {
  id: string;
  county: string;
  state: string;
  display_name: string;
}

export default function NeighborPanel({
  neighbor,
  service,
  fetchedAt,
  onClose,
}: {
  neighbor: NeighborInfo;
  service: NeighborServiceInfo | null;
  fetchedAt: Date | null;
  onClose: () => void;
}) {
  const importHref = (mode: "parcel" | "entity", q: string) =>
    `/import/county?service=${encodeURIComponent(neighbor.service_id)}&mode=${mode}&q=${encodeURIComponent(q)}&run=1`;
  const acresLine =
    neighbor.deeded_acres !== null
      ? `${formatAcres(neighbor.deeded_acres)} deeded acres`
      : neighbor.computed_acres !== null
        ? `${formatAcres(neighbor.computed_acres)} acres est.`
        : null;
  return (
    <div className="pointer-events-auto fixed inset-x-0 bottom-16 z-30 max-h-[55%] overflow-y-auto rounded-t-2xl border-t border-gray-200 bg-white p-4 shadow-2xl md:absolute md:inset-auto md:right-4 md:top-4 md:bottom-auto md:max-h-[calc(100%-2rem)] md:w-80 md:rounded-xl md:border">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            Neighboring parcel
          </p>
          <p className="mt-0.5 text-base font-semibold text-gray-900">
            {neighbor.owner_name || "Owner not recorded"}
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
            <path d="M6.28 6.28a.75.75 0 0 1 1.06 0L10 8.94l2.66-2.66a.75.75 0 1 1 1.06 1.06L11.06 10l2.66 2.66a.75.75 0 1 1-1.06 1.06L10 11.06l-2.66 2.66a.75.75 0 0 1-1.06-1.06L8.94 10 6.28 7.34a.75.75 0 0 1 0-1.06Z" />
          </svg>
        </button>
      </div>
      <div className="mt-2 space-y-1 text-sm text-gray-700">
        {neighbor.parcel_number ? <p>Parcel {neighbor.parcel_number}</p> : null}
        {acresLine ? <p>{acresLine}</p> : null}
        {neighbor.situs ? <p>{neighbor.situs}</p> : null}
      </div>
      <div className="mt-3 space-y-2">
        {neighbor.parcel_number ? (
          <Link
            href={importHref("parcel", neighbor.parcel_number)}
            className="block w-full rounded-lg bg-kelly-500 px-3 py-2 text-center text-sm font-semibold text-white hover:bg-kelly-600"
          >
            Import this parcel
          </Link>
        ) : null}
        {neighbor.owner_name ? (
          <Link
            href={importHref("entity", neighbor.owner_name)}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-center text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Find all parcels for this owner
          </Link>
        ) : null}
      </div>
      <p className="mt-3 text-[11px] text-gray-400">
        Public records via {service ? `${service.county} County, ${service.state} GIS` : "the county GIS"}
        {fetchedAt ? `, fetched ${fetchedAt.toLocaleDateString()}` : ""}. Not
        saved to your records.
      </p>
    </div>
  );
}
