---
title: Property taxes
route: /taxes
group: Property Taxes
order: 1
updated: 2026-08-21
keywords: property tax, statement, upload, account, parcel match, PPIN, identifiers, lines, reconcile, completeness, unpaid, delinquent, due date, batch pay, check number, county calendar, assessed value, appraised value, personal property, tax year, entity, taxpayer
---
## What this page is for

Track every county tax statement and what you paid on it, and make sure every parcel is covered each year. A missing statement is how a parcel quietly goes delinquent.

## Statements and their lines

A statement is how the county billed you: a county, the number it bills on (an account number, a receipt or key number, or the parcel number), the taxpayer as printed, the tax year, the total, and the due and delinquent dates. Under it are its **lines**, one per parcel block printed on the statement, each with every number the county printed for it, its appraised and assessed values, and its share of the tax. One statement in Lawrence County can cover a whole account across many parcels; a Morgan County statement covers one.

The page counts a parcel as covered for a year when a line links to it. Business personal property lines are never parcels: they count in what you owe and paid, under the statement's entity, but not in parcel coverage.

A statement whose lines do not add up to its total shows an amber chip with the gap. It is never hidden; open the statement and fix the line that was misread.

## Uploading statements

Upload one PDF with many statements in it, or several files, or photos. The app first sorts the pages into statements (a whole-account bill repeats its account number and total on every page, so ten pages become one statement), then reads each statement's header and lines. Handwritten notes on the pages are ignored. You review a list of the statements found (county, account, taxpayer and entity, year, total, lines, whether the lines reconcile), open any to check its lines, and confirm one at a time or all at once. Nothing saves without confirmation.

## How parcels are matched

Every number a county prints for a parcel is remembered on that parcel: parcel number, PPIN, account, key, receipt, and whatever else the county uses. A line matches when one of its printed numbers equals a remembered one, in any spacing or punctuation; the evidence says which number matched. The first statement from a county may need you to match a line by hand; when you confirm it, every number printed on that line is saved to the parcel, so the next year's statement from that county matches on its own. County imports seed the same store from the county's records.

When no number matches, a printed legal description can still place the line through the same description matching the document upload uses, labeled as such. Lines that still do not match wait in the Unmatched section with a "Match to parcel" control; matching there teaches the parcel the same way.

## Taxpayer and entity

The taxpayer name as printed is matched to your entities, tolerating county typos, and a "C/O" name is the signal when the county bills in care of someone. Confirming a statement registers its account to that entity and saves the printed spelling, so later statements on the same account are labeled instantly.

## Paying

Record a payment on a statement (partial payments are fine) or select several statements and record one check across all of them. A payment applies to the whole statement; Income and the parcel and property pages spread it across the statement's parcels by each line's share of the tax. Status is always computed from payments, never typed.

## Due dates

The dates come from the statement when it prints them. When it does not, the county calendar applies: Alabama's default is due October 1 and delinquent January 1, and a county whose statement you have confirmed keeps the dates it printed for the next one.

## Common questions

- **The same parcel shows twice.** One line per parcel per year is allowed across all statements; the upload warns on a duplicate.
- **Taxes in Income?** Statement totals count as expected expense and payments as actual, netted against rent and timber income and routed to properties by line.
- **A statement landed on the wrong entity.** Open it and change the entity; the account registration follows.
