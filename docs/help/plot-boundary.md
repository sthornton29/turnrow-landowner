---
title: Plotting a boundary from a deed
route: /documents
group: Documents
order: 2
updated: 2026-08-20
keywords: plot, deed, legal description, aliquot, quarter, section, township, range, meridian, plss, metes and bounds, calls, bearing, distance, chains, poles, curve, closure, error of closure, force close, point of beginning, rotate, georeference, deeded acres, replace boundary, new parcel
---
## Two kinds of descriptions

- **Aliquot parts**: "the NW quarter of the SE quarter of Section 12, Township 4 South, Range 8 West." The app finds that section on the public survey grid, subdivides it by quarters and halves, unions the parts, subtracts any "less and except" parts, and lands a boundary on the map directly.
- **Metes and bounds**: a starting point and a chain of calls, "thence N 45 degrees 30 minutes E 660 feet." The app reads the calls into a table you can correct, plots the shape, and you place it on the map.

## The steps

- **Read**: the description is extracted from the document and shown for review, amber where unsure. Fix tracts or calls in the table. Bearings that cannot be read are flagged red.
- **Resolve or plot**: aliquot tracts resolve against the survey grid (if the meridian is unknown you pick among candidates). Metes and bounds calls plot into a shape with the **error of closure** shown up front: the gap between where the last call ends and the starting point, as feet and as a ratio. Green is 1:5,000 or better, amber down to 1:1,000, red worse. **Force close** spreads the gap across the courses and is labeled as an adjustment.
- **Place** (metes and bounds only): pin the point of beginning on the satellite map, drag it to fit, and nudge the rotation a fraction of a degree if the deed's basis of bearing differs from true north. The shape follows live.
- **Preview and save**: the plotted boundary overlays the current one with acres side by side (plotted, current, deeded). Save it as a new property or parcel, or replace an existing boundary after a confirmation that states the old acres. The document remembers which boundary it produced.

## Honest limitations

Plot quality follows description quality. Old deeds omit curves, mix units, or reference monuments that no longer exist. Aliquot math assumes regular sections; government lots along rivers and township lines are approximations. Closure is shown, never hidden. When the county's parcel map agrees with your records, Import from county records is faster and usually better. Nothing here replaces a licensed survey.

## Common questions

- **The shape is mirrored or spun.** Check bearing quadrants (N 45 E vs N 45 W) in the calls table, then use the rotation control for small differences.
- **Units?** Feet, chains (66 ft), poles or rods (16.5 ft), links, varas, and meters are all understood; pick the unit per call when the deed mixes them.
