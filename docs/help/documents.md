---
title: Documents
route: /documents
group: Documents
order: 1
updated: 2026-08-20
keywords: documents, vault, upload, drop, deed, warranty, quitclaim, title insurance, survey, plat, legal description, easement deed, mortgage, fsa 156, crp, nrcs, wetland determination, hel, appraisal, timber cruise, management plan, insurance policy, hunting agreement, current use, classify, type, scan, extract, search, retype, photos, delete, unfiled, manual
---
## The vault

Every file you attach anywhere (property, parcel, lease, timber sale, easement, asset, entity, tax statement) lives in Documents, grouped by kind: Title and ownership, Surveys and legal, Encumbrances and debt, Government and conservation, Valuation and management, Insurance and agreements, and Other. Filter by property, entity, or type, and search by name or by what was read out of the file. Each row opens the file and links to the things it is attached to.

## Uploading: drop, confirm, save

There is one way to add a document, and it starts with the file.

1. **Drop the file** (or choose it, or take a photo). No type to pick, no property to pick first.
2. **Confirm what was found.** The app reads the document once and shows, beside a preview of the file: the type it believes it is (with how confident it is), the properties it thinks the document concerns with a one-line reason for each ("parcel 12-03-07 matches River Place"), the entity when a party name matches one of yours, and the key fields for that type (grantor and grantee, recording reference, the legal description, policy amounts, FSA farms and base acres, and so on). Fields the reader was unsure about are amber. Everything is editable. A document that covers land in several properties can be attached to all of them.
3. **Save.** The file, its type, its attachments, and the reviewed fields are stored together. Then you get the next steps that fit the type: plot a boundary from a deed or plat, or create FSA farm records from a 156EZ.

Property matches are checked against your own records before they are shown: a parcel or farm number the reader cites has to actually be on that property, and a name has to actually be on the page. A claim that does not check out is dropped rather than shown with false confidence. When nothing matches, the property list simply starts empty; pick one or leave it and the document lands in **Unfiled**, where you can assign properties later from the row.

**Uploading from a page** (a property, entity, stand, sale, or lease) attaches the document to that page by default. The reader still runs, and if its evidence points somewhere else you get a note ("this deed appears to describe River Place") with one tap to switch or to attach to both. When it agrees or finds nothing, the page wins quietly.

**Leases, timber contracts and settlements, tax statements, and rent payments** have their own intake that reads the terms and files them in the right place. If you drop one of those here, the confirm screen offers to open it there in one tap; nothing is saved until you do.

**Entering details by hand.** A quiet "Enter details manually instead" link sits on the upload and confirm screens. It switches to a plain form (type, properties, an optional record, title, and the type's fields), keeping your file. If the reader had already made suggestions, you choose whether to keep them as starting values. If a file cannot be read at all, you land on that form with a short message and the file attached; there is no dead end and no retry loop.

Older files uploaded before types existed sit under Other; the **Type untyped** screen lets you classify them and apply in bulk.

## Scanning again

**Scan this document** on any row re-reads the key fields for its type and shows them for review, amber where unsure, before saving. Saved fields show on the row and on the attached page, and they are searchable. Confirming a 156EZ creates or updates the FSA farms and base acres used by Government Payments.

## Plot boundary

Deeds, plats, and legal descriptions offer **Plot boundary**: the app reads the legal description and turns it into a boundary on the map. See the next topic.

## Deleting

**Delete** on a row removes the file and its record. A document attached to several properties asks whether to take it off just the property you are looking at or delete it everywhere. Deleting cannot be undone.

## Common questions

- **Photos of a well or barn?** Asset pages have an Add photos button for gallery photos; those are stored as-is without reading.
- **Can I rename a file?** Give it a title; the original file name stays.
- **Who can see my documents?** Only members of your organization.

## A plotted boundary landed in the wrong place

See "Why did my plot land in the wrong place?" under Plotting a boundary from a deed. In short: the survey (principal meridian) now comes from the county the deed states and is never left open, and the resolved section is checked against that county before you can save, with one-tap retries for a flipped direction letter or the other survey.

## How the description match works

When a deed or plat carries a section, township, and range, the upload reads those fields exactly as printed, pins the principal meridian from the county the deed names, looks up the section from the BLM PLSS service, and checks that the section really sits in that county. If it does, the described tract is laid over your boundaries and the confirm screen shows "Evidence from the description": which property it overlaps and how much of the described land falls inside it. That overlap is the strongest match there is, so those properties come pre-checked.

Two things to know:

- If the county check fails (the section resolved somewhere else), the description is not used for matching and the screen says so. Open Plot boundary to correct the township or range direction.
- If a parcel or farm number points to one property and the description overlaps another, both are listed with their evidence and nothing is pre-checked. You pick.

