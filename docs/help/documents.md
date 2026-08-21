---
title: Documents
route: /documents
group: Documents
order: 1
updated: 2026-08-21
keywords: documents, vault, land index, aliases, also called, evidence, retry, upload, drop, deed, warranty, quitclaim, title insurance, survey, plat, legal description, easement deed, mortgage, fsa 156, crp, nrcs, wetland determination, hel, appraisal, timber cruise, management plan, insurance policy, hunting agreement, current use, classify, type, scan, extract, search, retype, rename, title, review titles, replace file, versions, notes, photos, delete, unfiled, manual, document page
---
## The vault

Every file you attach anywhere (property, parcel, lease, timber sale, easement, asset, entity, tax statement) lives in Documents as one list, newest first. Each card shows the document's title, its type, and the properties it applies to. Tap a card to open the document's page.

**Finding things.** Search at the top looks at titles, what was read out of the file, and the original file name. The dropdown beside it narrows to one property, one entity, or Unfiled. On a desktop the rail on the left lists the kinds of documents (Title and ownership, Surveys and legal, Encumbrances and debt, Government and conservation, Valuation and management, Insurance and agreements, Other) with counts; pick one to see its specific types. On a phone the same kinds are a row of chips you can scroll sideways. **Group by** adds section headers by type or by property when you want them; the default is a plain list.

## Titles

Every document has a title, and that is what you see everywhere (lists, the sections on property and lease pages, search). The original file name is kept and shown small on the document's page. Titles follow a pattern by type so a list reads the same way throughout: "Warranty Deed - Smith to Jones (2014)", "Survey Plat - River Place, 120.0 acres (2009)", "FSA-156EZ - Farm 1234 (2024)", "Title Insurance - River Place ($250,000.00, 2014)". The upload proposes one from what it reads; you can change it on the confirm screen or any time later.

**Renaming.** Tap the pencil on a card or on the document page, type, and press Enter. Escape cancels.

**Review titles.** Documents uploaded before titles existed show a "Review N titles" link beside Upload. That screen proposes a title for each from its extracted fields (or its cleaned file name), old next to new. Edit any, press Enter to save and move to the next, or apply them all at once. The link disappears when the list is empty.

## The document page

Opening a document shows the file itself (pages you can step through, or the photo) beside its details on a desktop, above them on a phone. Everything in the details panel is editable in place:

- **Title** and **type**. Changing the type offers to read the document again with the fields that type uses.
- **Properties** it applies to, with the reason the reader attached each one ("parcel 12-03-07 matches River Place") when the upload did it. Add or remove properties with Edit.
- **What was read**: the key fields for its type. Edit them, or press Rescan to read the document again; the result shows for review, amber where unsure, before anything is saved.
- **Notes**, free text.

Buttons at the top take you on to what the document feeds: **Plot boundary** for deeds, plats, and legal descriptions; **View FSA farm** for a 156EZ; **View easement** for an easement deed; **View boundary** when a plot was saved from it.

**Download** opens the file. **Replace file** swaps in a new file while keeping the record, its properties, and its fields; the old file is kept and listed under Previous versions. **Delete** removes the document and every version of its file after you confirm, and takes it off every property.

The footer shows who uploaded it and when, the original file name, its size, and the dates it was read.

## Uploading: drop, confirm, save

There is one way to add a document, and it starts with the file.

1. **Drop the file** (or choose it, or take a photo). No type to pick, no property to pick first.
2. **Confirm what was found.** The app reads the document once and shows, beside a preview of the file: the type it believes it is (with how confident it is), a proposed title, the properties it thinks the document concerns with a one-line reason for each ("parcel 12-03-07 matches River Place"), the entity when a party name matches one of yours, and the key fields for that type (grantor and grantee, recording reference, the legal description, policy amounts, FSA farms and base acres, and so on). Fields the reader was unsure about are amber. Everything is editable. A document that covers land in several properties can be attached to all of them.
3. **Save.** The file, its title, type, attachments, and the reviewed fields are stored together. Then you get the next steps that fit the type: plot a boundary from a deed or plat, or create FSA farm records from a 156EZ.

