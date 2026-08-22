---
title: Import files
route: /import
group: Import
order: 2
updated: 2026-08-20
keywords: import, upload, shapefile, zip, kml, kmz, geojson, boundaries, assign types, preview, suggested property, surveyor files, hunting club map
---
## What it does

Upload boundary files you already have: a zipped shapefile from a surveyor, a KML or KMZ from Google Earth, or GeoJSON. Each feature in the file is previewed, you say what it is, and it saves.

## How to use it

- Drop the file in. Polygons can become a property, parcel, ag field, pasture/grassland, wetland, timber stand, or easement; lines become roads, pipes, fences, or line easements; points become assets with a type.
- Each row suggests the property that contains it (a "Suggested from location" chip). Confirm or change it. Properties in the same batch save first so other rows can attach to them.
- Rows that fail are skipped and listed so you can fix and retry them.

## Common questions

- **The file is in the wrong place on the map.** Some files carry a projection the app converts automatically (Web Mercator). If shapes land far away, export the file again in WGS84 (latitude and longitude).
- **Can I import a spreadsheet of acres?** Not here; this page needs shapes. Leases and taxes accept their own documents.
