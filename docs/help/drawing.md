---
title: Drawing boundaries, roads, and easements
route: /map
group: Map
order: 2
updated: 2026-11-14
keywords: draw, boundary, polygon, line, add, filter, property boundary, parcel, ag field, timber stand, pasture, grassland, cemetery, wetland, pollinator habitat, road, fence, pipe, easement, maintenance issue, wash, sinkhole, terrace, washout, multi-area, add area, cut area, discard shape, cancel, escape, edit boundary, move point, delete point, split, held by, choose a property
---
## Pick first, then draw

Tap **+ Add**. One picker holds everything addable, in groups: **Land and boundaries** (Property boundary, Parcel, Ag field, Timber stand, Pasture/Grassland, Wetland, Pollinator habitat, Cemetery with Draw the plot or Drop a pin), **Lines and corridors** (Road, Easement with Line or Area, Fence), **Assets** (see the Assets topic), under **Needs attention**, a Maintenance issue, and last, under **From a file**, **Import a file** for shapes you already have as a KML, KMZ, GeoJSON, or zipped shapefile (see the Import files topic). A filter box at the top narrows the list as you type. Property boundary is offered to admins only, because creating a property is admin work.

Once you pick, the right tool loads, the shape you draw shows in that type's color, and the save form already knows what it is, with its extra fields visible from the start (stand type and species for timber, easement type and holder for easements). The type stays fixed for that session; to draw something else, finish or cancel and start again.

## Drawing a shape

- Tap the map to place points. Double tap the last point to finish.
- **Discard shape** (or the Escape key) removes only the shape you are tracing. Finished areas and everything typed in the form stay.
- **Cancel** ends the whole session. If finished areas exist it asks first, so a mistap never throws away minutes of tracing.

## The save form

- **Property.** A parcel, ag field, pasture, wetland, pollinator habitat, timber stand, cemetery, or road must be given a property. The form starts on the property you drew inside (a "Suggested from location" chip); when the shape sits inside none, you choose one. Change it if the guess is wrong.
- **Easements, assets, fences, pipes, and maintenance issues** may be saved with no property by an admin. Other members must choose one. A record with no property is visible to admins only.
- **A new property** asks **Held by** once you have created an entity: pick the entity that holds it, or No entity. Family members who are not admins see a property only through its entity, so a property saved with No entity is visible to admins only.
- **Save** stores it; **Discard** throws the drawing away (it asks first for a traced area).

## Several areas in one record

After the first area is finished, the save form offers **+ Add area** and **Cut area out**. Add draws another polygon that merges in (areas do not need to touch). Cut draws a hole (a pond, a house lot). The form stays as you left it while you draw more.

## Cemeteries

A family or church plot is usually small. Trace its edge when you know it (the plot shows acres like any land type) or drop a single pin on the marker. Either way it gets its own violet look and a "C" marker so it stays findable when zoomed out.

## Pollinator habitats

A pollinator habitat is wildflowers and native grasses planted or managed for bees, butterflies, and other pollinators: a CRP CP-42 planting, an EQIP practice, a monarch waystation, a field border, or a corner taken out of production. Draw it like any other land area; **Edit details** then records the program, the year it went in, and the seed mix. Photos are the point of the record: the map panel and the habitat's page both have an **Add photos** button (on a phone the map panel's opens the camera), so you can shoot the stand each season, and the pictures collect in the gallery on its page.

## Maintenance issues

Problems that need fixing are not land, so they have their own layer. Pick **Maintenance issue**, then the type (wash, sinkhole, broken terrace, road washout, or other with a label), then how to mark it: a **Pin** for a spot, a **Line** along a terrace or ditch, or an **Area** you trace. Give it a severity if you like. Issues draw in amber (red for high severity) and gray once resolved; tap one and press **Mark resolved**, or work the list on the Maintenance page. The Layers box hides or shows them separately from everything else.

## Editing later

Tap a feature and choose **Edit boundary** or **Edit line**. The shape shows its points:

- **Drag a point** to move it.
- **Tap a point, then press Delete point** to take it out. An area keeps at least three points and a line two.
- **Press the small dot halfway between two points** to add a new point there.
- **Dragging anywhere else moves the map**, not the shape. A boundary is never slid as a whole, so a stray swipe cannot move your property line.
- **Add area** and **Cut area** on the toolbar make bigger changes to an area.

Press **Save** when it looks right, or **Cancel** to leave it as it was. Timber stands also offer **Split**: draw a line all the way across the stand, confirm, and it becomes two stands with the details copied.

## Common questions

- **Line or area for an easement?** A line when you know the centerline (a powerline, an access lane); it shows length, and width is a note. An area when you know the strip, the flowage pool, or the conservation tract; it shows acres.
- **Where did Pipe and Fence go?** Fence is under Lines and corridors and Underground pipe under Assets; both draw as lines. Your own buried irrigation pipe is an asset; a pipeline company's corridor is an easement.
- **The wrong type is selected.** Cancel the session and pick again. The type cannot change mid-session on purpose.
- **It will not let me save without a property.** That is on purpose: what family members can see follows the property. Pick the property the shape belongs to.
