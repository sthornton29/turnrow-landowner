---
title: Properties, parcels, and entities
route: /properties
group: Properties
order: 1
updated: 2026-11-14
keywords: property, parcel, entity, llc, trust, held by, fsa farm number, also called, deeded acres, gis acres, no boundary yet, move to another property, delete property, new property, county, state, notes, income allocated
---
## Properties and parcels

A **property** is a piece of land you think of as one place (the home place, the river farm). Each has a boundary, county and state, optional FSA farm numbers, notes, and any other names deeds use for it (**Also called**). **Parcels** are the county's tax parcels inside it, each with a parcel number, its own boundary, and deeded acres when the county supplied them. Tax statements match to parcels, so keeping parcel numbers accurate pays off at tax time.

The Properties page lists every property with its acres, county, and its counts of parcels and ag fields. Once entities exist the list is grouped **By entity**; **All** shows one plain list. Admins add a property with **+ New property**. A property made this way has no boundary until one is drawn or imported.

## The property page

- At the top: the name, county and state, acres, **Held by** (the entity that holds it), **Edit**, **Also called**, **Timber Scan**, and **View on map**.
- **FSA farm numbers**, a picture of the boundary, and a base acres and government payments card once an FSA farm is linked to the property.
- Lists of what is on the property: Parcels, Ag fields, Wetlands, Pollinator habitats, Pastures/Grassland, Cemeteries, Timber stands, Roads, Easements, and Assets. Tap a name to open its page.
- **Income allocated to this property**: expected, received, taxes paid, and net by year, with **Earlier years** behind a tap.

Leases, tax statements, and documents are not listed on the property page. Find them on the Leases, Property Taxes, and Documents pages.

## Entities

Under Properties then **Entities**, admins create the owners of record: Individual, LLC, Corporation, Partnership, Trust, Estate, or Other. Set each property's entity with **Held by** on the property page. A property with no entity is visible to admins only, because other members see land through the entities shared with them. Home, Income, and Government Payments can be filtered by entity. See the Entities topic.

## Moving things between properties

On the property page, under each list of parcels, ag fields, wetlands, pollinator habitats, pastures/grassland, cemeteries, timber stands, roads, and assets, a link such as **Move parcels to another property** opens a checklist. Tick the items, pick the property, and tap **Move**. Boundaries and acres stay as they are; only the property the items belong to changes, and property outlines are not redrawn. The link shows only when there is something to move and another property to move it to. Easements have no Move link.

## Deleting a property

Only admins can delete a property, with **Delete this property...** at the bottom of its page. Deleting removes the property and everything on it, and the page lists exactly what will go before you confirm:

- **Deleted with it:** parcels (with their tax identifiers, valuation history, and valuation notices), ag fields, pastures/grassland, wetlands, pollinator habitats, timber stands, roads, assets, cemeteries, timber activity and cost records, timber basis accounts, cost-share awards and their payments, and Timber Scan results.
- **Kept, but no longer tied to any property:** easements, maintenance issues, and income records. Members who are not admins stop seeing these.
- **Kept:** leases, payments, timber sales, FSA farms, tax statements, tax payments, and documents. Their links to this property are removed, a tax statement line for a deleted parcel shows as not matched, and farm software fields matched to this property become unmatched.

To confirm, type the property's name and tap **Delete this property and everything listed**. This cannot be undone, so move anything you want to keep to another property first.

## Acres

- **Map acres** are computed from the drawn boundary and shown to one decimal. They change whenever the shape changes.
- **Deeded acres** come from the county record and are shown beside map acres on parcels.
- **Irrigated acres** on an ag field are the part covered by pivot coverage circles; the rest is dryland.
- A property with no outline reads **No boundary yet** in place of acres. When a property's outline and its parcels differ by more than 5 percent, the property page says so, because one of the two is usually out of date.

## Common questions

- **A property reads No boundary yet.** Open the property, tap **View on map**, then **Edit boundary** in its panel and draw the outline. Or import its parcels from county records with **Set property boundary to merged outline** ticked, or plot it from a deed in Documents.
- **Can one property belong to two entities?** No. Split it into two properties if ownership is split.
- **What are FSA numbers for?** They tie the property to USDA farm records and show on the map panel and the property page. A scanned FSA-156EZ uses them to link its farms and base acres to the right property. Government Payments has its own FSA farm records with base acres.
- **Can I delete a property from the map?** No. The map panel links to the property page, where an admin deletes it.
