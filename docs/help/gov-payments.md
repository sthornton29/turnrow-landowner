---
title: Government payments
route: /gov-payments
group: Gov Payments
order: 1
updated: 2026-11-14
keywords: government payments, fsa, farm number, base acres, plc yield, plc, arc, arc-co, arc-ic, election, reference price, mya, marketing year, payment year, program year, october, sequestration, payment factor, tenant share, your share, estimate, 156ez, commodity, corn, soybeans, wheat, cotton, peanuts, link a property, percentages total 100, drivers, benchmark
---
## What this page is for

Base acres tied to your land generate USDA program payments (PLC or ARC) every year, paid to whoever farms it. This page records the FSA farms on your land, their base acres and PLC yields by commodity, and the program election, and projects what those acres are expected to pay, so you know what they are worth when you talk leases.

These are estimates. FSA determines actual payments after the marketing year closes.

## What the page shows

- **By payment year** and **By program year** switch the framing, and the year buttons pick the year. The program year is the crop year; FSA pays it in October of the following year. So in the payment-year view, 2026 shows the 2025 program (paid October 2026), and in the program-year view, 2026 shows the 2026 program (paid October 2027). A line under the title always says which program year is on screen.
- Entity chips limit the figures to the entities you tap.
- Three tiles: **Projected payments on your land** (after the payment factor and sequestration), **Your share under leases**, and **Prices in use**.
- **By property, farm, and commodity**: base acres, PLC yield, the election, the rate per acre, and the projected payment. **Drivers** on a row shows the numbers behind it.
- **How these numbers are computed** at the bottom spells out the formulas and sources.

## Setting it up

Open **FSA farms and base acres** and tap **Manage**.

- **FSA farms**: an admin taps **+ Add an FSA farm** and enters the farm number, state, county, farmland acres, cropland acres, and DCP cropland. Scanning an FSA-156EZ in Documents creates or updates the farms and base acres for you after your review. Adding a farm is for admins.
- **Properties**: **+ Link a property** ties the farm to the property it sits on. When one farm spans several properties, give each its percentage. A farm's percentages should total 100. Over 100 counts more than the farm's payment; under 100 leaves part of it on no property. Admins see an amber warning naming any farm that is off.
- **Base acres**: per commodity, the base acres and the PLC yield. Pick from **+ Commodity** and tap **Add**.
- **Election**: PLC, ARC-CO, or ARC-IC per commodity for the program year, chosen in the table. PLC is used when nothing is recorded.

**Delete** on a farm removes the farm and its base acres after asking. Removing a property from a farm also asks first; the property and the farm are kept.

## How the estimate works, in plain language

- **PLC** pays when the season's average price falls below the commodity's effective reference price (the loan rate is used when it is higher than the season price). The payment is that gap times the PLC yield times base acres, then reduced by the payment factor (85 percent) and sequestration.
- **ARC-CO** pays when county revenue (county yield times price) falls below 90 percent of the county's benchmark revenue, capped at 12 percent of the benchmark, then reduced the same way. For program years before 2025 those figures are 86 and 10 percent. County benchmarks come from FSA's published workbook. When no benchmark is on file for the county, the row shows n/a and counts as $0.00; open **Drivers** and tap **Look up the FSA county benchmark**.
- **ARC-IC** pays on a farm's own revenue, which is not modeled. Those rows show n/a and count as $0.00.
- **Prices**: USDA's final season price when there is one, otherwise an estimate blended from USDA's published monthly prices. **Refresh from USDA NASS** on the Prices in use tile shows the latest blend. Program parameters (reference prices, loan rates, factors) and the saved season prices are kept current by Turnrow.

Payment limits are not modeled; those apply to the person receiving the payment.

## Leases and income

Crop share and flex leases ask one question under **Government payments (ARC/PLC)**: does the landowner receive a share, or does the tenant retain all of it? When you receive a share, the lease records **Your share (%)** and whether FSA pays you directly or the tenant remits it.

The **Your share under leases** tile lists each of those leases with its answer (leases marked Expired or Terminated are left out). Your share flows into Income as a Government payments line in the payment year; Income projects it for last year, this year, and next year. When every lease leaves the payments with the tenant, the tile reads "base acres on this land generate approximately" the projected amount "to your tenant", and Income counts none of it and shows the figure only as a note.

## Common questions

- **A price reads "no MYA".** No season price is on file yet for that commodity and year, usually because USDA has not published enough months. Rows that need it show n/a until it is.
- **A farm shows under "Farms not linked to a property".** Link it to a property under FSA farms and base acres so its payment counts on that land.
- **I cannot add a farm.** Adding an FSA farm is done by an admin on your account.
