---
title: Import from county records
route: /import/county
group: Import
order: 1
updated: 2026-11-20
keywords: county, gis, parcels, owner search, parcel number, import, known entity, deeded acres, registry, ranked, best match, distant matches, merged outline, property boundary, add to boundary, not on the map, parcels layer, duplicate, already exists, skip, update geometry, alabama, lawrence, colbert, morgan, lauderdale, limestone, madison, franklin
---
## What it does

Search a county's public parcel map by owner name or parcel number, preview the parcels on satellite, pick the ones that are yours, and import them with their boundaries, parcel numbers, and deeded acres already filled in. It is the fastest way to get land on the map.

## How to use it

- Pick the county. Only counties in the registry appear; the registry grows as counties are verified.
- Choose how to search. **All parcels for an owner** finds every way the county wrote a name and groups the parcels by owner. **Owner name** is a plain search (try the name as the county prints it, last name first). **Parcel number** takes the number in any format; separators like dots and dashes do not matter.
- In **All parcels for an owner**, results are ranked: groups matching your known entities pin to the top with the **Known entity** badge, then the closest matches to the name you typed. With a common surname, the distant matches fold behind one "Show N more distant matches" line (with their parcel and acre counts), so nothing is hidden, just deferred. A sort toggle (**Best match** or **Most acres**) and a **Hide 1-parcel owners** filter tidy the list further. Each group shows its name variants. **Not this owner** splits a variant out; tap **Merge** on two groups that are the same owner to join them.
- A very common name shows what was found with a note that more names matched than could be listed; add another word (a first name, or the company's second word) for the full picture. The other two searches show at most 200 parcels and say so.
- Tick **Include in import** on a group, or check single parcels in the list or tap them on the map.
- In the panel that appears, choose **Existing property** or **New property**, and pick the entity beside **Held by entity**. **New property** and **Create new entity...** are offered to admins only. Other members add parcels to a property that already exists; with no property yet, the panel says an admin has to create one first.
- Choose what happens to the property's boundary. The map draws property outlines (the Parcels layer starts switched off), so a parcel shows on the map as part of a property only when the property's boundary takes it in.
  - A new property, or one with no boundary yet, shows the **Set property boundary to merged outline** box, ticked: the boundary becomes the outline of all its parcels.
  - A property that already has a boundary shows **Property boundary** with three choices. **Add these parcels to it** (the default) grows the boundary to take in the new parcels and changes nothing already inside it; a parcel the boundary already covers leaves it as it is. **Replace it with the outline of all its parcels** discards the boundary it has, and a notice says so before you import. **Leave it as it is** saves the parcels without touching the boundary; they then show on the map only while the Parcels layer is on.
  - The boundary changes only when the import adds a parcel to that property or updates one of that property's own parcels.
- Tap **Confirm and import**. Parcels arrive with boundaries and deeded acres, and the page stays where it is so you can import the next batch. **View on map** zooms to the parcel you just imported (or to the property when you imported several), and **Done, view on map** opens the map when you are finished. If you came from **Import this parcel** on the Property Taxes page, **Back to Property Taxes** returns you to the line, which now has the new parcel picked.

## Parcels you already have

A selected parcel whose number is already in your records for that county is listed before you import, with two choices: **Skip** (the default) leaves your parcel alone, and **Update geometry** replaces your parcel's boundary and deeded acres with the county's. It is never added a second time. If two selected rows carry the same parcel number, one is imported and a note says how many were left out.

## Common questions

- **My county is not listed.** Upload a file instead (see Import files), draw by hand, or plot from a deed in Documents. Ask support to add the county; each one is verified live before it appears.
- **Acres say "est."** The county published no deeded acres for that parcel, so the figure is worked out from its boundary. A row that says "no boundary returned" cannot be imported.
- **A parcel I imported is not on the map.** It is saved, but its property's boundary was left as it was, and the map draws property outlines. Tick **Parcels** in the map's Layers panel to see every parcel. To make it part of the property's outline, search for the parcel here again, pick the property it is on, choose **Update geometry** beside it, and import with **Add these parcels to it** selected.
- **The property's boundary did not change.** It changes only when the import adds a parcel to that property or updates one of its own parcels, and not when **Leave it as it is** is chosen or the box is unticked. A parcel the boundary already covers adds nothing to it. An import that only updates a parcel on a different property leaves the chosen property's boundary alone. Otherwise draw or edit the boundary on the Map.
