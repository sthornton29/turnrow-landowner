---
title: Farm activity
route: /farm-activity
group: Farm Data
order: 2
updated: 2026-08-21
keywords: farm activity, entity, farming entity, operated by, plantings, crop year, varieties, harvested, yield, production, irrigated, dryland, by field, by property, by entity, by tenant, crop mix, harvest progress, projected yield, prices, summary, drill in, crops layer
---
## What this page shows

Everything connected tenants have shared, by crop year, at three levels.

**The summary at the top** rolls the year up by entity (how your land is held) and by tenant (each farm connection). Each card shows the acres in crops, the crop mix (acres per crop, with a colored bar), harvest progress (acres harvested of acres planted), and, when the farmer shares them, a projected or actual yield per crop and their crop prices. A "No entity" card covers land not assigned to an entity. An organization with one entity and one tenant sees a single card instead of two sections.

**Tap a card** to drill in. The page narrows to that entity or tenant and lists its properties as rows with the same numbers. Tap a property to see its fields: the crop on each mapped field, varieties, planting date, whether it is harvested, and yield when shared. Breadcrumbs at the top step back up, and the filters follow along (drilling in sets the entity, connection, or property filter; clearing a filter returns to the summary).

The card totals are sums of the field rows beneath them, so they always agree.

The Map's Crops layer colors ag fields by the same data for the current year.

## Your tenant's farming entities

A farm often runs as several entities (a family corporation for one set of fields, an LLC for another). When your tenant's software shares which entity operates each field, the tenant's card breaks out per entity (acres, crop mix, harvest, and that entity's own prices) under the whole-operation totals, the field table gains an Entity column, and the map's field panel says who operates the field. A tenant with one entity shows nothing extra.

## Common questions

- **Yield or prices show "Not shared."** The farmer did not enable that scope; ask them or leave it. Acres and harvest progress always show, because plantings are always shared.
- **A field is missing.** Confirm its mapping under Farms then Mapping. Plantings on fields that are not mapped yet count toward the tenant's card but not toward any entity or property.
- **A tenant farms for two of my entities.** The tenant card rolls up across both; each entity card shows only its own land.
