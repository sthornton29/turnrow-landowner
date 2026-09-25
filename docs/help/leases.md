---
title: Leases
route: /leases
group: Leases
order: 1
updated: 2026-09-24
keywords: how this is figured, breakdown, calculation, lease, tenant, agricultural, hunting, cash rent, flex, crop share, terms, payment schedule, expected payments, record payment, insurance, auto renew, notice, leased acres, upload lease, ai extraction, special provisions, active, status, tenant data, automatic, projections, final price, hand edit
---
## Tenants and leases

A **tenant** is the person or operation that rents from you, with contact details and insurance on file. When a farm connection is in place, tenants come from the farm data: each farming entity the farmer shares is a tenant (marked "farm data" in the lease's tenant list), and a lease with that tenant scopes its Tenant Data panel to that entity's fields and prices. A **lease** belongs to a tenant and covers land you pick (whole properties or specific ag fields) with editable leased acres, since contract acres often differ from map acres.

Agricultural leases are **cash** (per acre or lump sum), **flex** (a base rate plus a bonus), or **crop share** (your share of the crop less any shared expenses). Hunting leases are a flat amount or per acre, with an insurance reminder.

## Uploading a lease

Upload the signed lease as a PDF and the app reads the type, dates, acres, rent structure, payment schedule, and special provisions, and suggests a price method from the pricing clause. Fields it was unsure about are highlighted amber. Nothing saves until you review and confirm.

New leases start with status **Active** (uploaded and manually entered alike); change it on the form or the lease page any time (draft, active, expired, terminated). Expired and terminated leases stop projecting income.

## Tenant data flows in by itself

On a crop share lease whose land is mapped to a farm connection, the projection assumptions fill themselves: planted acres, the tenant's projected (or actual) yields, and the tenant's projected prices flow in automatically with every sync, and keep updating as the tenant revises them. A price the farmer marks final replaces the projection automatically and is labeled FINAL. There is nothing to allow per lease; a new lease picks its numbers up on the next sync (or press Refresh now on the Farm connections page).

Every automatic value shows its source and as-of date in small print under the crop row, so you always know which numbers are the tenant's projections. **Your edits always win**: type over any value and it becomes yours, never replaced by a sync. Once you hand-touch a year, the app also stops adding new crop rows to it (the tenant panel above the rows still shows everything shared, with Use buttons to take a tenant number back). The Income page says plainly when its expected figures rest on tenant projections.

## Government payments on share and flex leases

Crop share and flex leases ask one required question: does the landowner receive a share of government payments (ARC and PLC on the leased base acres), or does the tenant retain them all? If you receive a share, the percent prefills from your crop share and you say how it arrives: FSA pays you directly (you are a party on the farm record) or the tenant remits your share. A tenant-remitted share becomes an expected payment due each October of the following year, so a tenant check can be matched to it in Rent upload. An FSA-direct share is projected as income but is never expected in a tenant check. When you upload a lease, the reader looks for the government payment clause and proposes the answer in amber for you to confirm.

## How a year's number is figured

Each year's assumption row ends with its Projected total and a **How this is figured** link. It opens a page that shows the arithmetic behind that total step by step, with a chip on every input saying where it came from and what is still missing, and the payments received against it. The Income page's by-lease table opens the same page.

## Payments

Each lease can carry a **payment schedule** (one to four installments with dates and shares). Generate expected payments for a year and record checks against them; status (upcoming, due soon, past due, paid, partial) is worked out from what you record. Unscheduled receipts can be recorded too. Regenerating a year never touches an installment that already has a payment on it. Rent checks can also be photographed on the Income page and matched to the right lease.

## Common questions

- **The lease covers land on two properties.** Link both properties, each with its leased acres; income splits by those acres.
- **The tenant switched from cash to crop share.** End the old lease and create a new one; history stays intact.
- **Where do government payments fit?** Crop share and flex terms have a Government payment share percent. See the Government payments topic.
