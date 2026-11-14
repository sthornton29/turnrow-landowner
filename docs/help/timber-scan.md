---
title: Timber Scan
route: /timber-scan
group: Timber
order: 2
updated: 2026-11-14
keywords: timber scan, satellite, land cover, cropland data layer, cdl, proposals, accept, save stands, draft stands, review, merge, split, edit shape, rescan, try again, planted or natural, forest cover
---
## What it does

Timber Scan looks at a property with public USDA land cover data and proposes draft timber stands: where forest is, roughly what kind (pine, hardwood, mixed, or wetland hardwood), and how many acres. You correct the proposals, accept the ones that are right, and save them. Accepting alone saves nothing: no stand is saved until you press the save button at the bottom, which reads "Save 3 stands" with your own count.

## How to use it

- Open a property page and tap **Timber Scan**. The same button is on the property's panel on the Map. A first scan can take 10 to 30 seconds.
- Proposals draw as dashed outlines in draft colors so they never look like saved stands, and each is listed under the map with its kind, acres, and mix. Tap one on the map or in the list to select it.
- Fix a proposal before accepting it: **Edit shape** lets you drag its points (then **Save shape**), **Split** cuts it with a line you draw across it, **Merge** joins it with another proposal you pick, and **Remove** takes it off the list.
- **Accept** opens a short form on the proposal: stand name, stand type, primary species, year established, and notes. A pine proposal asks whether it is planted or natural; **Suggest planted vs natural** has the app look at the satellite image for planting rows and suggest an answer for you to confirm.
- The save button ("Save 3 stands", counting the accepted ones) saves every accepted proposal as a real stand. A pine stand cannot be saved until planted or natural is chosen. If a stand does not save, it stays on the list with the reason so you can try again.

## Good to know

- The data behind it is a satellite classification at roughly 30 meter resolution. Edges are approximate, and narrow hardwood drains can disappear. Treat it as a head start, not a cruise.
- Scans are clipped to the property boundary, so draw or import the boundary first.
- Ground that is already a saved stand is never proposed.
- A proposal that overlaps an ag field by more than 1.0 acre gets an amber "Overlaps ag field" chip. It is usually young pine on former cropland or an edge error; you decide.

## Common questions

- **It missed a young plantation.** Recently planted ground often classifies as open land. Draw that stand by hand.
- **Can I rerun it?** Yes. Opening Timber Scan again shows the last scan with the stands you have already saved left out. **Rescan** asks for a fresh one. Saved stands are never changed by a scan. Edits to proposals you did not save are not kept.
- **The scan failed.** The USDA service is sometimes slow or down. The page says so and offers **Try again**. If a **Rescan** fails, the earlier results stay on screen; press **Rescan** again later.
