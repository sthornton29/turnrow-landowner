---
title: Property taxes
route: /taxes
group: Property Taxes
order: 1
updated: 2026-11-14
keywords: property tax, statement, upload, account, parcel match, PPIN, identifiers, lines, reconcile, completeness, unpaid, delinquent, past due, due date, last day to pay, batch pay, check number, county calendar, remember dates, confirm all ready, delete statement, assessed value, appraised value, personal property, tax year, entity, taxpayer, change report, year over year, effective rate, current use, class iii, homestead, exemption, appeal, spike, pdf
---
## What this page is for

Track every county tax statement and what you paid on it, and make sure every parcel is covered each year. A missing statement is how a parcel quietly goes delinquent.

The page opens on the latest tax year that has statements. Pick another year from the tax year list at the top. Tiles show the parcels, how many are on a statement, total due, total paid, and outstanding for that year. When your land sits in entities, a table breaks the year down by entity, and the entity list at the top narrows the page to one.

Two notices can sit above the year view:

- A red **Past due** box lists statements from any year that still have a balance after their delinquent date, each with a link to show it in its own tax year. If one was paid, record the payment on its statement.
- From October 1, an amber note says so when no statements for the current year are on file yet.

Parcels not yet on a statement for the year are listed by property (expand one to see its parcel numbers). One statement usually covers a whole property, so one upload clears the row.

**Tax report** opens the report for the year shown. See the Property tax report topic.

## Statements and their lines

A statement is how the county billed you: a county, the number it bills on (an account number, a receipt or key number, or the parcel number), the taxpayer as printed, the tax year, the total, and the due and delinquent dates. Under it are its **lines**, one per parcel block printed on the statement, each with the numbers the county printed for it, its appraised and assessed values, and its tax. One statement can cover a whole account across many parcels, or a single parcel. Tap **Details** on a statement to see its lines, its payments, and the uploaded file.

The page counts a parcel as covered for a year when a line links to it. Business personal property lines are never parcels: they count in what you owe and paid, under the statement's entity, but not in parcel coverage.

A statement whose lines do not add up to its total shows an amber chip with both figures. It is never hidden. Saved lines cannot be edited. If a line was misread, have an admin delete the statement under **Details** and upload the bill again, correcting the line in the review before confirming. Deleting also removes the payments recorded on the statement, so note them first.

## Uploading statements

Uploading is for admins. Tap **+ Upload statements**, then drop PDFs or photos, or tap **Choose files**. One file can hold many statements, and you can add several files.

The app first sorts the pages into statements (a whole-account bill repeats its account number and total on every page, so ten pages become one statement), then reads each statement's header and lines. Handwritten notes on the pages are ignored. Pages that were not read as statements, such as a cover letter, are listed under the file name so you can check them.

You then review the statements found. Each row shows the county, year, billing number, taxpayer, entity, total, number of lines, and whether the lines reconcile, and is marked **Ready** or **Needs** with what is missing. Open a row to check its header and lines. Fields the reader was unsure of are outlined in amber. On each line you can keep the matched parcel, pick another, choose **Create the parcel...**, or **Leave unmatched (resolve later)**.

- **Confirm statement** saves one. It stays off while something required is missing: the county, the tax year, the total, a tax amount on every line, dates that fit the tax year, a parcel choice where several match, or the number and property of a parcel you are creating.
- **Confirm all ready** saves every statement marked Ready. A statement with something to check is left out: lines that do not reconcile, dates the app replaced, an entity to pick, or a county, tax year, dollar amount, date, or printed number the reader was unsure of. Open it and confirm it on its own.
- **Skip this statement** leaves one out.

Nothing saves without confirmation. Each confirmed statement files its source file in Documents under Property taxes, linked back to the statement.

**Deleting a statement.** **Delete statement**, under **Details**, is for admins and asks first. It then removes the statement with its lines, its recorded payments, and the files attached to it. When one uploaded PDF holds several statements, the file is kept for the others until the last of them is deleted.

**Additional bills.** Some years a county prints a parcel twice on one statement, its regular tax and an additional bill. Those are saved as one line for the parcel with the two amounts added together, since a parcel carries one line per tax year. The review shows which lines will be combined before you confirm.

**Postcard bills and master receipts.** A bill that prints only a total (no parcel lines) can still be confirmed; the gap is kept on the statement and shown on the Property Taxes page. A county master receipt that summarizes several accounts may be read as its own statement; use **Skip this statement**, because the accounts on it are already counted on their own statements.

## How parcels are matched

The numbers a county prints for a parcel are remembered on that parcel: parcel number, PPIN, account, key, and whatever else the county uses. Receipt, bill, and duplicate numbers change every year, so they stay on the line as printed but are never saved to a parcel or used to match. A line matches when one of its printed numbers equals a remembered one, in any spacing or punctuation; the evidence says which number matched. Matching stays inside the statement's county, because the same number can belong to different land in another county.

County imports seed the same store from the county's records, and each parcel page has a **Refresh from county records** action under Identifiers. A platform administrator can also refresh every parcel in a county from Settings.

