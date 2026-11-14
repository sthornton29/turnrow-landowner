---
title: Plotting a boundary from a deed
route: /documents
group: Documents
order: 2
updated: 2026-11-14
keywords: plot, deed, legal description, aliquot, quarter, section, township, range, meridian, plss, metes and bounds, calls, bearing, distance, chains, poles, curve, closure, error of closure, force close, point of beginning, marker, rotate, rotation, georeference, deeded acres, replace boundary, new parcel, review the description, resolve sections, traverse and place, preview and save, type replace, type save, county check
---
## Two kinds of descriptions

- **Aliquot parts**: "the NW quarter of the SE quarter of Section 12, Township 4 South, Range 8 West." The app finds that section on the public survey grid, cuts it by quarters and halves, joins the parts, and cuts out any "less and except" parts that are themselves plain quarters and halves.
- **Metes and bounds**: a starting point and a chain of calls, "thence N 45 degrees 30 minutes E 660 feet." The app reads the calls into a table you can correct, plots the shape, and you place it on the map.

## The three steps

Open a deed, survey plat, legal description, or easement deed in Documents and tap **Plot boundary**. Nothing changes on your map until the last step.

### 1. Review the description

Tap **Read the document**. The description is read and shown for review, amber where the reader was unsure. Check the **Description type** it chose: PLSS aliquot, Metes and bounds, or Mixed (which is plotted from its aliquot parts).

- For aliquot parts you see the reference as fields, not prose: the state, the county the deed states (it decides the principal meridian), and for each tract its parts as ordered chips (largest division first, each next chip a part of the one before), the section, township and N or S, range and E or W, and the meridian. Fix a misread letter or digit here. Nothing is looked up until the next step.
- For metes and bounds you see the point of beginning as described, the basis of bearing, and the calls: a bearing, distance, and unit for each, with a **Curve** box for curves. A bearing that cannot be read is marked red.

### 2. Resolve sections, or Traverse and place

For aliquot parts the step is **Resolve sections**. Tap **Resolve** on each tract. Two checks run: the section must sit in the deed's county (when it does not, a red box offers one-tap retries, and you cannot continue until it passes), and a section more than 25 miles from all your boundaries gets a warning. Words beyond plain quarters and halves ("the north 10 acres of", "that part lying north of the road") are not plotted, and an exception that is more than plain quarters is not cut out. A note under the tract says so each time.

For metes and bounds the step is **Traverse and place**. The **error of closure** shows first: the gap between where the last call ends and the starting point, in feet and as a ratio. Green is 1:5,000 or better, amber down to 1:1,000, red worse. **Force close (compass rule)** spreads the gap across the courses and is labeled as an adjustment. A call that cannot be plotted is left out and named by its number. Then set the point of beginning: tap the map or drag the marker, or use one of the corner buttons for the reference boundary. **Rotation** turns the figure up to 15 degrees either way when the deed's basis of bearing differs from true north. The shape follows live. When a reference boundary is chosen, the marker starts in its middle only as a starting spot. You cannot continue until you place the marker yourself, or tap **The marker is already on the point of beginning**.

### 3. Preview and save

The plotted boundary is drawn over the current one with acres side by side (**Plotted**, **Current**, **Deeded**). Under **Save as**, choose **New property**, **New parcel**, **Replace property boundary**, or **Replace parcel boundary**. **New property** is offered to admins only; other members save onto a property that already exists.

Every warning from the earlier steps is listed again above the button, along with a note when the plotted acres are more than 5 percent off the acres the description states, or when the plot sits 2 miles or more from the boundary you picked. Two cases ask for a typed word before the button works:

- Replacing a boundary that already exists: type **REPLACE**. The old boundary is not kept.
- Saving a plot that has warnings: type **SAVE**.

After the save, the document's page shows **View boundary**.

## Honest limitations

Plot quality follows description quality. Old deeds omit curves, mix units, or reference monuments that no longer exist. Aliquot math assumes regular sections; government lots along rivers and township lines are approximations. Closure is shown, never hidden. When the county's parcel map agrees with your records, Import from county records is faster and usually better. Nothing here replaces a licensed survey.

## Common questions

- **The shape is mirrored or spun.** Check bearing quadrants (N 45 E vs N 45 W) in the calls, then use **Rotation** for small differences.
- **Units?** Feet, chains (66 ft), poles or rods (16.5 ft), links, yards, and meters are understood; pick the unit per call when the deed mixes them. Varas are not converted (the vara differs by state and era); convert those calls to feet first.
- **The description is only part of a section along a creek or road.** The plotter can only show the whole section for that. Draw the tract by hand on the Map, or import the parcel from county records.

## Why did my plot land in the wrong place?

Almost always one of two things, and the app guards against both.

- **The wrong survey (meridian).** Township and range numbers repeat across a state. Alabama has three main surveys: Huntsville for the Tennessee Valley and north Alabama, St. Stephens for the middle and south, Tallahassee for the southeast corner. "T4S R7W" exists under more than one of them, so the lookup must name the survey. The app takes it from the county the deed states; you can override it per tract. A lookup without a meridian is never made.
- **A flipped direction letter.** If the reader turns R7W into R7E (or T4S into T4N), a real section comes back hundreds of miles away. The county check catches this: the resolved section has to sit in the county the deed names. When it does not, you see "County check failed" with both county names and one-tap retries for the likely fixes (flip the township letter, flip the range letter, try another survey).

Two more aids: each resolved tract prints a line saying how it was resolved ("Resolved: Huntsville PM (from Lawrence County), T4S R7W, Sec 31, BLM CadNSDI section layer, county check passed (Lawrence), 2.1 mi from River Place"), shown again on the save step. For metes and bounds, the county the marker sits in is shown beside the county the description names, with a red warning when they differ.
