---
title: Import from county records
route: /import/county
group: Import
order: 1
updated: 2026-11-14
keywords: county, gis, parcels, owner search, parcel number, import, known entity, deeded acres, registry, ranked, best match, distant matches, merged outline, property boundary, duplicate, already exists, skip, update geometry, alabama, lawrence, colbert, morgan, lauderdale, limestone, madison, franklin
---
## What it does

Search a county's public parcel map by owner name or parcel number, preview the parcels on satellite, pick the ones that are yours, and import them with their boundaries, parcel numbers, and deeded acres already filled in. It is the fastest way to get land on the map.

## How to use it

- Pick the county. Only counties in the registry appear; the registry grows as counties are verified.
- Choose how to search. **All parcels for an owner** finds every way the county wrote a name and groups the parcels by owner. **Owner name** is a plain search (try the name as the county prints it, last name first). **Parcel number** takes the number in any format; separators like dots and dashes do not matter.
- In **All parcels for an owner**, results are ranked: groups matching your known entities pin to the top with the **Known entity** badge, then the closest matches to the name you typed. With a common surname, the distant matches fold behind one "Show N more distant matches" line (with their parcel and acre counts), so nothing is hidden, just deferred. A sort toggle (**Best match** or **Most acres**) and a **Hide 1-parcel owners** filter tidy the list further. Each group shows its name variants. **Not this owner** splits a variant out; tap **Merge** on two groups that are the same owner to join them.
- A very common name shows what was found with a note that more names matched than could be listed; add another word (a first name, or the company's second word) for the full picture. The other two searches show at most 200 parcels and say so.
- Tick **Include in import** on a group, or check single parcels in the list or tap them on the map.
- In the panel that appears, choose **Existing property** or **New property**, and pick the entity beside **Held by entity**. Creating a new entity, or a new property with no entity, is for admins.
- **Set property boundary to merged outline** makes the property's boundary the outline of all its parcels. The box starts ticked for a new property or one with no boundary yet. It starts unticked when the property already has a boundary, because the merged outline would replace it; tick it and a notice says so before you import.
- Tap **Confirm and import**. Parcels arrive with boundaries and deeded acres, and the page stays where it is so you can import the next batch. **Done, view on map** opens the map when you are finished.

## Parcels you already have

A selected parcel whose number is already in your records for that county is listed before you import, with two choices: **Skip** (the default) leaves your parcel alone, and **Update geometry** replaces your parcel's boundary and deeded acres with the county's. It is never added a second time. If two selected rows carry the same parcel number, one is imported and a note says how many were left out.

## Common questions

- **My county is not listed.** Upload a file instead (see Import files), draw by hand, or plot from a deed in Documents. Ask support to add the county; each one is verified live before it appears.
- **Acres say "est."** The county published no deeded acres for that parcel, so the figure is worked out from its boundary. A row that says "no boundary returned" cannot be imported.
- **The property's boundary did not change.** The merged outline is only set when its box is ticked during an import into that property. Otherwise draw or edit the boundary on the Map.
