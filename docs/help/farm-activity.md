---
title: Farm activity
route: /farm-activity
group: Farm Data
order: 2
updated: 2026-11-14
keywords: farm activity, farm data, entity, farming entity, operated by, plantings, crop year, varieties, harvested, harvesting, growing, harvest complete, actual yield, projected yield, yield, irrigated, dryland, by field, by property, by entity, by tenant, crop mix, harvest progress, prices, final, summary, drill in, crops layer, ignore, not mapped, manage connections
---
## What this page shows

Everything connected tenants have shared, one crop year at a time. Pick the year, an entity, a tenant, or a property at the top and tap **Apply**. A strip under the filters shows each connection with the date it last synced and a **Manage connections** link.

**The summary cards** roll the year up two ways: **By entity** (how your land is held; a **No entity** card covers land not assigned to one) and **By tenant** (each farming entity your tenants' software names). Each card shows acres in crops, the crop mix with a colored bar, and acres harvested of acres planted. When the farmer shares them, it also shows a yield per crop marked actual or projected, and crop prices marked projected or final. An account with one entity and one tenant sees a single card.

**Tap a card** to drill in. The page narrows to that entity or tenant and lists its properties with the same numbers. Tap a property to see its fields. The links at the top step back up, and clearing a filter returns to the summary.

**The field tables** list each planting by property: field, crop and varieties, acres, planting date, status (Growing, Harvesting, or Harvested), and yield. Card totals are sums of these rows.

## Actual vs projected during harvest

A yield reads as actual only once the field's harvest is complete. A field still being cut shows Harvesting and the tenant's projected yield, marked projected, because dividing a partial harvest over the whole field would read too low. On a summary card, a crop's actual yield averages only the finished fields, with "X of Y ac complete" beside it while others are still going.

The Map's Crops layer colors ag fields by the same data for the current year.

## Which years are kept current

Every sync refreshes the current crop year and the one before it, because harvest and final prices often arrive after December 31. Older years stay as they were last synced. The page opens on the latest year with data.

## Your tenant's farming entities

A farm often runs as several entities (a family corporation for one set of fields, an LLC for another). When your tenant's software shares which entity operates each field, each farming entity gets its own tenant card with its own acres, crop mix, harvest, and prices. The field tables gain an **Entity** column, and the map's field panel says who operates the field.

## Ignored and unmatched fields

- Fields set to **Ignore this field** on Field mapping are left out of every total and list here. A line under the totals says how many plantings were left out.
- Plantings on fields you have not matched yet are listed under "Not mapped to your land yet". They count on the tenant's card, which notes the acres, but not toward any entity or property.

## Common questions

- **Yield or prices read "not shared".** The farmer did not turn that on; ask them or leave it. Acres and harvest progress always show, because plantings are always shared.
- **A field is missing.** Check its match under Farm Data, then **Manage connections**, then **Field mapping**, and make sure it is not set to Ignore this field.
- **A tenant farms for two of my entities.** The tenant card rolls up across both; each entity card shows only its own land.
- **The numbers look old.** Open **Manage connections** and press **Refresh now**. The card there says when the connection last synced and whether anything went wrong.
