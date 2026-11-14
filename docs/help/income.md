---
title: Income views
route: /income
group: Income
order: 1
updated: 2026-11-14
keywords: income, income records, income history, historical income, solar, tower, cell tower, post office, building rent, other income, old books, needs a check, owed, calculated, not counted as received, mark received, projected, expected, received, outstanding, rent, by lease, breakdown, how figured, calculation, assumptions, step by step, timber, hunting, government payments, taxes, net, by property, by entity, entity filter, multi-select, by year, chart, upload rent received, rent upload, photograph check, match payment, expired lease, lease missing
---
## What this page shows

One year at a time; the year buttons at the top switch years.

- **Expected vs received by year**: bars for expected, received, and taxes paid over the latest ten years.
- **By income type**: expected, received, and outstanding for agricultural leases, hunting leases, timber, government payments (your share), and solar, tower, buildings, and other. Below them come gross income, property taxes, and net.
- **By lease** and **by property** (grouped by entity) break the same year down.

Outstanding is added up line by line, so money received beyond what one line expected never hides what another line is still owed.

## Filtering by entity

The entity chips are a multi-select: tap one or more entities (or **No entity**) and every number on the page recomputes within the selection, including the chart, the by-type table, the government payments line, the tax rows, and the by-lease table. **All entities** clears it. The same selection follows you to Government Payments and Home and is remembered on this device.

Income with no land linked shows as **Unassigned (no land linked)** only under All entities. An income record that names an entity but no property is the exception: it shows under that entity as **Not tied to a property (income records)**, so filtering to an entity still counts it.

## By lease, and how each number is figured

Between the by-type and by-property tables sits **by lease**: every lease with rent expected or received in the year, with a Basis chip (Projection, Schedule, or Incomplete; "Received only" when money came in with nothing expected) and expected, received, and outstanding.

Tap a lease (or its **How** link) to open its breakdown page: the year's expected, received, and still-to-come figures, a one-sentence summary, and then the arithmetic step by step. A crop share lease shows each crop as an equation: acres times yield is production, times price is crop value, times your share is your rent, less your share of expenses where the lease shares them. Cash rent shows leased acres times the rate (or the lump sum); a flex lease shows base rent plus the year's bonus estimate.

Every input carries a chip saying where it came from (lease terms, tenant actual, tenant final, tenant projected, or entered by hand). Tenant numbers also show the date they were as of. Anything missing is listed so you know what to fill in. Below the math, **Actual against expected** lists the payment schedule and recorded payments. On crop share and flex leases the same page opens from the lease's **How this is figured** link beside each year's Projected total.

## Expected and received

- **Expected** rent comes from a lease's generated expected payments for the year when it has any; otherwise it is projected from the lease's terms and year assumptions. Rent is projected only for payments that fall due between the lease's start and end dates, and expected payments are generated the same way (see the Leases topic).
- An amber banner notes when part of the year is a projection, and says so when those assumptions rest on your tenant's own projected prices and yields. Those flow in and update at each sync; values you enter by hand on a lease are never changed.
- **An expired or terminated lease** keeps the expected rent of its own years. Expected payments for years after the year it ended stop counting, unless money was recorded against them.
- **Received** is what you recorded: payments on leases and timber sales by the date received, timber settlements by settlement date, and income records marked Received.
- **Property taxes**: the expected column is the statements for that tax year; the received column is tax payments dated in the year.
- Amounts split across properties by leased acres for leases and by linked stand acres for timber.

## Income records

**Income records** (button at the top) holds income received outside a lease payment or a timber sale: the rent history loaded from the old books (CenterPoint 2005-2020, Xero 2020-2024, QuickBooks Online 2024-2025), solar option and lease payments, the cell tower, and building rent. Before 2020 the books often recorded one check for several farms, so those records sit under the entity and not a property. Equipment rent is not land income and is not recorded. Timber sold under a timber sale in Turnrow is counted from its settlements, not repeated here.

- **Received or not.** A record marked Received counts as received in its year. A record marked **Owed (invoice or settlement)** or **Calculated, not confirmed paid** is labeled "Not counted as received" and is left out of received. The Income page shows that total apart, in an amber line under the by-type table, and this page shows it beside the received total. Once the money is in, change the record's dropdown to **Received**. That choice cannot be changed back on this page.
- **Fixing a record.** Change the entity, property, or type right in the row; each change saves at once.
- **Check.** Records marked **Check** came from an unclear source (for example a small receipt of unknown purpose). Fix the property or type if needed and tap the mark to clear it. **Needs a check** lists only those.
- **Add a record** enters a new one with the date received, amount, type, who paid, property or entity, and a note; **Save record** saves it as received. Rent paid under a lease in Turnrow belongs on the lease instead.
- **Delete** removes a record for good and asks first.

A record with neither a property nor an entity is visible to admins only.

A property's page lists its income under **Income allocated to this property**, with older years behind **Earlier years**. Once at least three of the last ten years have anything on record, a line above gives the average received a year.

## Upload rent received

**Upload rent received**, at the top of this page and in each lease's Payments section, takes photos or PDFs of rent checks and tenant settlement sheets, several at a time. The app reads the payer, date, amount, and check number, suggests the tenant from the payer and then that tenant's lease, and proposes how the money lands on the lease's open expected payments (an exact amount match first, otherwise the nearest due dates). Money left over records as an unscheduled payment. Adjust anything, then press **Record payment**. The file is filed under the lease's Documents.

Once a check is recorded its form closes, so it cannot be recorded a second time by accident. If the file fails to attach, **Try attaching the document again** retries only the attaching.

A document read as a logger's settlement offers **Timber settlement** in place of **Lease payment** and opens the timber settlement review.

## Common questions

- **Why is a lease missing from this year?** A lease is listed only when rent is expected in that year (a payment falls due between its start and end dates) or money was received in that year. Check the lease's dates and the due dates in its payment schedule. With no schedule, rent counts as due January 1.
- **A lease ended but still shows expected rent.** Marking it Expired or Terminated does not remove the rent of its own years. If it ended early, set the end date on the lease to the day it ended.
- **Government payments show as a line and also as a note.** The line is your share under leases where you receive one. The note under it is the estimate of what the base acres on your land generate for your tenant in total; it shows whether or not you get a share.
