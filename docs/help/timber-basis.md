---
title: Timber basis and depletion
route: /timber/basis
group: Timber
order: 2
updated: 2026-11-14
keywords: timber basis, basis, depletion, depletion allowance, cost basis, stepped-up basis, inherited, inheritance, date of death, gift, carryover, purchase, closing statement, cruise, appraisal, retroactive appraisal, form t, taxable gain, capital gain, timber tax, per ton, timber account, casualty loss, volume adjustment, tax year, remove and redo, selling costs
---
## What basis is, in one line

Your **basis** in timber is what it cost you (or what it was worth when you inherited it). When timber sells, you are taxed on the proceeds minus selling costs minus the basis of the timber that was cut, called **depletion**. With no basis on record, the IRS treats it as zero and the whole check is taxable. Everything here is for your accountant: confirm with them before filing.

## Setting up a tract (once)

Timber, then **Timber basis**, lists every property with timber stands. **Set up timber basis** asks:

- **Who owns the timber**: the entity that files the taxes (defaults to the property's entity).
- **How it came to them**: bought it, inherited it, received it as a gift, put into the LLC or trust by the family, or not sure. Each choice explains what sets the basis: for a purchase, the timber's share of the price plus closing costs; for an inheritance, the value on the date of death (stepped up); for a gift, the giver's basis carries over.
- **When**, and **what the whole property was worth** then.
- **How much was timber**: the timber, bare land, and improvements split from the closing statement or appraisal. If you have appraised values that do not add up to the price, enter them and use **Split the price by these values**: the price is divided in proportion (the USDA example: a $33,000.00 purchase with land appraised at $10,000.00 and timber at $20,000.00 gives a $22,000.00 timber basis).
- **Where the timber number comes from**: closing statement, cruise, appraisal, estate appraisal, retroactive appraisal, your own estimate, or no record yet.
- **Timber by product (optional)**: if a cruise counted the timber, enter each product (pine sawtimber, pulpwood, ...) with its volume and its share of the value. Without volumes, one "All timber" line is fine. With two or more products, their values must add up to the Timber value before it saves.

No record of the value? That is common. A consulting forester can do a **retroactive appraisal** that works the timber back to the date you got it.

Each property has one timber basis account. Tap its name on the Timber basis page to open it; **Edit setup** changes the answers later. A product that already has depletion or adjustments in the ledger cannot be removed until those entries are removed.

## At a sale

A tract's page lists every timber sale on its stands with what this tract received (its share, when a sale covers more than one property), the selling costs tied to that sale, the depletion, and the approximate taxable gain. Selling costs count here only when they are linked to the sale: entered under **Selling costs** on the sale's page, or on a Thinned or Harvested entry with that sale picked.

Depletion belongs to the tax year the timber was cut and paid for, so it is proposed and recorded one tax year at a time, from the settlements dated in that year. A sale whose settlements run across two years gets entries in both years. Settlements already covered by recorded depletion are not proposed again; only what has been cut since is.

- **Settlements with volumes**: the settlements say how many tons of each product were cut, so Turnrow proposes depletion as tons times the basis per ton (USDA: 500 tons of sawtimber at $10.00 and 3,000 tons of pulpwood at $1.00 recover $8,000.00). **Use this** records it, and the button says how much goes in each year.
- **Lump sum, or no volumes on record**: answer "About how much of this tract's timber was sold?" as a percent (a clearcut of the whole tract is 100), and Turnrow proposes that share of the basis. When there are settlements in more than one year, it asks about one year at a time, earliest first.
- **Remove and redo** takes a sale's recorded depletion back out. It names the amount and asks first. Use it when a settlement was entered after the depletion was recorded, or when depletion recorded in one lump should be split by year; the page tells you when either applies.

Depletion never goes past the basis or volume on record; if more was cut than the account shows, it says so, and an entry larger than the basis left is refused.

## The ledger

Every change to basis is a line: depletion from a sale, a cost added to basis, a volume adjustment (a new cruise, growth since you acquired it), a casualty loss (storm, fire, beetles), or another adjustment. **+ Add an adjustment** enters one by hand, with its date, since the date decides which tax year it counts in. **Remove** deletes a line after asking. **Basis left** and the basis per ton or per MBF are worked out from the lines; nothing is overwritten, and Basis left never shows below $0.00.

## Evidence

Attach the closing statement, estate appraisal, or cruise to the tract under **Evidence**. Keep them as long as you own the land plus the years a return can be examined.

## Common questions

- **Do I need Form T?** The tax summary says it is likely needed in a year depletion is claimed. Ask your accountant.
- **The per-ton number looks wrong.** It is the basis left divided by the volume on record. A new cruise posted as a volume adjustment corrects it.
- **Two entities own parts of one property.** The app keeps one timber basis account per property, with one owner. If ownership is split, keep the land as two properties, one per owner, each with its own stands and its own account.
- **The Selling costs figure is $0.00, but we paid the forester.** The cost is not linked to the sale. Enter it under **Selling costs** on the sale's page.
