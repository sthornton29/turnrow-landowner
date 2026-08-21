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
- **Resolve or plot**: aliquot tracts resolve against the survey grid. Before anything is fetched you see the reference as fields, not prose: the county the deed states, the principal meridian that county sits in, township number and N or S, range number and E or W, the section, and the aliquot parts as ordered chips (largest division first, each next chip a part of the one before). Fix a misread letter or digit there. After the lookup, two checks run: the resolved section must sit in the deed's county (a failure is a red flag with one-tap retries), and a section far from all your boundaries gets a distance warning. Metes and bounds calls plot into a shape with the **error of closure** shown up front: the gap between where the last call ends and the starting point, as feet and as a ratio. Green is 1:5,000 or better, amber down to 1:1,000, red worse. **Force close** spreads the gap across the courses and is labeled as an adjustment.
- **Place** (metes and bounds only): pin the point of beginning on the satellite map, drag it to fit, and nudge the rotation a fraction of a degree if the deed's basis of bearing differs from true north. The shape follows live.
- **Preview and save**: the plotted boundary overlays the current one with acres side by side (plotted, current, deeded). Save it as a new property or parcel, or replace an existing boundary after a confirmation that states the old acres. The document remembers which boundary it produced.

## Honest limitations

Plot quality follows description quality. Old deeds omit curves, mix units, or reference monuments that no longer exist. Aliquot math assumes regular sections; government lots along rivers and township lines are approximations. Closure is shown, never hidden. When the county's parcel map agrees with your records, Import from county records is faster and usually better. Nothing here replaces a licensed survey.

## Common questions

- **The shape is mirrored or spun.** Check bearing quadrants (N 45 E vs N 45 W) in the calls table, then use the rotation control for small differences.
- **Units?** Feet, chains (66 ft), poles or rods (16.5 ft), links, and meters are understood; pick the unit per call when the deed mixes them. Varas are not converted (the vara differs by state and era); convert those calls to feet first.

## Why did my plot land in the wrong place?

Almost always one of two things, and the app now guards against both.

- **The wrong survey (meridian).** Township and range numbers repeat across a state. Alabama has three main surveys: Huntsville for the Tennessee Valley and north Alabama, St. Stephens for the middle and south, Tallahassee for the southeast corner. "T4S R7W" exists under more than one of them, so the lookup must name the survey. The app takes it from the county the deed states; you can override it per tract. A lookup without a meridian is never made.
- **A flipped direction letter.** If the reader turns R7W into R7E (or T4S into T4N), a real section comes back hundreds of miles away. The county check catches this: the resolved section has to sit in the county the deed names. When it does not, you see "resolved to Baldwin County, deed says Lawrence" and one-tap retries for the likely fixes (flip the township letter, flip the range letter, try the other survey).

Two more aids: a section more than 25 miles from every boundary you already have shows a distance warning (new land is possible; a misread is likelier), and each resolved tract prints a diagnostic line ("Resolved: Huntsville PM (from Lawrence County), T4S R7W, Sec 31, BLM CadNSDI section layer, county check passed (Lawrence), 2.1 mi from River Place") that is also saved with the boundary, so a wrong plot can be traced later. For metes and bounds, the point-of-beginning pin shows the county it sits in beside the deed's county.
