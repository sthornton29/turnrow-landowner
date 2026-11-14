---
title: Leases
route: /leases
group: Leases
order: 1
updated: 2026-11-14
keywords: how this is figured, breakdown, calculation, lease, tenant, agricultural, hunting, cash rent, flex, crop share, terms, payment schedule, expected payments, generate expected payments, refresh expected payments, record payment, unscheduled payment, upload rent received, insurance, auto renew, notice, leased acres, link land, upload lease, special provisions, draft, active, expired, terminated, status, start date, end date, ended early, delete lease, tenant data, automatic, projections, final price, hand edit
---
## Tenants and leases

A **tenant** is the person or operation that rents from you, with contact details and insurance on file (see the Tenants topic). When a farm connection is in place, tenants come from the farm data: each farming entity the farmer shares is a tenant (marked "farm data" in the lease's tenant list), and a lease with that tenant scopes its Tenant data panel to that entity's fields and prices.

A **lease** belongs to a tenant and covers the land you link to it: whole properties, or single ag fields added on the lease page with **+ Link land**. Leased acres start from your mapped acres and can be edited, since contract acres often differ from map acres.

Agricultural leases are **cash** (per acre or lump sum), **flex** (a base rate per acre plus a bonus you estimate each year), or **crop share** (your share of the crop less any shared expenses). Hunting leases are an annual lump sum or a rate per acre. A hunting lease can require insurance; the lease page then warns when the tenant has no certificate on file or it has expired.

The Leases page lists every lease with its type, status, tenant, leased acres, and dates.

## Creating a lease

Creating a lease is for admins. Tap **+ New lease**, then choose one:

- **Upload lease document and extract terms**: a PDF of the signed lease. The app reads the type, tenant, dates, renewal and notice terms, rent structure, payment schedule, the land it covers, and special provisions, and suggests a price method from the pricing clause. Fields it was unsure about are highlighted amber. The PDF is filed under the lease's Documents.
- **Enter terms manually**.

Nothing saves until you review the form and press **Save lease**.

## Status and dates

New leases start as **Active**. Change the status at the top of the lease page or under **Edit lease terms**: Draft, Active, Expired, or Terminated.

What rent is expected follows the lease's dates, not its status:

- Rent is expected only for payments whose due date falls between the lease's start and end dates. A one-year lease that runs July to June and is paid July 1 expects one payment, not two.
- One exception keeps a lease from coming up a payment short: if it starts February 1 with rent due January 1 and would otherwise have fewer payments than lease years, the first year's payment is still expected.
- Marking a lease Expired or Terminated keeps the expected rent of its own years, so past years do not change. Expected payments for years after the year it ended stop counting, unless money was recorded against them.
- If a lease ended early, set its end date to the day it ended; rent due after that date is no longer projected. A lease marked Expired or Terminated whose end date is still ahead shows an amber note with an **end it today** link. If expected payments were already generated, an admin then presses **Refresh expected payments** so the unpaid rows follow the new date.
- A Draft lease counts in Income the same as an Active one.

The status does matter in three places: Home reminds you about Active leases that are ending within 90 days or have ended (unless they auto-renew); tenant numbers from farm data fill only Draft and Active crop share leases; and your government payment share is no longer projected once a lease is Expired or Terminated.

## Tenant data flows in by itself

On a crop share lease (Draft or Active) whose land is matched to the tenant's fields under Field mapping, the year assumptions fill themselves. Planted acres, the tenant's projected yields (actual once harvest is complete), and the tenant's projected prices are saved to the lease at every sync and keep updating as the tenant revises them. Yields and prices arrive only when the farmer shares them. A price the farmer marks final replaces the projection and is labeled final. There is nothing to turn on per lease; a new lease picks its numbers up on the next sync (or press **Refresh now** on the Farm connections page).

Every automatic value shows its source and as-of date in small print under the crop row. **Your edits always win**: type over a value and press **Save**, and it is yours; a sync never replaces it. Once you change anything in a year by hand, the app also stops adding crop rows to that year. In a year you have not touched, when the tenant's rows for a crop change between separate irrigated and dryland rows and one blended row, the lease's rows follow, so a crop is never counted twice.

The **Tenant data** panel above the rows still shows everything shared, with **Use**, **Use row**, and **Use all** buttons that fill the tenant's numbers in amber for you to save. The Income page says plainly when its expected figures rest on tenant projections.

## Government payments on share and flex leases

Crop share and flex leases ask one required question: **Landowner receives a share of government payments** (ARC and PLC on the leased base acres) or **Tenant retains all government payments**. If you receive a share, enter **Your share (%)** (on a crop share lease it prefills from your crop share) and say how it arrives: **FSA pays me directly (I am a party on the farm record)** or **Tenant remits my share**.

A tenant-remitted share is added as an expected payment due October 1 of the following year when expected payments are generated or refreshed, so a tenant check can be matched to it in **Upload rent received**. An FSA-direct share is projected as income but is never expected in a tenant check. When you upload a lease, the reader looks for the government payment clause, fills in the answer when the lease states one (amber when it was unsure), and shows the clause under the question.

## How a year's number is figured

On crop share and flex leases, each year's row under **Projection assumptions by year** ends with its Projected total (or Incomplete) and a **How this is figured** link. It opens a page that shows the arithmetic behind that total step by step, with a chip on every input saying where it came from, a list of what is still missing, and the payments received against it. The Income page's by-lease table opens the same page for every kind of lease, cash and hunting included.

## Payments

Each lease can carry a **payment schedule**: one to four payments a year, each with a label, a due month and day, and either a percent of the year's rent or a fixed dollar amount. With no schedule, the year's rent counts as one payment due January 1, so set a schedule when rent is due on another date. The lease form warns in amber when percentages do not total 100, and lists any payment left out because its due date is outside the lease dates.

In the Payments section of the lease page:

- **Generate expected payments** (it reads **Refresh expected payments** once rows exist) turns the terms and schedule into dated rows for each payment that falls due inside the lease dates. Crop share and flex years need their assumptions filled in first. This button is for admins. Refreshing replaces unpaid rows and never changes a row that has money recorded against it.
- **Record payment** on a row records money against it; partial payments are fine. **Record unscheduled payment** records money that matches no row.
- **Upload rent received** reads a check photo or a settlement sheet (see the Income views topic).
- Each row shows a status worked out from what you record: Upcoming, Due soon (within 30 days), Past due, Partially paid, or Paid.
- Admins can **Delete** an expected row; money recorded against it stays as unscheduled payments. Deleting a recorded payment asks first.

You do not have to generate anything to see expected rent: until rows exist, Income projects the lease from its terms.

**Delete lease**, at the bottom of the lease page, removes the lease with all of its expected and recorded payments after asking.

## Common questions

- **The lease covers land on two properties.** Link both properties, each with its leased acres; income splits by those acres.
- **The tenant switched from cash to crop share.** Set the old lease's end date to the day it ended and mark it Expired, then create a new lease. The old lease's years stay as they were.
- **I do not see Refresh expected payments.** It is for admins. You can still record payments.
- **Where do government payments fit?** Crop share and flex leases ask whether you receive a share (see above). See the Government payments topic.
