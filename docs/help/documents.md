---
title: Documents
route: /documents
group: Documents
order: 1
updated: 2026-11-14
keywords: documents, bulk upload, many files, folder, batch, several documents, vault, land index, aliases, also called, evidence, retry, upload, drop, deed, warranty, quitclaim, title insurance, survey, plat, legal description, easement deed, mortgage, fsa 156, crp, nrcs, wetland determination, hel, appraisal, timber cruise, management plan, insurance policy, hunting agreement, current use, tax statement, tax receipt, property taxes, classify, type, scan, rescan, extract, search, retype, rename, title, review titles, replace file, versions, notes, photos, phone photo, delete, download, unfiled, manual upload, no ai, type it in, who can see, admin, document page
---
## The vault

Every file you upload, here or from a record's page (a parcel, ag field, timber stand, lease, timber sale, easement, asset, entity, tax statement, and others), lives in Documents as one list, newest first. Each card shows the document's title, its type, the properties it applies to, and the date it was added. Tap a card to open the document's page.

**Finding things.** Search at the top looks at titles, what was read out of the file, the original file name, and the names of the properties and records a document is filed to. It finds the documents that contain every word you type, in any order: "smith deed" finds "Warranty Deed - Smith to Jones (2014)". The dropdown beside it narrows to one property, one entity, or **Unfiled**. On a desktop the rail on the left lists the kinds of documents (Title & ownership, Surveys & legal, Encumbrances & debt, Government & conservation, Valuation & management, Insurance & agreements, Property taxes, Other) with counts; pick one to see its specific types. Property taxes holds every tax statement PDF you upload on the Property Taxes page (each files itself here automatically and links through to its statement), plus tax receipts. On a phone the same kinds are a row of chips you can scroll sideways. **Group by** adds section headers by type or by property when you want them; the default is a plain list.

## Titles

Every document has a title, and that is what you see everywhere (this list, the document sections on record pages, search). The original file name is kept and shown small on the document's page. Titles follow a pattern by type so a list reads the same way throughout: "Warranty Deed - Smith to Jones (2014)", "Survey Plat - River Place, 120.0 acres (2009)", "FSA-156EZ - Farm 1234 (2024)", "Title Insurance - River Place ($250,000.00, 2014)". The upload proposes one from what it reads; you can change it on the confirm screen or any time later.

**Renaming.** Tap the pencil on a card or on the document page, type, and press Enter. Escape cancels.

**Review titles.** Documents uploaded before titles existed show a "Review N titles" link beside Upload. That screen proposes a title for each from its extracted fields (or its cleaned file name), old next to new. Edit any, press Enter to save and move to the next, or apply them all at once. The link disappears when the list is empty.

## The document page

Opening a document shows the file itself (pages you can step through, or the photo) beside its details on a desktop, above them on a phone. The details:

- **Title** and **Type**. Changing the type offers to read the document again with the fields that type uses.
- **Attached to**: the record it was uploaded from, when there is one, and the properties it applies to, with the reason the reader attached each one ("parcel 12-03-07 matches River Place") when the upload did it. **Edit properties** adds or removes properties.
- **What was read**: the key fields for its type. **Scan this document** reads them the first time and **Rescan** reads them again; the result shows for review, amber where unsure, and nothing is saved until you press **Save**. **Extracted** shows the saved fields and **Edit** changes them.
- **Notes**, free text.

Buttons at the top take you on to what the document feeds: **Plot boundary** for deeds, survey plats, legal descriptions, and easement deeds; a **View FSA farm** button for a 156EZ, which opens Government Payments; **View boundary** when a plot was saved from it.

**Download** saves the file to your phone or computer under its own name. **Replace file** swaps in a new file while keeping the record, its properties, and its fields; the old file is kept and listed under Previous versions. **Delete** removes the document after you confirm and takes it off every property. Its file and its earlier versions go with it, except a file that another document still uses (one tax statement PDF often sits behind several statements); that file is kept.

The footer shows who uploaded it and when, the original file name, its size, and the dates it was read.

## Uploading: drop, confirm, save

Tap **Upload**. There is one way to add a document, and it starts with the file.

- **Drop the file**, or use **Choose files** or **Take a photo**. No type to pick, no property to pick first.
- **Confirm what was found.** The app reads the document once and shows, beside a preview of the file: the type it believes it is (with how confident it is), a proposed title, the properties it thinks the document concerns with a one-line reason for each ("parcel 12-03-07 matches River Place"), the entity when a party name matches one of yours, and the key fields for that type (grantor and grantee, recording reference, the legal description, policy amounts, FSA farms and base acres, and so on). Fields the reader was unsure about are amber. Everything is editable. A document that covers land in several properties can be attached to all of them.
- **Save document.** The file, its title, type, attachments, and the reviewed fields are stored together. Then you get the next steps that fit the type: plot a boundary from a deed or plat, or create FSA farm records from a 156EZ.

Property matches are checked against your own records before they are shown: a parcel or farm number the reader cites has to actually be on that property, and a name has to actually be on the page. A claim that does not check out is dropped rather than shown with false confidence.

**When no property is chosen.** An admin can leave the property list empty; the document is saved as **Unfiled** and can be given properties later from its page. A member who is not an admin must choose a property (or a specific record) first, and the screen says so.

**Phone photos.** A photo larger than about 3.5 MB is read from a smaller copy made on your device. The original photo is the one that is saved.

**Uploading from a page.** Record pages (parcels, ag fields, timber stands, leases, timber sales, easements, assets, entities, and others) have an **Add document** button that attaches the document to that record by default. The reader still runs, and if its evidence points to a different property you get a note ("This warranty deed appears to describe River Place") with one tap to switch or to attach to both. When it agrees or finds nothing, the page wins quietly.

