// What a county import does to the boundary of the property the parcels
// go into, and where "View on map" lands afterward. Pure, so the rules
// are tested without the import screen.
//
// The map draws PROPERTY outlines; the Parcels layer starts off. A parcel
// imported into a property whose outline was left alone is saved with its
// county boundary but is nowhere to be seen on the map (2026-11-20, two
// parcels imported from the Property Taxes page). So a property that
// already has a boundary now GROWS to take new parcels in by default.

// merge: the boundary becomes the outline of ALL the property's parcels
//        (replaces whatever it had; the right start for a property with
//        no boundary of its own).
// add:   the new parcels are joined onto the boundary it has; nothing
//        already inside it changes.
// keep:  the boundary is left exactly as it is.
export type BoundaryMode = "merge" | "add" | "keep";

export function defaultBoundaryMode(targetHasOwnBoundary: boolean): BoundaryMode {
  return targetHasOwnBoundary ? "add" : "merge";
}

// The mode the import really runs. "add" needs a boundary to add to; for
// a property without one of its own it is the merged outline.
export function effectiveBoundaryMode(mode: BoundaryMode, targetHasOwnBoundary: boolean): BoundaryMode {
  return mode === "add" && !targetHasOwnBoundary ? "merge" : mode;
}

// The map's ?focus= value after an import. One parcel: that parcel, so the
// map zooms to it and outlines it (the selection outline shows even with
// the Parcels layer off). Several: the property they went into. Null when
// there is nothing to point at.
export function importMapFocus(parcelIds: string[], propertyId: string | null): string | null {
  const ids = Array.from(new Set(parcelIds.filter((id) => id)));
  if (ids.length === 1) return `parcel:${ids[0]}`;
  if (propertyId) return `property:${propertyId}`;
  return ids.length > 0 ? `parcel:${ids[0]}` : null;
}

// Where the import page sends the user back to when it was opened from
// another page's "Import this parcel" link. Only known pages, never a
// path taken from the URL as written.
export function importReturnTo(from: string | undefined, year: string | undefined): { href: string; label: string } | null {
  if (from !== "taxes") return null;
  const y = Number(year);
  const ok = Number.isInteger(y) && y >= 1900 && y <= 2200;
  return { href: ok ? `/taxes?year=${y}` : "/taxes", label: "Back to Property Taxes" };
}
