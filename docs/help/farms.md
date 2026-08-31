---
title: Farm connections
route: /farms
group: Farm Data
order: 1
updated: 2026-08-31
keywords: farm connection, share code, trw code, tenant software, farmer, fields, plantings, yields, prices, scopes, refresh, revoked, mapping, confirm fields, privacy, granted later, permissions, checked
---
## What a connection is

If your tenant uses Turnrow's farm software, they can share part of their records with you: which of their fields are on your land, what they planted, and, if they choose, yields and prices. You redeem a one-time share code they generate (TRW-XXXX-XXXX-XXXX). Nothing flows the other way.

## What the farmer controls

The farmer decides what to share (fields only, plantings, yields, projected prices and yields) and can end the share at any time. When they do, the connection shows as ended and the data already shared stays on your side.

Sharing settings are re-checked from the farm software on every sync, so a scope your farmer grants or revokes later takes effect on the next refresh with nothing to reconnect or set up on your side. The chips on each connection card show the current answer with the time it was last checked; a scope turned off leaves already-synced numbers visible, labeled with their as-of date. If the chips look wrong, press Refresh now and they update from the live answer; if a chip still reads not shared, the farm side genuinely has it off for this share (a farmer with several shares can grant the wrong one by mistake).

## Mapping fields

After connecting, the app suggests which of the tenant's fields match your ag fields (by name and acres within ten percent). You confirm or ignore each suggestion; the app never confirms for you. Confirmed mappings power the Crops map layer, farm activity, and the tenant data panel on leases.

## Refreshing

The connection's sync is the one way farm data enters Turnrow: it runs automatically every 6 hours and from the Refresh now button here (the mapping page's "Check for new shared fields" runs the same sync). Every page that shows farm data (Farm Data, the map's Crops layer, ag field pages, and each lease's Tenant Data panel) reads the same synced copy, so after one refresh every surface reflects it. When the farm software is unreachable, the last synced data still shows with a note; a problem fetching one part (say prices) appears on the connection card instead of failing quietly.

## Tenants come from the farm data

Your tenants are the farming entities behind the share. Each entity the farmer's software names becomes a tenant in Turnrow the first time the connection syncs (a share with no entities becomes one tenant for the whole operation); an existing tenant with the same name is linked rather than duplicated, and you can rename a tenant freely. Lease that tenant and the lease's Tenant Data panel scopes to that entity's fields and prices. Farm Data's by-tenant cards are those same entities. For a tenant that did not come from the farm data, the tenant page still lets you link one by hand (Turnrow suggests the entity when every field mapped on that tenant's leases belongs to one).

## Common questions

- **The code says already used.** Codes work once; ask the farmer for a new one.
- **Can I see their whole operation?** No. Only fields they marked as yours, and only the scopes they enabled.