**Leases, timber contracts and settlements, tax statements, and rent payments** have their own upload that reads the terms and files them in the right place. If you drop one of those here, the confirm screen offers to open it there in one tap, or to **Keep it here as a document**.

**Typing it in yourself.** **Manual upload (no AI)** under the drop box takes a file and opens a plain form (type, an optional title, properties, an optional specific record, and the type's key fields) without reading it. While a file is being read, **Skip the AI: manual upload** does the same. On the confirm screen, **Switch to manual upload** asks whether to keep what was read as starting values. If a file cannot be read at all, you land on that form with a short message and the file attached; there is no dead end.

Older files uploaded before types existed sit under Other; the "Type N untyped" link beside Upload opens a screen that suggests a type for each (**Classify all**) and applies your choices in bulk (**Apply**).

## Many documents at once

Drop several files, or a whole folder, on the same upload box (or use **Choose files** or **Choose a folder**). One file opens the full review above; several open a review table instead.

- **Each file is read in the background**, three at a time, with a progress bar. You can review and save rows while the rest are still being read.
- **Every row shows** the file, its proposed type, title, and properties, and a status: **Ready** (checked for you), **Needs a look** (with the reason: no property found, the parcel numbers and the description disagree, the type is uncertain, or the file could not be read), **Already in Turnrow**, or **Different upload** (a lease, tax bill, timber contract or settlement, or rent payment, which have their own upload).
- **Folder names count.** A file inside a folder named after one of your properties (or a name it is also called) is attached to that property when the reader finds nothing better. When the folder and the document disagree, both are proposed and the row asks for a look.
- **Nothing is saved twice.** A file with the same size and name as one already in Turnrow (even renamed with a prefix) is marked Already in Turnrow, unchecked, with a link to the copy.
- **Fix in place.** Change a row's type, title, or properties right in the table, or check several rows and use **For checked rows** to add a property or set a type for all of them at once.
- **Saving.** The save button under the table (it reads **Save 5 checked** when five rows are checked) stores each checked file with its type, title, and properties. A row with no property saves as Unfiled for an admin; for anyone else it is not saved until a property is chosen. The reader's field details (owners, dates, acres) are not saved from the table, because those are only saved after a field-by-field review: open a document and use **Scan this document** to pull and review them.
- Closing the box with read but unsaved rows asks first; files you leave are discarded. The box cannot be closed while a save is running.

Word files upload too; the reader does not open them, so pick the type yourself.

## Scanning again

**Rescan** on a document's page re-reads the key fields for its type and shows them for review, amber where unsure, before saving. Saved fields show on the document's page and are searchable. After you save a reviewed 156EZ, the app asks before it creates or updates the FSA farms and base acres used by Government Payments.

## Plot boundary

Deeds, survey plats, legal descriptions, and easement deeds offer **Plot boundary**: the app reads the legal description and turns it into a boundary on the map. See "Plotting a boundary from a deed".

## Common questions

- **Photos of a well or barn?** Asset pages and pollinator habitat pages have an **Add photos** button for gallery photos; those are stored as-is without reading.
- **How do I open the file itself?** Tap the card to open the document's page. The file shows there, and **Download** saves a copy.
- **Who can see my documents?** Admins see every document. Other members see the documents filed to the properties and records of the entities ticked for them. Unfiled documents and documents attached to a tenant are for admins only. See "Members, roles, and who sees what".

## A plotted boundary landed in the wrong place

See "Why did my plot land in the wrong place?" under Plotting a boundary from a deed. In short: the survey (principal meridian) comes from the county the deed states and is never left open, and the resolved section is checked against that county before you can go on to save, with one-tap retries for a flipped direction letter or another survey.

## How the description match works

When a deed or plat carries a section, township, and range, the upload reads those references (up to six tracts), both from what the reader returned and straight from the description text. It takes the principal meridian from the county the deed names, finds each section on the public survey grid, and checks that it sits in that county. The described tracts are laid over your boundaries and the confirm screen shows **Evidence from the description**: which properties and parcels they overlap and by how much.

**When the description is a portion of a section** ("south and west of Sandy Branch", "the part lying north of the road") rather than quarters, the whole section is used as a search window. If the deed states an acreage ("containing 120 acres") and one parcel inside that section is within 15 percent of it, that parcel is named as the tract itself and offered as the specific record. Otherwise the description alone pre-checks a property only when it covers at least half of the section, and the other properties in the section are listed without a check mark.

**When nothing computed**, the screen says why (no section, township, and range were read; the section lookup did not finish; the section landed in a different county than the deed says). When a lookup did not finish it offers **Retry**, which runs the check again without reading the document again. The same evidence is saved with the document and shown on its page, where **Check the description again** re-runs it any time.

**Your land index.** When you open an upload after a boundary has changed, the app quietly records which survey sections each of your properties and parcels touches, so descriptions of land you already own are matched from sections kept on file.

**Names your family uses.** Deeds call tracts by old names ("View Celeste", "the Martin homeplace") that your property records do not. After a save, **Remember these names** offers to remember such a name for the property you attached; from then on the reader is told the name and matches on it. The names are listed on the property page beside **Also called**, where you can add or remove them.

Two things to know:

- If the county check fails (the section resolved somewhere else), the description is not used for matching and the screen says so. Open Plot boundary to correct the township or range direction.
- If a parcel or farm number points to one property and the description overlaps another, both are listed with their evidence and nothing is pre-checked. You pick.
