---
title: Property taxes
route: /taxes
group: Property Taxes
order: 1
updated: 2026-09-08
keywords: property tax, statement, upload, account, parcel match, PPIN, identifiers, lines, reconcile, completeness, unpaid, delinquent, due date, batch pay, check number, county calendar, assessed value, appraised value, personal property, tax year, entity, taxpayer, change report, year over year, effective rate, current use, class iii, homestead, exemption, appeal, spike, pdf
---
## What this page is for

Track every county tax statement and what you paid on it, and make sure every parcel is covered each year. A missing statement is how a parcel quietly goes delinquent.

## Statements and their lines

A statement is how the county billed you: a county, the number it bills on (an account number, a receipt or key number, or the parcel number), the taxpayer as printed, the tax year, the total, and the due and delinquent dates. Under it are its **lines**, one per parcel block printed on the statement, each with every number the county printed for it, its appraised and assessed values, and its share of the tax. One statement in Lawrence County can cover a whole account across many parcels; a Morgan County statement covers one.

The page counts a parcel as covered for a year when a line links to it. Business personal property lines are never parcels: they count in what you owe and paid, under the statement's entity, but not in parcel coverage.

A statement whose lines do not add up to its total shows an amber chip with the gap. It is never hidden; open the statement and fix the line that was misread.

## Uploading statements

Upload one PDF with many statements in it, or several files, or photos. The app first sorts the pages into statements (a whole-account bill repeats its account number and total on every page, so ten pages become one statement), then reads each statement's header and lines. Handwritten notes on the pages are ignored. You review a list of the statements found (county, account, taxpayer and entity, year, total, lines, whether the lines reconcile), open any to check its lines, and confirm one at a time or all at once. Nothing saves without confirmation. Each confirmed statement also files its source PDF in Documents under Property taxes, linked back to the statement; deleting a statement offers to remove the file too (a PDF shared by other statements stays).

## How parcels are matched

Every number a county prints for a parcel is remembered on that parcel: parcel number, PPIN, account, key, receipt, and whatever else the county uses. A line matches when one of its printed numbers equals a remembered one, in any spacing or punctuation; the evidence says which number matched. County imports seed the same store from the county's records, and Settings > Admin can refresh every parcel in a county from those records at any time (each parcel page has the same "Refresh from county records" action).

**When nothing on file matches**, the app asks the county's own GIS records for the printed number. Where the county's service is registered with its identifier fields mapped (an admin setting; Alabama's KCS counties carry PPIN and PIN), the county answers with the parcel that number belongs to, and the line matches to your parcel by parcel number, or by map overlap when the county records the number differently. The evidence then reads like "PPIN 2471 resolved via Colbert County GIS to parcel 11 07 26 0 000 001.001 on Cottontown". Confirming saves the printed number and the county's other numbers to the parcel, so the next statement matches straight from your own records without asking the county. If the county resolves the number to a parcel you have not mapped, the line offers "Import this parcel", which opens the county import with that parcel already found. If the county's server is down, the line simply stays unmatched with a note, and the Property Taxes page asks again the next time you open it.

**Why a first-year statement may still need one confirmation.** Parcels imported before the app kept county attributes, or whose county has no registered service or no mapped identifier fields, carry only their parcel number. A statement that prints only a PPIN cannot match such a parcel until the number is learned: confirm the line by hand once (or run the county refresh in Settings > Admin first), and every later year matches on its own. The "Also save the printed numbers to this parcel" box on a hand match is on by default; untick it only when you are matching a line to a parcel whose printed number belongs to something else.

When no number matches, a printed legal description can still place the line through the same description matching the document upload uses, labeled as such. Lines that still do not match wait in the Unmatched section with a "Match to parcel" control; matching there teaches the parcel the same way.

## Taxpayer and entity

The taxpayer name as printed is matched to your entities, tolerating county typos, and a "C/O" name is the signal when the county bills in care of someone. Confirming a statement registers its account to that entity and saves the printed spelling, so later statements on the same account are labeled instantly.

## The Tax Change Report

Once two or more years of statements are loaded, the **Tax change report** section compares each parcel's lines year over year. Pick the years, entities (the same multi-select chips as Income), a property or county, and a spike threshold, and it shows:

- Total tax and appraised value for both years with percent changes, and a small trend chart across every year in between.
- **Biggest movers**: each parcel's values, tax, and effective rate (tax divided by appraised value), with a plain sentence splitting the change ("Up $412.00: $300.00 from higher appraisal, $112.00 from rates").
- **Flags**, the part worth reading first: an assessment ratio (assessed over appraised) jumping from 10% to 20% usually means current use (Class III) was lost and is worth a call to the revenue commissioner; an exemption code like H1 disappearing is the homestead version of the same problem; a value spike past the threshold is an appeal-review candidate; and parcels present one year but missing the other are listed rather than silently dropped.

**Export PDF** produces the report in the print style for a CPA or an appeal filing. A restricted user's report covers only their granted entities.

## Paying

Record a payment on a statement (partial payments are fine) or select several statements and record one check across all of them. A payment applies to the whole statement; Income and the parcel and property pages spread it across the statement's parcels by each line's share of the tax. Status is always computed from payments, never typed.

## Due dates

The dates come from the statement when it prints them. When it does not, the county calendar applies: Alabama's default is due October 1 and delinquent January 1, and a county whose statement you have confirmed keeps the dates it printed for the next one.

## Common questions

- **The same parcel shows twice.** One line per parcel per year is allowed across all statements; the upload warns on a duplicate.
- **Taxes in Income?** Statement totals count as expected expense and payments as actual, netted against rent and timber income and routed to properties by line.
- **A statement landed on the wrong entity.** Open it and change the entity; the account registration follows.
