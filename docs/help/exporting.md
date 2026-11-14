---
title: Exporting boundaries as KML or GeoJSON
route: /map
group: Map
order: 5
updated: 2026-11-14
keywords: export, download, kml, kmz, geojson, google earth, onx, shapefile, surveyor, share boundaries, send to tenant, farm software, gis, re-import
---
## What you can export

Every shape on the map can leave the app as a file: property and parcel boundaries, ag fields, pastures/grassland, wetlands, pollinator habitats, timber stands, cemeteries, roads, easements, assets, and maintenance issues. Two formats: **KML**, which opens in Google Earth, onX, and most mapping and farm software, and **GeoJSON** for GIS tools like QGIS and ArcGIS. Each shape carries its name, what it is, its acres or length, the property it sits on, and its details (parcel number and deeded acres, stand type and species, easement type and holder). A KML file is grouped in folders by kind and colored the way the map draws them.

## The whole map, or part of it

Tap **Export** in the pill at the top right (beside Print). The panel starts from exactly what the map shows: layers that are off and items hidden by Filter are already left out. Change your mind with the property chips (a whole property with everything on it; shown when you have more than one property), the **Choose items** list (single fields, stands, or assets), or the "N items left out" pill to include everything. While the panel is open the map drops whatever you leave out. Pick **KML** or **GeoJSON** and tap the **Download** button, which counts the items going in the file. The file is named after your organization and the date.

## One shape

Tap anything on the map and press **KML** in its panel. You get a file with just that shape, named after it. Handy for sending a tenant one field, or a surveyor one parcel.

## Common questions

- **Which format should I send?** KML unless the person asked for something else. GeoJSON is for GIS people.
- **Can I export a shapefile?** Not directly. Export KML or GeoJSON; QGIS (free) and most GIS tools convert either to a shapefile.
- **Will it import back in?** Mostly. Drop the same KML on the map, or on the Import page drop it on the **Tap to choose files** box or tap that box to choose it, and each shape comes back with its name, ready to be given a type and saved again. Areas can come back as a property, parcel, ag field, pasture/grassland, wetland, pollinator habitat, timber stand, or cemetery; lines as a road, underground pipe, or fence; points as assets. Easements and maintenance issues have no import type, so those would have to be drawn again.
- **Do hidden things export?** Not unless you include them. Export starts from the screen; use the item list to add anything the map is hiding. Items you add back from a layer that is switched off go in the file even though that layer stays hidden on the map.
