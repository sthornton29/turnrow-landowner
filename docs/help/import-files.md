---
title: Import files
route: /import
group: Import
order: 2
updated: 2026-09-26
keywords: import, upload, shapefile, zip, kml, kmz, geojson, boundaries, assign types, preview, suggested property, surveyor files, hunting club map, drag and drop, from the map
---
## What it does

Upload boundary files you already have: a zipped shapefile from a surveyor, a KML or KMZ from Google Earth, or GeoJSON. Each feature in the file is previewed, you say what it is, and it saves.

## From the map

You do not have to leave the Map. Tap **+ Add** and pick **Import a file** at the bottom of the picker, or drag the file from your computer and drop it anywhere on the map. The shapes appear on the satellite view in the color of what they will become (dashed, so they read as not yet saved), the map zooms to them, and a review panel on the right sets each one's type, name, and property, the same choices as this page. Uncheck a shape to leave it out; it fades on the map. **Save** writes them and they join the map right where they were previewed. Nothing is stored until you save; **Cancel** clears the preview.

## How to use it

- Drop the file in. Polygons can become a property, parcel, ag field, pasture/grassland, wetland, pollinator habitat, timber stand, or easement; lines become roads, pipes, fences, or line easements; points become assets with a type.
- Each row suggests the property that contains it (a "Suggested from location" chip). Confirm or change it. Properties in the same batch save first so other rows can attach to them.
- Rows that fail are skipped and listed so you can fix and retry them.

## Common questions

- **The file is in the wrong place on the map.** Some files carry a projection the app converts automatically (Web Mercator). If shapes land far away, export the file again in WGS84 (latitude and longitude).
- **Can I import a spreadsheet of acres?** Not here; this page needs shapes. Leases and taxes accept their own documents.
