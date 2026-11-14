---
title: Printing a map PDF
route: /map
group: Map
order: 4
updated: 2026-11-14
keywords: print, pdf, letter, landscape, portrait, legend, scale bar, north arrow, hide items, exclude, choose items, title, date, labels, generate pdf, color by crop, color by entity
---
## Making a printed map

Tap **Print** at the top right of the map. A page-shaped frame appears; pan and zoom until the frame holds exactly what you want printed. The frame is the printed area.

## The setup panel

- **Title** and **Subtitle / date**: the title starts as the property name when only one property is in view, otherwise your organization name; the subtitle starts as today's date. Type over either.
- **Orientation**: landscape or portrait.
- **Layers and labels**: each layer has its own checkbox for the print, prefilled from the live map, with a **labels** checkbox beside it (maintenance issues have no label checkbox). Parcel labels start off in print.
- **Color ag fields by crop** and **Color boundaries by entity** carry the map's Crops and By entity coloring into the print. They start the way the live map is set. The entity box shows only when you have more than one entity.

## Hiding single items

While the frame is up, tap any item on the map to leave it out of the print. It turns ghosted; tap it again to bring it back. A counter on the frame shows how many are hidden and clears them all in one tap. The panel adds property chips when several properties are in frame and a **Choose items** list with a filter box. Hidden items are gone from the PDF, its labels, and its legend. Nothing about hiding is saved; the next print starts fresh.

## Generate

**Generate PDF** renders the framed area at print resolution and downloads a Letter PDF with the map, title, a legend, a scale bar, a north arrow, and the Turnrow mark. When the Maintenance issues layer is checked, the open issues in the frame are listed beside the legend. On a phone, open the PDF and print or share from there.

The Neighbors overlay is never printed.

## Common questions

- **Why is the legend short?** It lists only the layers that are checked and have something on them. Items you hid do not count.
- **Can I print more than one page?** Each print is one map. Frame a second area and generate again. A second page appears only when the list of open maintenance issues has no room beside the legend.
