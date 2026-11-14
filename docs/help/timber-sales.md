---
title: Timber sales and settlements
route: /timber-sales
group: Timber
order: 3
updated: 2026-11-14
keywords: timber sale, sale steps, consulting forester, forester fee, cruise, minimum bid, sealed bid, bids, notice of sale, contract checklist, clauses, performance deposit, closeout, bmp, streamside zone, smz, 1099-s, selling costs, replant, burn after thinning, lump sum, pay as cut, stumpage, per ton, mbf, doyle, scribner, settlement, logger, scale tickets, loads, allocation, by stand acres, manual percentages, contract upload, harvest type, clearcut, thinning, delivered price, deposit, delete sale
---
## Recording a sale

Timber sales are a tab of the Leases section, and the Timber page has a **Timber sales** button. An admin starts one with **+ New timber sale**, then either **Upload contract and extract terms** or **Enter terms manually**.

The form takes the sale name, buyer, harvest type, contract date, harvest deadline, performance deposit, total sale acres, and whether it is **Lump sum** (one price, with an optional payment schedule) or **Pay as cut** (stumpage rates per product). **Add standard products** fills in pine sawtimber, chip-n-saw, pulpwood, hardwood sawtimber and pulpwood, poles, veneer, crossties, and chips; **+ Custom product** adds your own. Each rate is per ton or per thousand board feet (MBF) with a log scale. A delivered-price arrangement (mill price less cut and haul) is Pay as cut with net rates and the box **Delivered price sale (rates are NET of cut and haul)** ticked.

Under **Timber stands this sale covers**, tick the stands being cut. More can be linked later with **+ Link stand** on the sale's page. A sale with no stand linked is not tied to any property, so it is left out of the timber basis page and the timber tax summary.

With an uploaded contract the app reads it, fills in the terms, and marks the stands it thinks match as "Suggested from contract". Fields it was unsure about are amber. You review everything before it saves, and the contract file is attached to the sale.

## Sale steps

Each sale page opens with **Sale steps**, the path from planning to after the harvest: Planning, Cruise, Bids, Contract, Harvest, Closeout, Done. Tap a step to see it, and **Move the sale to** that step when you get there (a sale entered earlier starts at the step its records suggest). Each step says what it is for and has a short checklist (Yes, No, or N/A), drawn from Alabama Extension's "How Timber Is Sold" and the Forestry Commission's contract considerations:

- **Planning**: the reason for the sale, a consulting forester hired (with the fee, as a percent), ownership and lines confirmed.
- **Cruise**: the timber measured, lines and streamside zones marked (35 feet or more each side of a stream), and your minimum acceptable bid.
- **Bids**: the notice of sale, the bid opening date, and the sealed bids received. Turnrow lists them highest first, shows how far apart they are, says whether the high bid meets your minimum, and lets you mark the winner.
- **Contract**: the clauses to check: payment terms, cut-out deadline, performance deposit, BMPs, closeout of roads and crossings, damage to trees and improvements, insurance, the buyer's own volume estimate, access.
- **Harvest**: when logging started and finished, inspections, settlements matched to scale tickets.
- **Closeout**: the closeout walk, BMP check, roads and gates, the deposit returned, the final settlement.
- **Done**: the 1099-S (received, amount), links to record the depletion on each property's timber basis, and the next step: **Schedule replanting** after a clearcut or salvage, or **Schedule the burn** after a first or second thinning, which adds planned work to the stands.

Checklist answers save as you tap them. The names, dates, and amounts on a step save with **Save these details**. **Show every step** lists all the checklists at once.

**Selling costs** (the forester's fee, a cruise for the sale, legal) are entered on the sale page, below the steps. Link the sale's stands first: each cost is filed under a property the sale covers, and when the sale covers more than one you pick which. Costs entered here lower the taxable gain on the timber basis page and the timber tax summary. With a fee percent set, the page shows what that comes to on the dollars received. These figures are for your accountant: confirm with them before filing.

## Settlements

A pay as cut sale collects its money as settlements, one per logger check. A lump sum sale has a Payments section instead (see below).

**Upload settlement** reads a PDF, a photo, or the logger's Excel or CSV file; spreadsheets collapse load-by-load rows into product totals. The review shows the settlement date, the period, the check number, and a line per product (tons or MBF, rate, amount, and load count when the file has it). Rates that do not match the contract are flagged, not blocked, and the file is attached to the sale. **+ Enter settlement** records one by hand from the quantities, at the contract's rates.

- A settlement needs a date. The date decides which tax year the income counts in.
- If a settlement looks like one already on the sale (the same check number, or the same date and total), the app asks before saving, because saving it twice would count the income twice.
- An admin can delete a settlement. Depletion already recorded for it on the timber basis page is not changed; use **Remove and redo** there.

Settlements count directly as timber income.

## Lump sum payments

On a lump sum sale, an admin presses **Generate expected payments**. It uses the payment schedule, or with no schedule the sale price due on the contract date (the harvest deadline when there is no contract date). **Record payment** records a check against an expected payment, and **Record unscheduled payment** takes money that is not on the schedule.

## Allocation across stands

Under **Allocate dollars to stands**, income is spread across the linked stands with **By stand acres** (the default), **Manual percentages** you set, or **Keep at sale level** (not spread at all). An uploaded settlement can use a different split from the sale's. The allocated amounts show on each stand page.

- Manual percentages count only when they add up to 100. Until they do, the dollars are split by stand acres and the page says so. A new sale cannot be saved with manual percentages that do not total 100.
- In a split by acres, a linked stand with no drawn boundary gets no share. The page warns you; draw the boundary or use manual percentages.

## Deleting a sale

An admin can delete a sale with **Delete timber sale** at the bottom of its page, after a confirmation. Its settlements, payments received, expected payments, bids, and stand links are deleted with it. Depletion already recorded for it on the timber basis page stays, so remove that first if it should not count. Costs and stand work entered for the sale also stay and are only unlinked from it. Documents attached to the sale are not deleted.

## Common questions

- **The check covers two sales.** Record two settlements, one on each sale, with that sale's quantities.
- **We were paid before cutting started.** On a lump sum sale, use **Record payment** or **Record unscheduled payment**. On a pay as cut sale, money is recorded as settlements, and one entered by hand needs a quantity for at least one product.
- **Marking a thinning complete.** When a first or second thinning sale's **Status** is set to Completed (under **Edit contract terms**), the sale page offers to set the last thinning year on its stands. Check the year and the stands, then press **Set on checked stands**.
- **The sale is at Done but still shows Active.** The steps and the Status are separate. Change the Status under **Edit contract terms**.
