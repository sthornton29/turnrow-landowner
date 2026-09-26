---
title: Exporting boundaries as KML or GeoJSON
route: /map
group: Map
order: 5
updated: 2026-09-26
keywords: export, download, kml, kmz, geojson, google earth, onx, shapefile, surveyor, share boundaries, send to tenant, farm software, gis
---
## What you can export

Every shape on the map can leave the app as a file: property and parcel boundaries, ag fields, pastures/grassland, wetlands, pollinator habitats, timber stands, cemeteries, roads, easements, assets, and maintenance issues. Two formats: **KML**, which opens in Google Earth, onX, and most farm and mapping software, and **GeoJSON** for GIS tools like QGIS and ArcGIS. Each shape carries its name, what it is, its acres or length, the property it sits on, and its details (parcel number and deeded acres, stand type and species, easement type and holder). The file is grouped in folders by kind, colored the way the map draws them.

## The whole map, or part of it

Tap **Export** in the pill at the top right (beside Print). The panel starts from exactly what the map shows: layers that are off and items hidden by Filter are already left out. Change your mind with the property chips (a whole property with everything on it), the **Choose items** tree (single fields, stands, or assets), or the "N items left out" pill to include everything. The map follows your choices while the panel is open, so what you see is what goes in the file. Pick the format and tap **Download**. The file is named after your organization and the date.

## One shape

Tap anything on the map and press **KML** in its panel. You get a file with just that shape, named after it. Handy for sending a tenant one field, or a surveyor one parcel.

## Common questions

- **Which format should I send?** KML unless the person asked for something else. Google Earth, onX Hunt, most farm software, and every surveyor read it. GeoJSON is for GIS people.
- **Can I export a shapefile?** Not directly. Export KML or GeoJSON; QGIS (free) and most GIS tools convert either to a shapefile in a few clicks.
- **Will it re-import cleanly?** Yes. Drop the same KML back on the map or on the Import page and each shape comes back with its name, ready to be typed and saved again.
- **Do hidden things export?** Not unless you include them. Export starts from the screen; use the item tree to add anything the map is hiding.
