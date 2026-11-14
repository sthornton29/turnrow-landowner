---
title: Farm connections
route: /farms
group: Farm Data
order: 1
updated: 2026-11-14
keywords: farm connection, share code, trw code, tenant software, farmer, fields, plantings, yields, prices, refresh now, ended by farmer, disconnect, field mapping, confirm match, ignore this field, manage connections, privacy, admin, crop year
---
## What a connection is

If your tenant uses Turnrow's farm software, they can share part of their records with you: which of their fields are on your land, what they planted, and, if they choose, yields and prices. The farmer generates a one-time share code (it looks like TRW-XXXX-XXXX-XXXX) and an admin on your account enters it. Nothing flows the other way.

Reach this page from Farm Data with **Manage connections**. Until a farm is connected, Farm Data opens this page directly.

## Connecting

Only an admin can connect a farm. Under **Connect a Farm**, enter the code and tap **Connect**. The first sync runs right away, and you land on **Field mapping** for the new connection.

## What the farmer controls

The farmer decides what to share and can end the share at any time. Plantings always come with a share. Yields, projected prices, and projected yields are each optional: the chips on a connection's card (**Yields**, **Projected prices**, **Projected yields**) are green when shared and gray when not, with the time they were last checked.

Sharing is checked again on every sync, so something the farmer turns on or off later takes effect on the next sync with nothing to set up on your side. Turning something off stops new numbers; numbers already synced stay. If a chip looks wrong, press **Refresh now**.

When the farmer ends the share, the card reads **Ended by farmer**, syncing stops, and what was already synced stays on your side.

## Mapping fields

**Field mapping** lists each of the farmer's fields with a list beside it: your ag fields, **Whole property** (for when you have not drawn the field), **Not mapped**, and **Ignore this field**.

- A match is suggested only when the names have something in common: the same name, one name inside the other, or a shared word together with acres within 15 percent. A shared number alone ("North 40" and "South 40") does not count. Tap **Confirm match** to accept a suggestion. The app never confirms one for you.
- Size alone never suggests a match. When one of your fields is about the same size (within 5 percent) but the names differ, it is mentioned as a hint under the row. Pick it from the list only if it is the same field.
- Picking a field or a property from the list confirms that match right away.
- **Ignore this field** leaves that field's plantings out of Farm Data, the Home harvest card, and Ask.

Only confirmed matches tie farm data to your land: the map's Crops layer, the property rows on Farm Data, ag field pages, and the Tenant data panel on leases.

## Refreshing

Each connection syncs on its own every 6 hours, and whenever someone presses **Refresh now** (or **Check for new shared fields** on the mapping page, which runs the same sync). Every sync refreshes the current crop year and the one before it, because harvest and final prices often arrive after December 31. Every page that shows farm data reads the same synced copy.

When the farm software cannot be reached, the last synced data still shows and the card says what went wrong. A problem with one part (harvest data, prices, or yields) appears as an amber line on the card.

## Disconnecting

**Disconnect** is for admins, and the app asks first. It permanently removes everything synced from that farm: every year of plantings, harvest, and yields, the tenant's projected prices and yields, and the field matches you confirmed. Your tenants and leases are kept. To see the data again you would need a new share code from the farmer and would match the fields again. If the farmer has already ended the share, the history cannot be pulled again.

## Tenants come from the farm data

Your tenants are the farming entities behind the share. Each entity the farmer's software names becomes a tenant in Turnrow when the connection syncs (a share with no entities becomes one tenant for the whole operation). An existing tenant with the same name is linked instead of duplicated, and you can rename a tenant freely. For a tenant that did not come from the farm data, the tenant's page has a **Farming entity** section to link one by hand; a suggestion appears there when every mapped field on that tenant's leased land belongs to one entity.

## Common questions

- **The code was not accepted.** A code works once. Ask the farmer for a new one.
- **Can I see their whole operation?** No. Only the fields they shared with you, and only what they chose to share about them.
- **I am not an admin. What can I do here?** You can see the connections and press Refresh now. Connecting and disconnecting are for admins, and Field mapping shows you only the fields already matched to land you can see.
