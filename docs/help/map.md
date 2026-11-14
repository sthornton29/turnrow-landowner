---
title: The map
route: /map
group: Map
order: 1
updated: 2026-11-14
keywords: map, satellite, layers, legend, filter, hide, hidden, parcels, ag fields, pastures, grassland, cemeteries, wetlands, pollinator habitat, timber, roads, easements, assets, maintenance issues, click, panel, zoom, fullscreen, crops, by entity, labels, ag field names, export, kml, import, drop a file, phone, retry, delete property
---
## What this page is for

The Map is the first page you see after signing in: your properties on satellite imagery with every boundary and feature you have recorded. Tap anything to open its panel, edit its details, or jump to its full page.

## On a phone

The controls sit behind two buttons at the top left. **Layers** opens a panel with everything described below (layers, labels, Filter, the legends, Zoom all, Fullscreen); **Close** puts it away. **+ Add** is right beside it. While you are drawing or editing, Layers waits at the bottom left instead.

## Layers and legend

The Layers box (top left on a computer) turns each kind of thing on or off: Properties, Parcels, Ag Fields, Pastures/Grassland, Wetlands, Pollinator habitat, Timber, Cemeteries, Roads, Easements, and Assets. Below a rule sits a separate **Maintenance issues** toggle: problems you have marked (washes, sinkholes, broken terraces, road washouts) live on their own layer in warning colors and can be hidden without touching the land view. A **Labels** section holds two switches: **Property names** for the big property labels and **Ag field names** for every other name label (ag fields, pastures, timber, wetlands, pollinator habitats, cemeteries, roads, easements, parcels, assets, and maintenance issues). Turning a name switch off hides only the text; boundaries and markers stay. At the bottom, **Neighbors** overlays the surrounding tax parcels and owners from county records (see the Neighbors topic). Your choices are remembered on this device. Parcels start off because they clutter the view.

- **Cemeteries** are a muted violet with a "C" marker: at the center of a traced plot, or on its own for a single pin.
- **Timber types** get their own legend while the Timber layer is on (planted pine, natural pine, hardwood, mixed, other; only the types you have).
- **Easements** show a legend by family: Utility, Access / transport, Drainage / flowage, Conservation, and Other easements, listing only the families you have recorded. Railroads get a tie pattern, conservation easements a hatch.
- **Crops** appears when a connected tenant has shared this year's plantings on fields matched to your ag fields; it recolors ag fields by this year's crop.
- **By entity** appears when you have more than one entity; it recolors property outlines by owner.
- **Maintenance issues** are amber, red when marked high severity, and gray once resolved; a pin, or the center of a traced area, shows an exclamation mark. See the Maintenance issues topic.

## Tapping things

Tapping a feature opens a panel (a card on a computer, a sheet on a phone) with its acres or length, property, details, and notes. **View full page** opens its own page with documents (for a maintenance issue it opens the Maintenance list). The buttons depend on what you tapped:

- **Edit details** changes the name and the other fields. An asset has **Open asset page** and **Quick edit name and notes** instead.
- **Edit boundary**, **Edit line**, **Edit outline**, or **Move pin** changes the shape or the spot. See the Drawing topic.
- Special tools: **Split** for a timber stand, **Edit coverage** for a pivot, **Edit circle** for a round footprint, **Timber Scan** for a property, **Add photos** for a pollinator habitat (on a phone it opens the camera and files the pictures on the habitat's page), and **Mark resolved** or **Reopen** for a maintenance issue.
- **KML** downloads that one shape as a file for Google Earth or other mapping software.
- **Delete** removes the record after you confirm; for a parcel, ag field, or timber stand the confirmation says what goes with it. An asset has **Deactivate** instead, which keeps it in your records and takes it off the map.

On an ag field, pasture, timber stand, or anything else that sits on a property, the panel's Property row is a link: tap the name to open that property's own panel (acres, entity, tenant activity, its tools), or **Page** beside it to go straight to the property page.

A property is never deleted from the map, because deleting it removes everything on it. Its panel links to the property page (**Manage or delete this property** for an admin), where an admin sees the full list of what would go and types the property's name to confirm.

Where things overlap, a tap picks maintenance issues first, then assets, cemetery pins, roads, easements, ag fields, pastures/grassland, cemetery plots, wetlands, pollinator habitats, timber, parcels, and properties.

## Other controls

- **Zoom all** fits everything you own on screen.
- **Fullscreen** hides the app frame; **Exit full** brings it back.
- **Print** and **Export** share one pill at the top right while nothing is selected. Print makes a PDF of the framed area (see the Printing topic). Export downloads what the map shows as a KML or GeoJSON file (see the Exporting topic).
- **+ Add** opens one picker with everything addable (land, lines, assets, maintenance issues) and a filter box for a fast pick. See the Drawing and Assets topics. At the bottom of the picker, **Import a file** brings in shapes from a KML, KMZ, GeoJSON, or zipped shapefile instead of drawing them; on a computer you can also drag a file straight onto the map. See the Import files topic.
- **Filter** (under the Layers box) hides individual items from the map: tap property chips to hide a whole property with everything on it, or search the item list and uncheck single fields, stands, or assets. Hidden items leave the map and its labels, an amber "N hidden" pill offers one-tap clear, and your choices stick on this device. Layers stay the coarse control; Filter works within them.

## If the map does not load

On a weak signal a banner says the map could not load, with a **Retry** button. Whatever was already on the map stays while you retry. If the satellite picture itself cannot load, the banner offers **Reload** instead.

## Common questions

- **Why do my acres differ from the deed?** Map acres are computed from the drawn shape. County records often carry deeded acres that differ slightly; a parcel's panel shows both when the county supplied them.
- **A label is hiding something.** Turn off **Ag field names** or **Property names** under Labels while you work. The shapes stay.
- **Can I see last year's crop?** The Crops layer shows the current year only; the Farm Data page shows earlier years.
- **How do I delete a property?** From the property page, not the map, and only as an admin. See "Tapping things" above.