**When nothing on file matches**, the app asks the county's own GIS records for the printed number. Where the county's service is registered with its identifier fields mapped (a platform administrator sets this up), the county answers with the parcel that number belongs to, and the line matches to your parcel by parcel number, or by map overlap when the county records the number differently. The evidence then reads like "PPIN 2471 resolved via Colbert County GIS to parcel 11 07 26 0 000 001.001 on Cottontown". Confirming saves the printed number and the county's other numbers to the parcel, so the next statement matches straight from your own records without asking the county. If the county resolves the number to a parcel you have not mapped, the line offers **Import this parcel**, which opens the county import with that parcel already found. If the county's server is down, the line stays unmatched with a note, and the Property Taxes page asks again the next time you open it.

**Why a first-year statement may still need one confirmation.** Parcels imported before the app kept county attributes, or whose county has no registered service or no mapped identifier fields, carry only their parcel number. A statement that prints only a PPIN cannot match such a parcel until the number is learned: match the line by hand once (or use **Refresh from county records** on the parcel page first), and every later year matches on its own. The **Also save the printed numbers to this parcel** box on a hand match is on by default; untick it only when you are matching a line to a parcel whose printed number belongs to something else.

Lines that still do not match wait under **Unmatched lines** on the Property Taxes page, each with a **Match to parcel...** list and a **Match** button. Matching there teaches the parcel the same way.

## Taxpayer and entity

The taxpayer name as printed is matched to your entities, tolerating county typos, and a "C/O" name is the signal when the county bills in care of someone. When the name fits two entities equally well, or fits one only by an initial, the entity is left blank and the review asks you to pick. Confirming a statement registers its account to that entity and saves the printed spelling, so later statements on the same account are labeled for you.

## The Tax Change Report

Once two or more years of statements are loaded, the **Tax change report** section compares each parcel's lines year over year. Pick the years, entities (the same multi-select chips as Income), a property or county, and a spike threshold, and it shows:

- Total tax and appraised value for both years with percent changes, and a small trend chart across every year in between.
- **Biggest movers**: each parcel's values, tax, and effective rate (tax divided by appraised value), with a plain sentence splitting the change ("Up $412.00: $300.00 from higher appraisal, $112.00 from rates").
- **Flags to check**, the part worth reading first. An assessment ratio (assessed over appraised) moving from 10% to 20% can mean the property's class or its current use status changed; ask the county revenue commissioner which it is and whether anything needs to be filed. An exemption code like H1 that no longer appears is worth checking with the revenue commissioner before the bill is final. A value spike past the threshold is a candidate for appeal review. Parcels present one year but missing the other are listed, not silently dropped.

Some bills print a market value one year and the value the tax was figured on the next. The report does not compare the two: it says the values are not comparable, shows the change in tax only, and raises no spike or ratio flag for that parcel.

**Export PDF** downloads the same report as a PDF. A restricted user's report covers only their granted entities.

## Paying

**Record payment** on a statement takes the date paid, the amount (partial payments are fine), a check number or method, and a memo. To pay several with one check, tick the box on each statement and tap **Record payment for selected**: it records the remaining balance of each with one date and one check number. A payment that would bring the total paid above the statement total asks first, and an overpaid statement shows a chip saying by how much. Recorded payments are listed under **Details**, each with **Delete**.

A payment applies to the whole statement; Income and the parcel and property pages spread it across the statement's parcels by each line's share of the tax. Status (Paid, Partially paid, Unpaid, Delinquent) is always computed from payments and the delinquent date, never typed. Outstanding adds up each statement's own balance, so an overpayment on one statement never hides a balance on another.

## Due dates

The delinquent date is the first late day, so the last day to pay on time is the day before it. A statement turns Delinquent on its delinquent date if a balance remains.

In the upload review, the dates come from the bill only when the bill prints them with their year and they fit the tax year. Otherwise the county's usual dates for that tax year are filled in: Alabama's default is due October 1 of the tax year and delinquent January 1 of the next. A note says so when dates read from the bill were replaced. The dates follow the tax year if you correct it, until you type a date yourself. A statement cannot be saved while its dates do not fit its tax year.

Tick **Remember these due and delinquent dates** in the review to make those dates the usual ones for that county on later uploads. Without the tick, nothing is remembered. These are the app's defaults, not a ruling: confirm the dates with the county.

## Common questions

- **The same parcel is on two statements.** A parcel carries one line per tax year. The upload does not save a statement when one of its lines matches a parcel that already has a line for that year on another statement, and it names the parcel. A statement for the same county, account, and tax year as one already on file is skipped; delete the saved one first if the upload should replace it.
- **Taxes in Income?** Statement totals count as expected expense in their tax year and payments as actual expense in the year they were paid, netted against rent and timber income and routed to properties by line.
- **A statement landed on the wrong entity.** Open **Details** and tap **Change** beside Entity. That changes this statement only. The account stays registered to the earlier entity, so next year's statement arrives labeled with it; pick the right entity in that review and the account is registered to it from then on.
- **Who can see statements?** Admins see everything. Other members see the statements of the entities shared with them; lines not matched to a parcel and personal property lines are visible to admins only.
