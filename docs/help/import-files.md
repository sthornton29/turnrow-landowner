---
title: Import files
route: /import
group: Import
order: 2
updated: 2026-11-14
keywords: import, upload, shapefile, zip, kml, kmz, geojson, boundaries, assign types, preview, suggested property, surveyor files, hunting club map, drag and drop, from the map, latitude and longitude, wgs 84, epsg 4326, not in latitude and longitude, state plane
---
## What it does

Upload boundary files you already have: a zipped shapefile from a surveyor, a KML or KMZ from Google Earth, or GeoJSON. Each shape in the file is previewed, you say what it is, and it saves. Nothing is stored until you save.

## From the map

You do not have to leave the Map. Tap **+ Add** and pick **Import a file** at the bottom of the picker, or drag the file from your computer and drop it anywhere on the map. The shapes appear on the satellite view in the color of what they will become (dashed, so they read as not yet saved), the map zooms to them, and a review panel (on the right on a computer, a sheet at the bottom on a phone) sets each one's type, name, and property, the same choices as this page. Uncheck a shape to leave it out; it fades on the map. The save button (it reads **Save 3 features** when three shapes are checked) writes them and they join the map right where they were previewed. **+ Add another file** adds more shapes to the same review. **Cancel** clears the preview.

## On the Import page

- Tap **Tap to choose files** and pick one or more files, or on a computer drag the files onto that box and drop them.
- Say what each shape is. An area can become a Property, Parcel, Ag field, Pasture/Grassland, Wetland (open), Pollinator habitat, Timber stand, or Cemetery. A line can become a Road, Underground pipe, or Fence. A point becomes an asset of the type you pick. Only admins are offered Property.
- Give each one a name. For a parcel the name is its parcel number.
- Each row suggests the property that contains it (a **Suggested from location** chip). Confirm or change it. Everything except a new property and an asset must be assigned to a property. Properties in the same batch save first so other rows can attach to them.
- Uncheck a row to leave it out, then tap the save button. Rows that fail are listed with the reason and stay on the page so you can fix and retry them. Rows that saved are not saved twice.

## Common questions

- **It says the file is not in latitude and longitude.** The app only takes coordinates in latitude and longitude. Export the file again as WGS 84 (EPSG:4326) and try again. A zipped shapefile that includes its .prj file is converted for you. When only some shapes in a file are off, the good ones still come in and a note says how many were skipped.
- **Can I import an easement?** Not from a file. Draw it on the Map with **+ Add**, then Easement.
- **Can I import a spreadsheet of acres?** Not here; this page needs shapes. Leases and taxes accept their own documents.