Property matches are checked against your own records before they are shown: a parcel or farm number the reader cites has to actually be on that property, and a name has to actually be on the page. A claim that does not check out is dropped rather than shown with false confidence. When nothing matches, the property list simply starts empty; pick one or leave it and the document lands in **Unfiled**, where you can assign properties later from its page.

**Uploading from a page** (a property, entity, stand, sale, or lease) attaches the document to that page by default. The reader still runs, and if its evidence points somewhere else you get a note ("this deed appears to describe River Place") with one tap to switch or to attach to both. When it agrees or finds nothing, the page wins quietly.

**Leases, timber contracts and settlements, tax statements, and rent payments** have their own intake that reads the terms and files them in the right place. If you drop one of those here, the confirm screen offers to open it there in one tap; nothing is saved until you do.

**Entering details by hand.** A quiet "Enter details manually instead" link sits on the upload and confirm screens. It switches to a plain form (type, properties, an optional record, title, and the type's fields), keeping your file. If the reader had already made suggestions, you choose whether to keep them as starting values. If a file cannot be read at all, you land on that form with a short message and the file attached; there is no dead end and no retry loop.

Older files uploaded before types existed sit under Other; the **Type untyped** screen lets you classify them and apply in bulk.

## Scanning again

**Rescan** on a document's page re-reads the key fields for its type and shows them for review, amber where unsure, before saving. Saved fields show on the page and on the attached records, and they are searchable. Confirming a 156EZ creates or updates the FSA farms and base acres used by Government Payments.

## Plot boundary

Deeds, plats, and legal descriptions offer **Plot boundary**: the app reads the legal description and turns it into a boundary on the map. See the next topic.

## Common questions

- **Photos of a well or barn?** Asset pages have an Add photos button for gallery photos; those are stored as-is without reading.
- **Where did Open go on the list?** Tap the card to open the document's page; Download there opens the file itself.
- **Who can see my documents?** Only members of your organization.

## A plotted boundary landed in the wrong place

See "Why did my plot land in the wrong place?" under Plotting a boundary from a deed. In short: the survey (principal meridian) now comes from the county the deed states and is never left open, and the resolved section is checked against that county before you can save, with one-tap retries for a flipped direction letter or the other survey.

## How the description match works

When a deed or plat carries a section, township, and range, the upload reads every such reference, both from what the reader returned and straight from the verbatim description (so a tract is never missed and a direction letter is never swapped), pins the principal meridian from the county the deed names, finds each section (instantly from your land index when the section is on land you own, otherwise from the BLM PLSS service), and checks it against that county. The described tracts are laid over your boundaries and the confirm screen shows "Evidence from the description": which properties and parcels they overlap and by how much.

**When the description is a portion of a section** ("south and west of Sandy Branch", "the part lying north of the road") rather than quarters, the whole section is used as a search window. If the deed states an acreage ("containing 120 acres") and one parcel inside that section is within 15 percent of it, that parcel is named as the tract itself and offered as the specific record; otherwise only the property with the largest share of the section is pre-checked, and the neighbors in the same section are listed without a check mark.

**When nothing computed**, the screen says why (no section, township, and range were read; the section lookup did not finish; the county check failed) and offers Retry, which re-runs the check without reading the document again. The same evidence is saved with the document and shown on its page, where "Check the description again" re-runs it any time.

**Your land index.** The first upload after a boundary changes quietly records which survey sections each of your properties and parcels touches. Matching then works by lookup, with no live call to wait on.

**Names your family uses.** Deeds call tracts by old names ("View Celeste", "the Martin homeplace") that your property records do not. After an upload, the saved panel offers to remember such a name for the property you attached; from then on the reader is told the name and matches on it. Aliases are listed on the property page under "Also called" and can be removed there.

Two things to know:

- If the county check fails (the section resolved somewhere else), the description is not used for matching and the screen says so. Open Plot boundary to correct the township or range direction.
- If a parcel or farm number points to one property and the description overlaps another, both are listed with their evidence and nothing is pre-checked. You pick.
