# Turnrow Landowner capabilities digest

Generated 2026-11-14, version 0.1.0, build 7ea8b2e. Compiled from docs/help; regenerate with npm run help:build.

# What Turnrow Landowner does NOT do

Turnrow Landowner keeps a landowner's records: property and parcel boundaries on a satellite map, timber stands, roads, easements and assets, leases and tenant payments, timber sales, property taxes, documents, government program base acres, and the farm activity a tenant chooses to share. It deliberately does not do the following. If someone asks, say so plainly and do not improvise a workaround:

- **No accounting or tax preparation.** Income views show projected and received rent, timber money, and property taxes for planning. They are not a ledger, a P&L, or anything for a tax return.
- **No legal advice.** Boundaries plotted from deeds are estimates that follow the quality of the description. A licensed survey is the only thing that settles a line.
- **No payment processing.** Rent and timber checks are recorded by you; nothing moves money.
- **No farming operations.** No crop planting, spraying, or equipment records. Farm activity comes only from a tenant's farm software when the tenant shares it. (Work on timber stands, such as planting, spraying, and burning, is recorded under Timber.)
- **No weather or market advice.** Price benchmarks feed lease projections; nothing recommends when to sell.
- **No automatic county data.** Nothing syncs from the county in the background. County parcel records and public USDA data are looked up while you are doing something that needs them (an import, a tax statement, the Neighbors layer, a refresh you press), and nothing is added to your map or matched to a parcel until you confirm it.
- **No app-store app.** The app runs in the browser and can be added to a phone home screen from the browser's share or menu button.
- **No self-serve signup.** New organizations and users join by invitation.
- **US land, US dollars, US programs only.** County parcel lookups cover the counties in the registry (north Alabama first).

# Ask about your land  (page: /ask)

## What Ask does

Ask answers questions about **your own records**: "How many acres do I own in each county?", "Which parcels have unpaid taxes from last year?", "What did timber sales bring in last year?", "What easements cross my land?" It reads the same figures the pages show and says in plain language what it looked at. Under each answer, a line reads "From your Turnrow records" with the time and links to the pages where you can check the numbers.

It can answer from income records too, such as what the cell tower or a solar lease paid in a past year.

You can also start a question from the **Ask about your land** box on Home.

## Your conversation

The conversation stays when you leave the page and come back in the same visit, so follow-up questions keep their thread. **Start a new conversation** at the top clears it. Nothing is kept once you close the browser tab.

## What it does not do

It does not change anything. It sees only what you can see: nothing from other organizations and, if you are not an admin, only the entities shared with you. It does not know how to use the app; for that, open the ? button, whose how-to chat knows the app and not your data. Keep the two straight: Ask knows your land, Help knows the app.

## Tips

- Name the year when it matters ("2025 taxes").
- If it says it could not find something, check that the records exist (a lease with no land linked has no acres to count).
- A very long answer can be cut short. Ask about one property or one year at a time.
- Each person can ask 30 questions an hour.

# Assets list  (page: /assets)

## What this page is for

Every well, pivot, bin, building, pond, fence, and pipe you have recorded, organized by type automatically: Irrigation first, then Storage, Buildings, and Other. Each section shows its count and subtotals (estimated value, and total bushels for storage). Filter by property or type; filtering to one type shows a plain list. Tap an asset's name to open its page, or **Map** to zoom to it (shown once the asset has a place on the map). Deactivated assets are hidden until you tick **Show inactive**.

## Grain bins and bin sites

A **grain bin site** groups the bins standing on it: the site row shows total capacity and its bins nest beneath it. Each bin's own row and page lead with its capacity in bushels. Add bins to a site from the site's map panel (**+ Add bin to this site**, which places the bin with the crosshair) or from the site's page (**+ Add a bin to this site**, which asks for a name and saves the bin without a location).

## The asset page

Shared fields (name, type, property, year installed, condition, estimated value, notes) plus a form specific to the type: well depth and pump details, pivot make and wetted length, bin capacity, building construction and utilities, and so on. Pivots, risers, and pipes link to their supply well; bins link to their bin site. **Save changes** stores the form. Photos and documents attach below with **Add photos** and **Add document**.

Changing the **Type** keeps only the details the new type has a place for. Before saving, the page lists the saved details that would be removed and asks whether to save anyway.

**Deactivate (removed / demolished)** keeps the history and takes the asset off the map; **Reactivate** brings it back. **Delete permanently** removes the asset and its saved details and cannot be undone. Photos and documents attached to it are not deleted: they stay in Documents.

## Common questions

- **Where did the bin diameter field go?** Retired. Capacity in bushels is the number that matters for a bin; bins place as a pin (or a drawn outline), not a circle.
- **Where do I place it?** Assets are placed from the Map. A bin added from its site's page says "No location yet" with a **Place on map** link. The link opens the Map with the bin's panel up; press **Move pin**, line up the crosshair, and press **Place here**. You can also get there from the Map: tap the bin site, then the new bin in the site's list. A deactivated asset has to be reactivated first, because the map leaves inactive assets out.

# Cemetery pages  (page: /cemeteries)

## What a cemetery page shows

A cemetery on your land is kept as its own record, either a traced plot or a single pin, so everyone can see where it is. Open one from the Cemeteries list on its property's page, or tap it on the map and choose **View full page**.

- **Acres** for a traced plot. A cemetery marked with a pin shows **Marked by a pin** and has no acres.
- **Notes**, if any were entered. They are a good place for who is buried there, who looks after it, and how to reach it.
- **Edit** opens the name and notes so you can change them; **Save** keeps the change.
- **View on map** opens the map on this cemetery.
- **Documents and photos**: **Add document** files a paper or photo on this cemetery.

## Common questions

- **How do I add a cemetery?** On the Map, tap **+ Add**, then **Cemetery**, and choose **Draw the plot** or **Drop a pin**.
- **How do I change where it is?** Tap **View on map**. In the cemetery's panel, **Edit boundary** reshapes a traced plot and **Move pin** moves a pin.
- **How do I move it to another property?** On the property page, under Cemeteries, use the Move link.
- **How do I delete it?** From its panel on the map.
- **Where do I record a family's right to visit?** As an easement of the cemetery access type. See the Easements topic.

# Getting started  (page: /dashboard)

## What this app is for

Turnrow Landowner keeps the records of land you own and lease out: where the boundaries are, what is on the ground (timber, roads, wells, bins, easements), who leases it and what they owe, what the county charges in property taxes, the papers that prove it all, and the government program base acres tied to it. Everything you enter is private to your organization, and inside it each member sees only the entities an admin has shared with them.

## Where to begin

These steps are for the admin who sets the account up.

- **Get your land on the map.** The fastest start is Import, then **Import from county records**: search by owner name, pick the parcels, and the boundaries arrive already drawn. If the county is not in the registry yet, upload a zipped shapefile, KML, KMZ, or GeoJSON, or draw boundaries by hand on the Map.
- **Group properties under the right owner.** If family land sits in an LLC, a trust, and your own name, create an entity for each under Properties then **Entities**, and set **Held by** on each property's page. Home, Income, and Government Payments can be filtered by entity, and other family members see land only through the entities shared with them.
- **Add what is on the ground.** Timber stands, roads, wells, pivots, bins, and easements are drawn or pinned from the Map's **+ Add** button.
- **Bring in the paperwork.** Leases, tax statements, deeds, surveys, and FSA-156EZ forms can be uploaded and read for you; you review what was read before it saves.

## Finding your way around

The menu has six stops. **Map** and **Home** stand alone. **Land** holds Properties, Timber, Assets, and Maintenance. **Financial** holds Leases, Income, Property Taxes, and Government Payments. **Records** holds Documents, Farm Data, and Import. **Ask** answers questions from your records. Tap a group to see its pages with a one-line description of each; the group's pill names the page you are on. The **?** button opens Help and the gear opens Settings.

On a phone, the bottom bar has Map, Home, Properties, Leases, and **More**, which opens every other section and Settings.

## Home

Home opens with **Needs your attention**. It lists:

- Leases that end within 90 days, or that have ended but are still marked active. Leases set to renew automatically are left out.
- Tenant insurance on active leases: a certificate that has expired or expires within 60 days, or a hunting lease that requires insurance with no certificate on file.
- Open maintenance issues.
- Property taxes from any year that are unpaid and within 60 days of, or past, the delinquent date. The line gives the last day to pay, or the date the bill went delinquent.
- Payments that are past due, partly paid, or due within 60 days. The first 8 show, with a link to the rest on Income.

Each line links to the page that fixes it. When nothing is pending, the card says so.

Below that:

- **Harvest progress**, when a tenant shares field data and harvest has started. The title names the crop year it covers.
- **Property taxes** for the latest tax year on file: parcels covered, what is unpaid, and **Pay by** with the last day to pay (the day before the delinquent date) or **Delinquent since**.
- Tiles for total acres, properties, ag field acres, timber acres, wells, pivots, grain bins, and buildings, plus irrigated, pasture/grassland, pollinator habitat, and wetland acres when you have them. When land sits in more than one entity, chips above the tiles limit the tiles to the entities you tap.
- A satellite picture that opens the map, and an **Ask about your land** box.

An admin with no land on the account yet also sees **Set up your land in four steps**. A member with no land shared yet sees a note saying who to ask for access. If some records could not be loaded, Home says so and asks you to reload; it does not show the all-clear.

## Getting help

- **The ? button** in the top bar opens Help on every page: a guide to the page you are on, a search across all topics, a how-to chat that knows the app, and Contact support, which reaches a person.
- **Ask** (in the menu) is different: it answers questions about your own land and numbers from your records, such as "how many acres do I own in each county".

## Common questions

- **Can I use this on my phone?** Yes. Add it to your home screen from the browser's share or menu button and it opens like an app.
- **Can someone else in the family log in?** Yes. An admin adds their email under Settings then Members, chooses what they can see, and sends them the sign-up link shown there. See "Members, roles, and who sees what".
- **I was invited. Where do I start?** Create your account with the email address you were invited with (see "Signing in, your password, and getting connected"). You will see the land that was shared with you; the setup steps above are for the admin who runs the account.
- **Is my data shared with my tenant?** No. The only connection runs the other way: a tenant can choose to share their field data with you.

# Documents  (page: /documents)

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

# Plotting a boundary from a deed  (page: /documents)

## Two kinds of descriptions

- **Aliquot parts**: "the NW quarter of the SE quarter of Section 12, Township 4 South, Range 8 West." The app finds that section on the public survey grid, cuts it by quarters and halves, joins the parts, and cuts out any "less and except" parts that are themselves plain quarters and halves.
- **Metes and bounds**: a starting point and a chain of calls, "thence N 45 degrees 30 minutes E 660 feet." The app reads the calls into a table you can correct, plots the shape, and you place it on the map.

## The three steps

Open a deed, survey plat, legal description, or easement deed in Documents and tap **Plot boundary**. Nothing changes on your map until the last step.

### 1. Review the description

Tap **Read the document**. The description is read and shown for review, amber where the reader was unsure. Check the **Description type** it chose: PLSS aliquot, Metes and bounds, or Mixed (which is plotted from its aliquot parts).

- For aliquot parts you see the reference as fields, not prose: the state, the county the deed states (it decides the principal meridian), and for each tract its parts as ordered chips (largest division first, each next chip a part of the one before), the section, township and N or S, range and E or W, and the meridian. Fix a misread letter or digit here. Nothing is looked up until the next step.
- For metes and bounds you see the point of beginning as described, the basis of bearing, and the calls: a bearing, distance, and unit for each, with a **Curve** box for curves. A bearing that cannot be read is marked red.

### 2. Resolve sections, or Traverse and place

For aliquot parts the step is **Resolve sections**. Tap **Resolve** on each tract. Two checks run: the section must sit in the deed's county (when it does not, a red box offers one-tap retries, and you cannot continue until it passes), and a section more than 25 miles from all your boundaries gets a warning. Words beyond plain quarters and halves ("the north 10 acres of", "that part lying north of the road") are not plotted, and an exception that is more than plain quarters is not cut out. A note under the tract says so each time.

For metes and bounds the step is **Traverse and place**. The **error of closure** shows first: the gap between where the last call ends and the starting point, in feet and as a ratio. Green is 1:5,000 or better, amber down to 1:1,000, red worse. **Force close (compass rule)** spreads the gap across the courses and is labeled as an adjustment. A call that cannot be plotted is left out and named by its number. Then set the point of beginning: tap the map or drag the marker, or use one of the corner buttons for the reference boundary. **Rotation** turns the figure up to 15 degrees either way when the deed's basis of bearing differs from true north. The shape follows live. When a reference boundary is chosen, the marker starts in its middle only as a starting spot. You cannot continue until you place the marker yourself, or tap **The marker is already on the point of beginning**.

### 3. Preview and save

The plotted boundary is drawn over the current one with acres side by side (**Plotted**, **Current**, **Deeded**). Under **Save as**, choose **New property**, **New parcel**, **Replace property boundary**, or **Replace parcel boundary**. **New property** is offered to admins only; other members save onto a property that already exists.

Every warning from the earlier steps is listed again above the button, along with a note when the plotted acres are more than 5 percent off the acres the description states, or when the plot sits 2 miles or more from the boundary you picked. Two cases ask for a typed word before the button works:

- Replacing a boundary that already exists: type **REPLACE**. The old boundary is not kept.
- Saving a plot that has warnings: type **SAVE**.

After the save, the document's page shows **View boundary**.

## Honest limitations

Plot quality follows description quality. Old deeds omit curves, mix units, or reference monuments that no longer exist. Aliquot math assumes regular sections; government lots along rivers and township lines are approximations. Closure is shown, never hidden. When the county's parcel map agrees with your records, Import from county records is faster and usually better. Nothing here replaces a licensed survey.

## Common questions

- **The shape is mirrored or spun.** Check bearing quadrants (N 45 E vs N 45 W) in the calls, then use **Rotation** for small differences.
- **Units?** Feet, chains (66 ft), poles or rods (16.5 ft), links, yards, and meters are understood; pick the unit per call when the deed mixes them. Varas are not converted (the vara differs by state and era); convert those calls to feet first.
- **The description is only part of a section along a creek or road.** The plotter can only show the whole section for that. Draw the tract by hand on the Map, or import the parcel from county records.

## Why did my plot land in the wrong place?

Almost always one of two things, and the app guards against both.

- **The wrong survey (meridian).** Township and range numbers repeat across a state. Alabama has three main surveys: Huntsville for the Tennessee Valley and north Alabama, St. Stephens for the middle and south, Tallahassee for the southeast corner. "T4S R7W" exists under more than one of them, so the lookup must name the survey. The app takes it from the county the deed states; you can override it per tract. A lookup without a meridian is never made.
- **A flipped direction letter.** If the reader turns R7W into R7E (or T4S into T4N), a real section comes back hundreds of miles away. The county check catches this: the resolved section has to sit in the county the deed names. When it does not, you see "County check failed" with both county names and one-tap retries for the likely fixes (flip the township letter, flip the range letter, try another survey).

Two more aids: each resolved tract prints a line saying how it was resolved ("Resolved: Huntsville PM (from Lawrence County), T4S R7W, Sec 31, BLM CadNSDI section layer, county check passed (Lawrence), 2.1 mi from River Place"), shown again on the save step. For metes and bounds, the county the marker sits in is shown beside the county the description names, with a red warning when they differ.

# Easements  (page: /easements)

## What counts as an easement

A recorded right someone else holds over your land, or one you hold over a neighbor's. Types are grouped into families: utility (powerline, pipeline, waterline or sewer, telecom or fiber), access and transport (access for ingress and egress, public road right of way, railroad), water (drainage, flowage for a reservoir), conservation, and other (cemetery access, temporary construction, solar or wind, other). Severed mineral rights are not an easement and are not recorded here.

## Recording one

Draw it from the Map: **+ Add**, Easement, then **Line** or **Area**. The save form asks a name, the type, whether it burdens your land (**Burdens my land**, the default) or benefits it (**Benefits my land**: an access lane you hold across a neighbor, drawn outside your boundary on purpose), the holder, the recorded reference (book and page), an expiration date (blank means permanent), an **emergency contact number**, notes, and depending on type: width for a line (informational only; draw an area if you want the strip), the flowage elevation, and the conservation program and its restrictions.

To change the details later, tap the easement on the map and use **Edit details**, or open its page and use **Edit**. **Delete** is on the map panel.

## The emergency number

Pipeline and powerline markers print the operator's emergency or one-call number; record it on the easement and it shows prominently in red, tap-to-call, on the map panel and the easement page (other types show it tap-to-call without the red). When you scan a deed attached to an easement and it prints the number, the review shows it and then asks whether to save it to that easement.

## On the map and in print

Families share a look: utility reds and oranges, access browns with a tie pattern for railroads, water blues with a stronger fill for flowage, a violet hatch for conservation, grays for the rest. The legend lists only the families you have recorded. Tapping an easement shows its exact type and every field; its page holds the recorded deed.

## Common questions

- **The easement crosses two properties.** An admin may leave Property blank or pick the main one. Other members must pick a property. An easement with no property is visible to admins only.
- **Our own buried irrigation pipe?** That is an asset (Underground pipe), not an easement.
- **Where does the easement deed go?** Upload it on the easement's page, or in Documents with type Easement deed.

# Entities  (page: /entities)

## What an entity is

An entity is the legal owner of record: your own name, a family LLC, a trust, a corporation, a partnership, or an estate. Each property is held by one entity, so acres, income, and government payments can be viewed per owner.

Entities also decide who sees what. A member who is not an admin sees only the land of the entities an admin has ticked for them under Settings, and a property with no entity is visible to admins only.

## Where entities come from

- Admins create one on the Entities page with **+ New entity**: a name and a type (Individual, LLC, Corporation, Partnership, Trust, Estate, or Other).
- Admins can also create one from a property page: the **Held by** list ends with **+ New entity...**, which creates the entity and assigns the property to it.
- In Import from county records, **Held by entity** lets you pick an entity for the imported land or choose **Create new entity...**. When you import from an **All parcels for an owner** search with an entity chosen, the way the county spelled the owner's name is saved to that entity, and later searches of that kind mark matching names with a **Known entity** badge.

## The entity page

Shows the properties it holds and their acres, a base acres and government payments card once FSA farms are linked to its properties, the county spellings saved for it (**Known county-record spellings**), and its documents, such as operating agreements and formation papers. **Edit** changes the name, type, and notes. Income and property taxes are not shown here; filter Income by entity to see them.

## Merging and deleting

Both are for admins and are at the bottom of the entity page. Each spells out what will happen before anything changes, and neither can be undone.

- **Merge into another entity** moves everything to the entity you pick: properties, saved county spellings, documents, tax statements, registered tax accounts, timber basis accounts, cost-share awards, and income records. Members who could see the old entity can see the one it was merged into. The old entity is then removed.
- **Delete entity** keeps the properties, which then show no entity and are visible to admins only. Documents attached to the entity are deleted with their files, saved county spellings and registered tax accounts are removed, and members lose the access given through it. Tax statements, timber basis accounts, cost-share awards, and income records are kept but no longer tied to an entity.

## Common questions

- **Two entities are really the same owner.** Open one and use **Merge into another entity**. Merging keeps everything together; deleting does not.
- **Does deleting an entity delete my land?** No. Its properties stay and show no entity. Documents attached to the entity itself are deleted.
- **Can one property belong to two entities?** No. Split it into two properties if ownership is split.

# Farm activity  (page: /farm-activity)

## What this page shows

Everything connected tenants have shared, one crop year at a time. Pick the year, an entity, a tenant, or a property at the top and tap **Apply**. A strip under the filters shows each connection with the date it last synced and a **Manage connections** link.

**The summary cards** roll the year up two ways: **By entity** (how your land is held; a **No entity** card covers land not assigned to one) and **By tenant** (each farming entity your tenants' software names). Each card shows acres in crops, the crop mix with a colored bar, and acres harvested of acres planted. When the farmer shares them, it also shows a yield per crop marked actual or projected, and crop prices marked projected or final. An account with one entity and one tenant sees a single card.

**Tap a card** to drill in. The page narrows to that entity or tenant and lists its properties with the same numbers. Tap a property to see its fields. The links at the top step back up, and clearing a filter returns to the summary.

**The field tables** list each planting by property: field, crop and varieties, acres, planting date, status (Growing, Harvesting, or Harvested), and yield. Card totals are sums of these rows.

## Actual vs projected during harvest

A yield reads as actual only once the field's harvest is complete. A field still being cut shows Harvesting and the tenant's projected yield, marked projected, because dividing a partial harvest over the whole field would read too low. On a summary card, a crop's actual yield averages only the finished fields, with "X of Y ac complete" beside it while others are still going.

The Map's Crops layer colors ag fields by the same data for the current year.

## Which years are kept current

Every sync refreshes the current crop year and the one before it, because harvest and final prices often arrive after December 31. Older years stay as they were last synced. The page opens on the latest year with data.

## Your tenant's farming entities

A farm often runs as several entities (a family corporation for one set of fields, an LLC for another). When your tenant's software shares which entity operates each field, each farming entity gets its own tenant card with its own acres, crop mix, harvest, and prices. The field tables gain an **Entity** column, and the map's field panel says who operates the field.

## Ignored and unmatched fields

- Fields set to **Ignore this field** on Field mapping are left out of every total and list here. A line under the totals says how many plantings were left out.
- Plantings on fields you have not matched yet are listed under "Not mapped to your land yet". They count on the tenant's card, which notes the acres, but not toward any entity or property.

## Common questions

- **Yield or prices read "not shared".** The farmer did not turn that on; ask them or leave it. Acres and harvest progress always show, because plantings are always shared.
- **A field is missing.** Check its match under Farm Data, then **Manage connections**, then **Field mapping**, and make sure it is not set to Ignore this field.
- **A tenant farms for two of my entities.** The tenant card rolls up across both; each entity card shows only its own land.
- **The numbers look old.** Open **Manage connections** and press **Refresh now**. The card there says when the connection last synced and whether anything went wrong.

# Farm connections  (page: /farms)

## What a connection is

If your tenant uses Turnrow's farm software, they can share part of their records with you: which of their fields are on your land, what they planted, and, if they choose, yields and prices. The farmer generates a one-time share code (it looks like TRW-XXXX-XXXX-XXXX) and an admin on your account enters it. Nothing flows the other way.

Reach this page from Farm Data with **Manage connections**. Until a farm is connected, Farm Data opens this page directly.

## Connecting

Only an admin can connect a farm. Under **Connect a Farm**, enter the code and tap **Connect**. The first sync runs right away, and you land on **Field mapping** for the new connection.

## What the farmer controls

The farmer decides what to share and can end the share at any time. Plantings always come with a share. Yields, projected prices, and projected yields are each optional: the chips on a connection's card (**Yields**, **Projected prices**, **Projected yields**) are green when shared and gray when not, with the time they were last checked.

Sharing is checked again on every sync, so something the farmer turns on or off later takes effect on the next sync with nothing to set up on your side. Turning something off stops new numbers; numbers already synced stay. If a chip looks wrong, press **Refresh now**.

When the farmer ends the share, the card reads **Ended by farmer**, syncing stops, and what was already synced stays on your side.

## Mapping fields

**Field mapping** lists each of the farmer's fields with a list beside it: your ag fields, **Whole property** (for when you have not drawn the field), **Not mapped**, and **Ignore this field**.

- A match is suggested only when the names have something in common: the same name, one name inside the other, or a shared word together with acres within 15 percent. A shared number alone ("North 40" and "South 40") does not count. Tap **Confirm match** to accept a suggestion. The app never confirms one for you.
- Size alone never suggests a match. When one of your fields is about the same size (within 5 percent) but the names differ, it is mentioned as a hint under the row. Pick it from the list only if it is the same field.
- Picking a field or a property from the list confirms that match right away.
- **Ignore this field** leaves that field's plantings out of Farm Data, the Home harvest card, and Ask.

Only confirmed matches tie farm data to your land: the map's Crops layer, the property rows on Farm Data, ag field pages, and the Tenant data panel on leases.

## Refreshing

Each connection syncs on its own every 6 hours, and whenever someone presses **Refresh now** (or **Check for new shared fields** on the mapping page, which runs the same sync). Every sync refreshes the current crop year and the one before it, because harvest and final prices often arrive after December 31. Every page that shows farm data reads the same synced copy.

When the farm software cannot be reached, the last synced data still shows and the card says what went wrong. A problem with one part (harvest data, prices, or yields) appears as an amber line on the card.

## Disconnecting

**Disconnect** is for admins, and the app asks first. It permanently removes everything synced from that farm: every year of plantings, harvest, and yields, the tenant's projected prices and yields, and the field matches you confirmed. Your tenants and leases are kept. To see the data again you would need a new share code from the farmer and would match the fields again. If the farmer has already ended the share, the history cannot be pulled again.

## Tenants come from the farm data

Your tenants are the farming entities behind the share. Each entity the farmer's software names becomes a tenant in Turnrow when the connection syncs (a share with no entities becomes one tenant for the whole operation). An existing tenant with the same name is linked instead of duplicated, and you can rename a tenant freely. For a tenant that did not come from the farm data, the tenant's page has a **Farming entity** section to link one by hand; a suggestion appears there when every mapped field on that tenant's leased land belongs to one entity.

## Common questions

- **The code was not accepted.** A code works once. Ask the farmer for a new one.
- **Can I see their whole operation?** No. Only the fields they shared with you, and only what they chose to share about them.
- **I am not an admin. What can I do here?** You can see the connections and press Refresh now. Connecting and disconnecting are for admins, and Field mapping shows you only the fields already matched to land you can see.

# Ag Fields  (page: /fields)

## What an ag field page shows

An ag field is a piece of cropland drawn inside a property. Open one from the Ag fields list on its property's page, or tap it on the map and choose **View full page**.

- **Acres**, worked out from the drawn boundary. When a pivot's coverage circle crosses the field, the page splits the acres into irrigated and dryland.
- **Edit** changes the name and notes. **View on map** opens the map on this ag field.
- **Leases covering this land**: every lease that lists this ag field, or the whole property it sits on, with its status and this year's projected rent for the whole lease.
- **Farm activity**: when a connected tenant's field is matched to this ag field, the crop, acres, status (Growing, Harvesting, or Harvested), and yield by year, from the tenant's farm software. A yield marked projected is the tenant's estimate; an actual yield shows only once harvest is complete.
- **Documents and photos**: **Add document** files a paper or photo on this ag field.

## Tenant planted acres

When the tenant shares plantings, the details also show how many acres they planted irrigated and dryland this year. These come from the tenant's records and can differ from the irrigated acres the map works out from pivot coverage.

## Common questions

- **How do I add an ag field?** On the Map, tap **+ Add**, then **Ag field**, and draw it. Or bring it in with Import.
- **How do I move it to another property?** On the property page, under Ag fields, use **Move ag fields to another property**.
- **No farm activity shows.** The tenant's field has to be matched to this ag field. See the Farm connections topic.
- **How do I delete an ag field?** From its panel on the map. Its lease links are deleted with it (the leases are kept), and any farm software field matched to it becomes unmatched.

# Government payments  (page: /gov-payments)

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

# Help and support  (page: /help)

## The ? button

Once you are signed in, the ? button at the top of every page opens Help with four tabs:

- **This page**: the guide for where you are. Other guides for the same page are listed under **Also on this page**.
- **All topics**: search every guide.
- **How-to chat**: an assistant that knows the app from these guides and nothing about your data.
- **Contact support**: a message to a person, with your email, organization, and page attached automatically, plus an optional screenshot (an image up to 2 MB). Support replies to your email.

A message you have typed but not sent is kept while the tab stays open, so closing Help does not lose it.

## The Help Center

**Help Center** at the top of the Help panel opens a page that lists every topic by section, with search across titles, keywords, and content.

## Ask vs Help

**Ask** (in the menu) answers from your records. **Help** answers about the app. If the how-to chat cannot answer, it says so and points you to Contact support. The link under the chat that begins "Did not get what you needed?" sends the conversation to support along with your message.

# Import files  (page: /import)

## What it does

Upload boundary files you already have: a zipped shapefile from a surveyor, a KML or KMZ from Google Earth, or GeoJSON. Each shape in the file is previewed, you say what it is, and it saves. Nothing is stored until you save.

## From the map

You do not have to leave the Map. Tap **+ Add** and pick **Import a file** at the bottom of the picker, or drag the file from your computer and drop it anywhere on the map. The shapes appear on the satellite view in the color of what they will become (dashed, so they read as not yet saved), the map zooms to them, and a review panel (on the right on a computer, a sheet at the bottom on a phone) sets each one's type, name, and property, the same choices as this page. Uncheck a shape to leave it out; it fades on the map. The save button (it reads **Save 3 features** when three shapes are checked) writes them and they join the map right where they were previewed. **+ Add another file** adds more shapes to the same review. **Cancel** clears the preview.

## On the Import page

- Tap **Tap to choose files** and pick one or more files, or on a computer drag the files onto that box and drop them.
- Say what each shape is. An area can become a Property, Parcel, Ag field, Pasture/Grassland, Wetland (open), Pollinator habitat, Timber stand, or Cemetery. A line can become a Road, Underground pipe, or Fence. A point becomes an asset of the type you pick. Only admins are offered Property.
- Give each one a name. For a parcel the name is its parcel number.
- Each row suggests the property that contains it (a **Suggested from location** chip). Confirm or change it. Everything except a new property and an asset must be assigned to a property. Properties in the same batch save first so other rows can attach to them.
- Uncheck a row to leave it out, then tap the save button. Rows that fail are listed with the reason and stay on the page so you can fix and retry them. Rows that saved are not saved twice.

## Common questions

- **It says the file is not in latitude and longitude.** The app only takes coordinates in latitude and longitude. Export the file again as WGS 84 (EPSG:4326) and try again. A zipped shapefile that includes its .prj file is converted for you. When only some shapes in a file are off, the good ones still come in and a note says how many were skipped.
- **Can I import an easement?** Not from a file. Draw it on the Map with **+ Add**, then Easement.
- **Can I import a spreadsheet of acres?** Not here; this page needs shapes. Leases and taxes accept their own documents.

# Import from county records  (page: /import/county)

## What it does

Search a county's public parcel map by owner name or parcel number, preview the parcels on satellite, pick the ones that are yours, and import them with their boundaries, parcel numbers, and deeded acres already filled in. It is the fastest way to get land on the map.

## How to use it

- Pick the county. Only counties in the registry appear; the registry grows as counties are verified.
- Choose how to search. **All parcels for an owner** finds every way the county wrote a name and groups the parcels by owner. **Owner name** is a plain search (try the name as the county prints it, last name first). **Parcel number** takes the number in any format; separators like dots and dashes do not matter.
- In **All parcels for an owner**, results are ranked: groups matching your known entities pin to the top with the **Known entity** badge, then the closest matches to the name you typed. With a common surname, the distant matches fold behind one "Show N more distant matches" line (with their parcel and acre counts), so nothing is hidden, just deferred. A sort toggle (**Best match** or **Most acres**) and a **Hide 1-parcel owners** filter tidy the list further. Each group shows its name variants. **Not this owner** splits a variant out; tap **Merge** on two groups that are the same owner to join them.
- A very common name shows what was found with a note that more names matched than could be listed; add another word (a first name, or the company's second word) for the full picture. The other two searches show at most 200 parcels and say so.
- Tick **Include in import** on a group, or check single parcels in the list or tap them on the map.
- In the panel that appears, choose **Existing property** or **New property**, and pick the entity beside **Held by entity**. **New property** and **Create new entity...** are offered to admins only. Other members add parcels to a property that already exists; with no property yet, the panel says an admin has to create one first.
- **Set property boundary to merged outline** makes the property's boundary the outline of all its parcels. It is applied only when the import adds a parcel to that property or updates one of that property's own parcels. The box starts ticked for a new property or one with no boundary yet. It starts unticked when the property already has a boundary, because the merged outline would replace it; tick it and a notice says so before you import.
- Tap **Confirm and import**. Parcels arrive with boundaries and deeded acres, and the page stays where it is so you can import the next batch. **Done, view on map** opens the map when you are finished.

## Parcels you already have

A selected parcel whose number is already in your records for that county is listed before you import, with two choices: **Skip** (the default) leaves your parcel alone, and **Update geometry** replaces your parcel's boundary and deeded acres with the county's. It is never added a second time. If two selected rows carry the same parcel number, one is imported and a note says how many were left out.

## Common questions

- **My county is not listed.** Upload a file instead (see Import files), draw by hand, or plot from a deed in Documents. Ask support to add the county; each one is verified live before it appears.
- **Acres say "est."** The county published no deeded acres for that parcel, so the figure is worked out from its boundary. A row that says "no boundary returned" cannot be imported.
- **The property's boundary did not change.** The merged outline is only set when its box is ticked during an import into that property. An import that only updates a parcel on a different property leaves the chosen property's boundary alone. Otherwise draw or edit the boundary on the Map.

# Income views  (page: /income)

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

Between the by-type and by-property tables sits **by lease**: every lease with rent expected or received in the year, with a Basis chip (Projection, Schedule, or Incomplete; "Received only" when money came in with nothing expected) and expected, received, and outstanding. A lease still in Draft counts the same as an Active one, and its row is marked "Draft lease, counted as expected".

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

# Leases  (page: /leases)

## Tenants and leases

A **tenant** is the person or operation that rents from you, with contact details and insurance on file (see the Tenants topic). When a farm connection is in place, tenants come from the farm data: each farming entity the farmer shares is a tenant (marked "farm data" in the lease's tenant list), and a lease with that tenant scopes its Tenant data panel to that entity's fields and prices.

A **lease** belongs to a tenant and covers the land you link to it: whole properties, or single ag fields added on the lease page with **+ Link land**. Leased acres start from your mapped acres and can be edited, since contract acres often differ from map acres.

Agricultural leases are **cash** (per acre or lump sum), **flex** (a base rate per acre plus a bonus you estimate each year), or **crop share** (your share of the crop less any shared expenses). Hunting leases are an annual lump sum or a rate per acre. A hunting lease can require insurance; the lease page then warns when the tenant has no certificate on file or it has expired.

The Leases page lists every lease with its type, status, tenant, leased acres, and dates.

## Creating a lease

Creating a lease is for admins. Tap **+ New lease**, then choose one:

- **Upload lease document and extract terms**: a PDF of the signed lease. The app reads the type, tenant, dates, renewal and notice terms, rent structure, payment schedule, the land it covers, and special provisions, and suggests a price method from the pricing clause. Fields it was unsure about are highlighted amber. The PDF is filed under the lease's Documents.
- **Enter terms manually**.

Nothing saves until you review the form and press **Save lease**.

## Status and dates

New leases start as **Active**. Change the status at the top of the lease page or under **Edit lease terms**: Draft, Active, Expired, or Terminated.

What rent is expected follows the lease's dates, not its status:

- Rent is expected only for payments whose due date falls between the lease's start and end dates. A one-year lease that runs July to June and is paid July 1 expects one payment, not two.
- One exception keeps a lease from coming up a payment short: if it starts February 1 with rent due January 1 and would otherwise have fewer payments than lease years, the first year's payment is still expected.
- Marking a lease Expired or Terminated keeps the expected rent of its own years, so past years do not change. Expected payments for years after the year it ended stop counting, unless money was recorded against them.
- If a lease ended early, set its end date to the day it ended; rent due after that date is no longer projected. A lease marked Expired or Terminated whose end date is still ahead shows an amber note with an **end it today** link. If expected payments were already generated, an admin then presses **Refresh expected payments** so the unpaid rows follow the new date.
- A Draft lease counts in Income the same as an Active one.

The status does matter in three places: Home reminds you about Active leases that are ending within 90 days or have ended (unless they auto-renew); tenant numbers from farm data fill only Draft and Active crop share leases; and your government payment share is no longer projected once a lease is Expired or Terminated.

## Tenant data flows in by itself

On a crop share lease (Draft or Active) whose land is matched to the tenant's fields under Field mapping, the year assumptions fill themselves. Planted acres, the tenant's projected yields (actual once harvest is complete), and the tenant's projected prices are saved to the lease at every sync and keep updating as the tenant revises them. Yields and prices arrive only when the farmer shares them. A price the farmer marks final replaces the projection and is labeled final. There is nothing to turn on per lease; a new lease picks its numbers up on the next sync (or press **Refresh now** on the Farm connections page).

Every automatic value shows its source and as-of date in small print under the crop row. **Your edits always win**: type over a value and press **Save**, and it is yours; a sync never replaces it. Once you change anything in a year by hand, the app also stops adding crop rows to that year. In a year you have not touched, when the tenant's rows for a crop change between separate irrigated and dryland rows and one blended row, the lease's rows follow, so a crop is never counted twice.

The **Tenant data** panel above the rows still shows everything shared, with **Use**, **Use row**, and **Use all** buttons that fill the tenant's numbers in amber for you to save. The Income page says plainly when its expected figures rest on tenant projections.

## Government payments on share and flex leases

Crop share and flex leases ask one required question: **Landowner receives a share of government payments** (ARC and PLC on the leased base acres) or **Tenant retains all government payments**. If you receive a share, enter **Your share (%)** (on a crop share lease it prefills from your crop share) and say how it arrives: **FSA pays me directly (I am a party on the farm record)** or **Tenant remits my share**.

A tenant-remitted share is added as an expected payment due October 1 of the following year when expected payments are generated or refreshed, so a tenant check can be matched to it in **Upload rent received**. An FSA-direct share is projected as income but is never expected in a tenant check. When you upload a lease, the reader looks for the government payment clause, fills in the answer when the lease states one (amber when it was unsure), and shows the clause under the question.

## How a year's number is figured

On crop share and flex leases, each year's row under **Projection assumptions by year** ends with its Projected total (or Incomplete) and a **How this is figured** link. It opens a page that shows the arithmetic behind that total step by step, with a chip on every input saying where it came from, a list of what is still missing, and the payments received against it. The Income page's by-lease table opens the same page for every kind of lease, cash and hunting included.

## Payments

Each lease can carry a **payment schedule**: one to four payments a year, each with a label, a due month and day, and either a percent of the year's rent or a fixed dollar amount. With no schedule, the year's rent counts as one payment due January 1, so set a schedule when rent is due on another date. The lease form warns in amber when percentages do not total 100, and lists any payment left out because its due date is outside the lease dates.

In the Payments section of the lease page:

- **Generate expected payments** (it reads **Refresh expected payments** once rows exist) turns the terms and schedule into dated rows for each payment that falls due inside the lease dates. Crop share and flex years need their assumptions filled in first. This button is for admins. Refreshing replaces unpaid rows and never changes a row that has money recorded against it.
- **Record payment** on a row records money against it; partial payments are fine. **Record unscheduled payment** records money that matches no row.
- **Upload rent received** reads a check photo or a settlement sheet (see the Income views topic).
- Each row shows a status worked out from what you record: Upcoming, Due soon (within 30 days), Past due, Partially paid, or Paid.
- Admins can **Delete** an expected row; money recorded against it stays as unscheduled payments. Deleting a recorded payment asks first.

You do not have to generate anything to see expected rent: until rows exist, Income projects the lease from its terms.

**Delete lease**, at the bottom of the lease page, removes the lease with all of its expected and recorded payments after asking.

## Common questions

- **The lease covers land on two properties.** Link both properties, each with its leased acres; income splits by those acres.
- **The tenant switched from cash to crop share.** Set the old lease's end date to the day it ended and mark it Expired, then create a new lease. The old lease's years stay as they were.
- **I do not see Refresh expected payments.** It is for admins. You can still record payments.
- **Where do government payments fit?** Crop share and flex leases ask whether you receive a share (see above). See the Government payments topic.

# Lease price methods and projections  (page: /leases)

## Why a price matters

Crop share rent depends on a crop price. Each crop share and flex lease records **how** its price is established: the **Price method** in the lease terms. On a crop share lease the method decides which price helper shows under each crop row of a year's assumptions. A price a helper fills in is amber until you press **Save**.

One thing saves by itself. On a Draft or Active crop share lease connected to your tenant's farm data, the tenant's acres, yields, and prices are written into the year at every sync, whatever the method. They fill blank values and values that came from the tenant before. A number you typed is never replaced.

On a flex lease the rent is the base rate times leased acres plus a bonus estimate you type each year. The price helpers show there for reference only.

## The methods

- **Manual (enter prices yourself)**: you type the price.
- **Tenant's average price (farm connection)**: the tenant's farm software shares their projected or final average price for the crop, if they turned that sharing on. It shows in the Tenant data panel.
- **RMA insurance benchmark (public data)**: the public USDA crop insurance projected price, harvest price, or the average of the two, for a crop and state. In the lease terms, tap **+ Add crop benchmark**, pick the crop from the list (corn, soybeans, wheat, cotton, or canola), enter the two-letter state, and choose which price to use. No connection needed. Each crop row then shows the benchmark with **Use this price**.
- **Custom recipe (from the lease's pricing clause)**: a formula built once from the lease's pricing clause (for example the average of two elevator quotes less a basis). On the lease page tap **Set up recipe**, check the clause, tap **Design recipe**, review the description, inputs, and formula, then **Confirm and save recipe**. Each year, **Compute price** asks for any numbers you must type, shows the arithmetic, and offers **Use this price**. The same recipe and inputs always give the same number.

## Year assumptions

For each year of the lease, a crop share lease holds one entry per crop grown on the leased ground: crop, practice (Blended, Irrigated, or Dryland), acres, expected yield, expected price, and your share of shared expenses. **+ Add crop** adds an entry. Two crops on the same ground (wheat then soybeans) are two entries. Projected rent sums them. An entry missing acres, yield, or price keeps the whole year marked Incomplete rather than guessing. Shared expenses are subtracted only when the lease terms say the landowner shares expenses.

## The Tenant data panel

When land on this lease is matched to a connected tenant's fields (Field mapping), a **Tenant data** panel sits above the year rows. For each lease year with shared plantings it lists every crop the tenant planted on the leased ground: acres, yield (projected, or actual once every field of that crop is harvested), and average price (projected or final). A cell reads **Not shared** when the farmer has that sharing off.

On a crop share lease, **Use**, **Use row**, and **Use all** fill the year's entries in amber for you to save. **Use all** never replaces a value you already saved. On a flex lease the panel is for reference.

## Common questions

- **The RMA price is blank.** The card shows each price as yet to start, in discovery, or released. Before discovery starts there is no number. With the average chosen, the projected price is used alone until the harvest price starts. If RMA lists no offer for the crop in that state, the card says so.
- **The RMA card says the crop is not mapped.** The benchmark was saved under a crop name RMA does not cover; the lease terms show it as "not covered by RMA". Under **Edit lease terms**, pick corn, soybeans, wheat, cotton, or canola from the crop list.
- **I chose Tenant's average price and see no price.** The price shows in the Tenant data panel. The panel is missing when no land on the lease is matched to a connected tenant's fields; an amber note on the lease page then says so and links to Farm connections. The price reads Not shared when the farmer has price sharing off.
- **The tenant's price is for a different crop.** Prices match crops strictly. A crop the tenant planted that is not in the year's entries is marked "not in this year's crops" and never fills another crop's price.

# Signing in, your password, and getting connected  (page: /login)

## Creating your account

Someone who is already an admin on the account invites you by adding your email address under Settings, then Members. Nothing is emailed to you from that step: they send you the sign-up link themselves.

1. Open the sign-up link and choose **Create your account**.
2. Enter your name, **the same email address they invited**, and a password of at least 8 characters. Tap **Show** to check what you typed.
3. Open the confirmation email that arrives and tap the link in it. Open it on the same phone or computer you signed up on.
4. You are signed in and taken to your land.

## If you land on "Almost there"

That page means your account exists but is not connected to any land yet. It shows the email address you are signed in with. Usually the invitation was made for a different address (a work address instead of a personal one, or a typo). Ask the person who invited you to invite the exact address shown, then tap **I have been invited. Check again**. Or sign out and create your account with the address they did invite.

## If the confirmation email does not come

Check your spam or junk folder first; it can take a minute or two. If it is not there, go to Sign in, enter your email and password, and tap **Send the confirmation email again** when it appears.

A link that says it has expired, or that could not be used, has either been used already, is too old, or was opened on a different device from the one that asked for it. Ask for a new one from the device you are holding.

## Forgot your password

On the Sign in page tap **Forgot your password?**, enter your email, and tap **Email me a reset link**. Open that email on the same device and tap the link, then type a new password twice. The link works once.

## Changing your password

Signed in, go to Settings and tap **Change password**. Type the new password twice and save. You stay signed in.

## Common questions

- **Can I sign in on my phone and my computer?** Yes, with the same email and password. Each stays signed in on its own.
- **It says my email and password do not match.** Tap Show to check the password, make sure the email is the one you signed up with, and use Forgot your password if you are not sure.
- **I signed in but the app is empty.** You are connected, but no land has been shared with you yet. Ask an admin to tick the entities you should see under Settings, then Members.
- **Do I have to sign in every time?** No. You stay signed in on that device until you sign out under Settings.

# Maintenance issues  (page: /maintenance)

## What this page is for

A lightweight to-do list for the land. Every problem you mark on the map (a bad wash, a sinkhole, a broken terrace, a road washout, or anything else with its own label) shows here until you mark it resolved, grouped by property and then by ag field. A box at the top narrows the list to one property, and **Map** on each row jumps to that spot.

## Adding an issue

On the Map, tap **+ Add**, then **Maintenance issue** under **Needs attention** near the bottom of the picker. Pick the type, then how to mark it: a **Pin** for a spot (a sinkhole), a **Line** for something that runs along the ground (a failed terrace section), or an **Area** you trace (a wash, a washout). The save form takes an optional label, a severity (none, low, medium, high), and notes; "Other" needs a label. The property fills in from where you drew. An admin may leave it empty; other members must choose a property. Press **Save issue**.

Issues are their own layer in warning colors (amber, red when high severity) so they read as problems, never as land. The Layers box has a separate **Maintenance issues** toggle, so you can hide them while working on boundaries and bring them back later.

## Marking resolved

Tap the issue on the map and press **Mark resolved**, or press the button beside it on this page. Resolved issues turn gray on the map and move under **Resolved** here (tap it to show them); **Reopen** brings one back. To change an issue's type, label, severity, or notes, or to delete it, tap it on the map and use **Edit details** or **Delete**.

## Common questions

- **Does an issue belong to a field?** A pin or area that lands inside an ag field of its property is grouped under that field. A line, or anything outside a field, sits directly under the property.
- **Do issues print?** Yes. With the Maintenance issues layer checked, the map PDF draws them in their warning colors with their own legend rows and lists the open ones in the frame beside the legend (on a second page when there is no room beside it).
- **Who can see them?** Admins see every issue. Other members see the issues on properties that belong to the entities ticked for them. An issue saved with no property is visible to admins only.

# The map  (page: /map)

## What this page is for

The Map is the first page you see after signing in: your properties on satellite imagery with every boundary and feature you have recorded. Tap anything to open its panel, edit its details, or jump to its full page.

## On a phone

The controls sit behind two buttons at the top left. **Layers** opens a panel with everything described below (layers, labels, Filter, the legends, Zoom all, Fullscreen); **Close** puts it away. **+ Add** is right beside it. While you are drawing or editing, Layers waits at the bottom left instead.

## Layers and legend

The Layers box (top left on a computer) turns each kind of thing on or off: Properties, Parcels, Ag Fields, Pastures/Grassland, Wetlands, Pollinator habitat, Timber, Cemeteries, Roads, Easements, and Assets. Below a rule sits a separate **Maintenance issues** toggle: problems you have marked (washes, sinkholes, broken terraces, road washouts) live on their own layer in warning colors and can be hidden without touching the land view. A **Labels** section holds two switches: **Property names** for the big property labels and **Other names** for every other name label (ag fields, pastures, timber, wetlands, pollinator habitats, cemeteries, roads, easements, parcels, assets, and maintenance issues). Turning a name switch off hides only the text; boundaries and markers stay. At the bottom, **Neighbors** overlays the surrounding tax parcels and owners from county records (see the Neighbors topic). Your choices are remembered on this device. Parcels start off because they clutter the view.

- **Cemeteries** are a muted violet with a "C" marker: at the center of a traced plot, or on its own for a single pin.
- **Timber types** get their own legend while the Timber layer is on (planted pine, natural pine, hardwood, mixed, other; only the types you have).
- **Easements** show a legend by family: Utility, Access / transport, Drainage / flowage, Conservation, and Other easements, listing only the families you have recorded. Railroads get a tie pattern, conservation easements a hatch.
- **Crops** appears when a connected tenant has shared this year's plantings on fields matched to your ag fields; it recolors ag fields by this year's crop.
- **By entity** appears when you have more than one entity; it recolors property outlines by owner.
- **Maintenance issues** are amber, red when marked high severity, and gray once resolved; a pin, or the center of a traced area, shows an exclamation mark. See the Maintenance issues topic.

## Tapping things

Tapping a feature opens a panel (a card on a computer, a sheet on a phone) with its acres or length, property, details, and notes. **View full page** opens its own page with documents. A maintenance issue has no page of its own, so its panel reads **View all issues** and opens the Maintenance list. The buttons depend on what you tapped:

- **Edit details** changes the name and the other fields. An asset has **Open asset page** and **Quick edit name and notes** instead.
- **Edit boundary**, **Edit line**, **Edit outline**, or **Move pin** changes the shape or the spot. See the Drawing topic.
- Special tools: **Split** for a timber stand, **Edit coverage** for a pivot, **Edit circle** for a round footprint, **Timber Scan** for a property, **Add photos** for a pollinator habitat (on a phone it opens the camera and files the pictures on the habitat's page), and **Mark resolved** or **Reopen** for a maintenance issue.
- **KML** downloads that one shape as a file for Google Earth or other mapping software.
- **Delete** removes the record after you confirm; for a parcel, ag field, or timber stand the confirmation says what goes with it. An asset has **Deactivate** instead, which keeps it in your records and takes it off the map.

On an ag field, pasture, timber stand, or anything else that sits on a property, the panel's Property row is a link: tap the name to open that property's own panel (acres, entity, tenant activity, its tools), or **Page** beside it to go straight to the property page.

A property is never deleted from the map, because deleting it removes everything on it. Its panel links to the property page (**Manage or delete this property** for an admin), where an admin sees the full list of what would go and types the property's name to confirm.

Where things overlap, a tap picks maintenance issues first, then assets, cemetery pins, roads, easements, ag fields, pastures/grassland, cemetery plots, wetlands, pollinator habitats, timber, parcels, and properties.

## Other controls

- **Zoom all** fits everything you own on screen.
- **Fullscreen** hides the app frame; **Exit full** brings it back.
- **Print** and **Export** share one pill at the top right while nothing is selected. Print makes a PDF of the framed area (see the Printing topic). Export downloads what the map shows as a KML or GeoJSON file (see the Exporting topic).
- **+ Add** opens one picker with everything addable (land, lines, assets, maintenance issues) and a filter box for a fast pick. See the Drawing and Assets topics. At the bottom of the picker, **Import a file** brings in shapes from a KML, KMZ, GeoJSON, or zipped shapefile instead of drawing them; on a computer you can also drag a file straight onto the map. See the Import files topic.
- **Filter** (under the Layers box) hides individual items from the map: tap property chips to hide a whole property with everything on it, or search the item list and uncheck single fields, stands, or assets. Hidden items leave the map and its labels, an amber "N hidden" pill offers one-tap clear, and your choices stick on this device. Layers stay the coarse control; Filter works within them.

## If the map does not load

On a weak signal a banner says the map could not load, with a **Retry** button. Whatever was already on the map stays while you retry. If the satellite picture itself cannot load, the banner offers **Reload** instead.

## Common questions

- **Why do my acres differ from the deed?** Map acres are computed from the drawn shape. County records often carry deeded acres that differ slightly; a parcel's panel shows both when the county supplied them.
- **A label is hiding something.** Turn off **Other names** or **Property names** under Labels while you work. The shapes stay.
- **Can I see last year's crop?** The Crops layer shows the current year only; the Farm Data page shows earlier years.
- **How do I delete a property?** From the property page, not the map, and only as an admin. See "Tapping things" above.

# Drawing boundaries, roads, and easements  (page: /map)

## Pick first, then draw

Tap **+ Add**. One picker holds everything addable, in groups: **Land and boundaries** (Property boundary, Parcel, Ag field, Timber stand, Pasture/Grassland, Wetland, Pollinator habitat, Cemetery with Draw the plot or Drop a pin), **Lines and corridors** (Road, Easement with Line or Area, Fence), **Assets** (see the Assets topic), under **Needs attention**, a Maintenance issue, and last, under **From a file**, **Import a file** for shapes you already have as a KML, KMZ, GeoJSON, or zipped shapefile (see the Import files topic). A filter box at the top narrows the list as you type. Property boundary is offered to admins only, because creating a property is admin work.

Once you pick, the right tool loads, the shape you draw shows in that type's color, and the save form already knows what it is, with its extra fields visible from the start (stand type and species for timber, easement type and holder for easements). The type stays fixed for that session; to draw something else, finish or cancel and start again.

## Drawing a shape

- Tap the map to place points. Double tap the last point to finish.
- **Discard shape** (or the Escape key) removes only the shape you are tracing. Finished areas and everything typed in the form stay.
- **Cancel** ends the whole session. If finished areas exist it asks first, so a mistap never throws away minutes of tracing.

## The save form

- **Property.** A parcel, ag field, pasture, wetland, pollinator habitat, timber stand, cemetery, or road must be given a property. The form starts on the property you drew inside (a "Suggested from location" chip); when the shape sits inside none, you choose one. Change it if the guess is wrong.
- **Easements, assets, fences, pipes, and maintenance issues** may be saved with no property by an admin. Other members must choose one. A record with no property is visible to admins only.
- **A new property** asks **Held by** once you have created an entity: pick the entity that holds it, or No entity. Family members who are not admins see a property only through its entity, so a property saved with No entity is visible to admins only.
- **Save** stores it; **Discard** throws the drawing away (it asks first for a traced area).

## Several areas in one record

After the first area is finished, the save form offers **+ Add area** and **Cut area out**. Add draws another polygon that merges in (areas do not need to touch). Cut draws a hole (a pond, a house lot). The form stays as you left it while you draw more.

## Cemeteries

A family or church plot is usually small. Trace its edge when you know it (the plot shows acres like any land type) or drop a single pin on the marker. Either way it gets its own violet look and a "C" marker so it stays findable when zoomed out.

## Pollinator habitats

A pollinator habitat is wildflowers and native grasses planted or managed for bees, butterflies, and other pollinators: a CRP CP-42 planting, an EQIP practice, a monarch waystation, a field border, or a corner taken out of production. Draw it like any other land area; **Edit details** then records the program, the year it went in, and the seed mix. Photos are the point of the record: the map panel and the habitat's page both have an **Add photos** button (on a phone the map panel's opens the camera), so you can shoot the stand each season, and the pictures collect in the gallery on its page.

## Maintenance issues

Problems that need fixing are not land, so they have their own layer. Pick **Maintenance issue**, then the type (wash, sinkhole, broken terrace, road washout, or other with a label), then how to mark it: a **Pin** for a spot, a **Line** along a terrace or ditch, or an **Area** you trace. Give it a severity if you like. Issues draw in amber (red for high severity) and gray once resolved; tap one and press **Mark resolved**, or work the list on the Maintenance page. The Layers box hides or shows them separately from everything else.

## Editing later

Tap a feature and choose **Edit boundary** or **Edit line**. The shape shows its points:

- **Drag a point** to move it.
- **Tap a point, then press Delete point** to take it out. An area keeps at least three points and a line two.
- **Press the small dot halfway between two points** to add a new point there.
- **Dragging anywhere else moves the map**, not the shape. A boundary is never slid as a whole, so a stray swipe cannot move your property line.
- **Add area** and **Cut area** on the toolbar make bigger changes to an area.

Press **Save** when it looks right, or **Cancel** to leave it as it was. Timber stands also offer **Split**: draw a line all the way across the stand, confirm, and it becomes two stands with the details copied.

## Common questions

- **Line or area for an easement?** A line when you know the centerline (a powerline, an access lane); it shows length, and width is a note. An area when you know the strip, the flowage pool, or the conservation tract; it shows acres.
- **Where did Pipe and Fence go?** Fence is under Lines and corridors and Underground pipe under Assets; both draw as lines. Your own buried irrigation pipe is an asset; a pipeline company's corridor is an easement.
- **The wrong type is selected.** Cancel the session and pick again. The type cannot change mid-session on purpose.
- **It will not let me save without a property.** That is on purpose: what family members can see follows the property. Pick the property the shape belongs to.

# Assets on the map  (page: /map)

## Placing an asset

Tap **+ Add** and pick the type under **Assets** (well, shop, barn, grain bin, house, pond or dam, and so on; the filter box at the top gets you there fast), then how to place it:

- **Pin**: a crosshair sits over the map. Pan the map under it or drag the crosshair itself, or tap **My location** to use the phone's GPS, then press **Place here**.
- **Draw outline**: trace the footprint (a shop, a barn, a pond surface). The panel then shows the footprint in square feet, or acres when it is large.
- **Circle**: for round structures. Place the center with the crosshair, then set the diameter by typing it or dragging the blue rim handle; the white handle moves the center. Press **Save circle**. (Grain bins and bin sites place as a pin or outline only; a bin's number is its capacity in bushels.)

The save form needs a name. An admin may leave Property empty; other members must choose one, and an asset with no property is visible to admins only. Specs, photos, and documents are added on the asset page afterward.

## Grain bins and bin sites

A **grain bin site** stands for the cluster: from far out the map shows one site marker, its label carries the site's total bushels, and the individual bin pins appear as you zoom in. Tap the site for its total capacity, the list of bins, and **+ Add bin to this site**; tap a bin for its own capacity and a link up to its site. Bins without a site behave like any other pin.

## Irrigation pivots

Tap **+ Add**, then **Irrigation pivot** under Assets. Place the center with the crosshair, and the coverage editor opens: drag the blue handle or type the **Radius** (the wetted length in feet), choose **Full circle** or **Partial circle** (green and red handles set the arc), then press **Save coverage** and name the pivot. The coverage circle drives irrigated acres on the ag fields it covers. **+ Add area** draws extra irrigated ground that joins the coverage (a corner arm lobe, end gun reach); **+ Cut area** removes ground that is watered but not plantable (a pond, a waterway). The panel shows plantable acres, and gross watered acres when they differ.

## Editing

Pins: tap the asset, then **Move pin**. Footprints: **Edit outline**. Circles: **Edit circle** (it reopens the center and diameter editor; a circle's points are never edited one by one). Pivots: **Edit coverage**. The panel's **Open asset page** leads to the full form; **Quick edit name and notes** changes just those two.

## Common questions

- **Can a pond be a circle?** Yes. Circle is offered for every pin-placed type except grain bins and bin sites.
- **Where is the letter on the marker from?** Each type has a letter (W well, B bin, BS bin site, P pivot, S shop). Footprints and circles keep the letter at their center so they read from far out.
- **Deactivate or delete?** **Deactivate** (on the map panel or the asset page) keeps the history and takes the asset off the map. **Delete permanently** is on the asset page only and cannot be undone.

# Printing a map PDF  (page: /map)

## Making a printed map

Tap **Print** at the top right of the map. A page-shaped frame appears; pan and zoom until the frame holds exactly what you want printed. The frame is the printed area.

## The setup panel

- **Title** and **Subtitle / date**: the title starts as the property name when only one property is in view, otherwise your organization name; the subtitle starts as today's date. Type over either.
- **Orientation**: landscape or portrait.
- **Layers and labels**: each layer has its own checkbox for the print, prefilled from the live map, with a **labels** checkbox beside it (maintenance issues have no label checkbox). Parcel labels start off in print.
- **Color ag fields by crop** and **Color boundaries by entity** carry the map's Crops and By entity coloring into the print. They start the way the live map is set. The entity box shows only when you have more than one entity.

## Hiding single items

While the frame is up, tap any item on the map to leave it out of the print. It turns ghosted; tap it again to bring it back. A counter on the frame shows how many are hidden and clears them all in one tap. The panel adds property chips when several properties are in frame and a **Choose items** list with a filter box. Hidden items are gone from the PDF, its labels, and its legend. Nothing about hiding is saved; the next print starts fresh.

## Generate

**Generate PDF** renders the framed area at print resolution and downloads a Letter PDF with the map, title, a legend, a scale bar, a north arrow, and the Turnrow mark. When the Maintenance issues layer is checked, the open issues in the frame are listed beside the legend. On a phone, open the PDF and print or share from there.

The Neighbors overlay is never printed.

## Common questions

- **Why is the legend short?** It lists only the layers that are checked and have something on them. Items you hid do not count.
- **Can I print more than one page?** Each print is one map. Frame a second area and generate again. A second page appears only when the list of open maintenance issues has no room beside the legend.

# Exporting boundaries as KML or GeoJSON  (page: /map)

## What you can export

Every shape on the map can leave the app as a file: property and parcel boundaries, ag fields, pastures/grassland, wetlands, pollinator habitats, timber stands, cemeteries, roads, easements, assets, and maintenance issues. Two formats: **KML**, which opens in Google Earth, onX, and most mapping and farm software, and **GeoJSON** for GIS tools like QGIS and ArcGIS. Each shape carries its name, what it is, its acres or length, the property it sits on, and its details (parcel number and deeded acres, stand type and species, easement type and holder). A KML file is grouped in folders by kind and colored the way the map draws them.

## The whole map, or part of it

Tap **Export** in the pill at the top right (beside Print). The panel starts from exactly what the map shows: layers that are off and items hidden by Filter are already left out. Change your mind with the property chips (a whole property with everything on it; shown when you have more than one property), the **Choose items** list (single fields, stands, or assets), or the "N items left out" pill to include everything. While the panel is open the map drops whatever you leave out. Pick **KML** or **GeoJSON** and tap the **Download** button, which counts the items going in the file. The file is named after your organization and the date.

## One shape

Tap anything on the map and press **KML** in its panel. You get a file with just that shape, named after it. Handy for sending a tenant one field, or a surveyor one parcel.

## Common questions

- **Which format should I send?** KML unless the person asked for something else. GeoJSON is for GIS people.
- **Can I export a shapefile?** Not directly. Export KML or GeoJSON; QGIS (free) and most GIS tools convert either to a shapefile.
- **Will it import back in?** Mostly. Drop the same KML on the map, or on the Import page drop it on the **Tap to choose files** box or tap that box to choose it, and each shape comes back with its name, ready to be given a type and saved again. Areas can come back as a property, parcel, ag field, pasture/grassland, wetland, pollinator habitat, timber stand, or cemetery; lines as a road, underground pipe, or fence; points as assets. Easements and maintenance issues have no import type, so those would have to be drawn again.
- **Do hidden things export?** Not unless you include them. Export starts from the screen; use the item list to add anything the map is hiding. Items you add back from a layer that is switched off go in the file even though that layer stays hidden on the map.

# Neighbors  (page: /map)

## What it shows

Turn on **Neighbors** at the bottom of the Layers box to see the tax parcels around your land, drawn as thin light outlines under your own boundaries, with the owner of record from the county's public GIS records. Zoom in close and owner names appear on the parcels.

The overlay only works when you are zoomed in to about neighborhood scale. Zoomed out, the toggle shows "Zoom in to see neighbors" instead of loading thousands of parcels.

## Where it works

Neighbors covers the counties registered in the app's county service list, the same list the county import uses. In a county that is not registered yet, the toggle says "Neighbors not available in this county yet". If the county's server does not answer, it says "County server not responding"; try again later. Your own parcels never appear in the overlay; they are already on the map in their own style.

## Tapping a neighbor parcel

Tap any neighboring parcel to see the owner as the county recorded them, the parcel number, acres (deeded, or an estimate when the county gives none), and the address when the county publishes one, plus two buttons:

- **Import this parcel** opens Import from county records with that parcel already searched, ready to assign to a property.
- **Find all parcels for this owner** runs an owner search in that county, grouping every way the county wrote the name.

## Nothing is saved

Neighbor parcels are drawn live from public county records and are never saved to your account. They disappear when you turn the toggle off, and they are left out of printed maps and exports. The only way county data enters your records is the import flow, where you choose exactly what to bring in.

# Parcel pages  (page: /parcels)

## What a parcel page shows

A parcel is one county tax parcel inside a property. Open one from the Parcels list on its property's page, or tap it on the map and choose **View full page**.

- **Acres**: map acres worked out from the drawn boundary (**Acres (GIS)**), and **Deeded acres** when the county supplied them.
- **Details**: county, where the parcel came from, and notes. **Edit** changes the parcel number, county, and notes.
- **View on map** opens the map on this parcel.
- **Tax statements**: one row per year this parcel is on a statement, with this parcel's tax, the statement's total when that is a different amount, and what has been paid toward this parcel's share. Tap the year to open that year on Property Taxes.
- **Documents and photos**: **Add document** files a deed, survey, or photo on this parcel.

## Identifiers

Counties print different numbers for the same parcel: the parcel number, a PPIN or PIN, an account number, a key number. **Identifiers** lists every number on file for the parcel and where it came from (county records, a tax statement, or added by hand). Tax statements match to the parcel by these numbers.

- **Refresh from county records** looks the parcel up in the county's records again and saves the numbers the county publishes. It reports when the county has no registered service or does not know the parcel number.
- **Add** saves a number by hand, as printed on a bill.
- The **x** beside a number removes it. The parcel number itself cannot be removed here.

## Common questions

- **How do I move a parcel to another property?** On the property page, under Parcels, use **Move parcels to another property**.
- **How do I change the boundary?** Tap **View on map**, then **Edit boundary** in the parcel's panel.
- **How do I delete a parcel?** From its panel on the map. Its tax identifiers, valuation history, and valuation notices are deleted with it. Tax statements that list it are kept, but that line then shows as not matched to a parcel.

# Pasture and grassland pages  (page: /pastures)

## What a pasture page shows

A pasture or grassland is grazing or hay ground drawn inside a property. Open one from the Pastures/Grassland list on its property's page, or tap it on the map and choose **View full page**.

- **Acres**, worked out from the drawn boundary.
- **Notes**, if any were entered.
- **Edit** opens the name and notes so you can change them; **Save** keeps the change.
- **View on map** opens the map on this pasture.
- **Documents and photos**: **Add document** files a paper or photo on this pasture.

## Common questions

- **How do I add a pasture?** On the Map, tap **+ Add**, then **Pasture/Grassland**, and draw it.
- **How do I change the boundary?** Tap **View on map**, then **Edit boundary** in the pasture's panel.
- **How do I move it to another property?** On the property page, under Pastures/Grassland, use the Move link.
- **How do I delete it?** From its panel on the map.
- **Is cropland a pasture?** No. Row crop ground is an ag field. See the Ag Fields topic.

# Pollinator habitat pages  (page: /pollinator-habitats)

## What a pollinator habitat page shows

A pollinator habitat is ground planted or managed in wildflowers and native grasses for bees, butterflies, and other pollinators: a CRP CP-42 planting, an EQIP practice, a monarch waystation, or a field border. Open one from the Pollinator habitats list on its property's page, or tap it on the map and choose **View full page**.

- **Acres**, worked out from the drawn boundary.
- **Program**, **Year established**, **Seed mix**, and **Notes**, when they were entered.
- **Edit** opens those details so you can change them; **Save** keeps the change.
- **View on map** opens the map on this habitat.
- **Photos and documents**: **Add document** files a photo or paper on this habitat. Adding photos through the season shows how the stand is coming along.

## Common questions

- **How do I add a pollinator habitat?** On the Map, tap **+ Add**, then **Pollinator habitat**, and draw it.
- **Can I add photos from the field?** Yes. Tap the habitat on the map and choose **Add photos**. On a phone that opens the camera, and the pictures are filed on this page.
- **How do I change the boundary?** Tap **View on map**, then **Edit boundary** in the habitat's panel.
- **How do I move it to another property?** On the property page, under Pollinator habitats, use the Move link.
- **How do I delete it?** From its panel on the map.

# Properties, parcels, and entities  (page: /properties)

## Properties and parcels

A **property** is a piece of land you think of as one place (the home place, the river farm). Each has a boundary, county and state, optional FSA farm numbers, notes, and any other names deeds use for it (**Also called**). **Parcels** are the county's tax parcels inside it, each with a parcel number, its own boundary, and deeded acres when the county supplied them. Tax statements match to parcels, so keeping parcel numbers accurate pays off at tax time.

The Properties page lists every property with its acres, county, and its counts of parcels and ag fields. Once entities exist the list is grouped **By entity**; **All** shows one plain list. Admins add a property with **+ New property**. A property made this way has no boundary until one is drawn or imported.

## The property page

- At the top: the name, county and state, acres, **Held by** (the entity that holds it), **Edit**, **Also called**, **Timber Scan**, and **View on map**.
- **FSA farm numbers**, a picture of the boundary, and a base acres and government payments card once an FSA farm is linked to the property.
- Lists of what is on the property: Parcels, Ag fields, Wetlands, Pollinator habitats, Pastures/Grassland, Cemeteries, Timber stands, Roads, Easements, and Assets. Tap a name to open its page.
- **Income allocated to this property**: expected, received, taxes paid, and net by year, with **Earlier years** behind a tap.

Leases, tax statements, and documents are not listed on the property page. Find them on the Leases, Property Taxes, and Documents pages.

## Entities

Under Properties then **Entities**, admins create the owners of record: Individual, LLC, Corporation, Partnership, Trust, Estate, or Other. Set each property's entity with **Held by** on the property page. A property with no entity is visible to admins only, because other members see land through the entities shared with them. Home, Income, and Government Payments can be filtered by entity. See the Entities topic.

## Moving things between properties

On the property page, under each list of parcels, ag fields, wetlands, pollinator habitats, pastures/grassland, cemeteries, timber stands, roads, and assets, a link such as **Move parcels to another property** opens a checklist. Tick the items, pick the property, and tap **Move**. Boundaries and acres stay as they are; only the property the items belong to changes, and property outlines are not redrawn. The link shows only when there is something to move and another property to move it to. Easements have no Move link.

## Deleting a property

Only admins can delete a property, with **Delete this property...** at the bottom of its page. Deleting removes the property and everything on it, and the page lists exactly what will go before you confirm:

- **Deleted with it:** parcels (with their tax identifiers, valuation history, and valuation notices), ag fields, pastures/grassland, wetlands, pollinator habitats, timber stands, roads, assets, cemeteries, timber activity and cost records, timber basis accounts, cost-share awards and their payments, and Timber Scan results.
- **Kept, but no longer tied to any property:** easements, maintenance issues, and income records. Members who are not admins stop seeing these.
- **Kept:** leases, payments, timber sales, FSA farms, tax statements, tax payments, and documents. Their links to this property are removed, a tax statement line for a deleted parcel shows as not matched, and farm software fields matched to this property become unmatched.

To confirm, type the property's name and tap **Delete this property and everything listed**. This cannot be undone, so move anything you want to keep to another property first.

## Acres

- **Map acres** are computed from the drawn boundary and shown to one decimal. They change whenever the shape changes.
- **Deeded acres** come from the county record and are shown beside map acres on parcels.
- **Irrigated acres** on an ag field are the part covered by pivot coverage circles; the rest is dryland.
- A property with no outline reads **No boundary yet** in place of acres. When a property's outline and its parcels differ by more than 5 percent, the property page says so, because one of the two is usually out of date.

## Common questions

- **A property reads No boundary yet.** Open the property, tap **View on map**, then **Edit boundary** in its panel and draw the outline. Or import its parcels from county records with **Set property boundary to merged outline** ticked, or plot it from a deed in Documents.
- **Can one property belong to two entities?** No. Split it into two properties if ownership is split.
- **What are FSA numbers for?** They tie the property to USDA farm records and show on the map panel and the property page. A scanned FSA-156EZ uses them to link its farms and base acres to the right property. Government Payments has its own FSA farm records with base acres.
- **Can I delete a property from the map?** No. The map panel links to the property page, where an admin deletes it.

# Road pages  (page: /roads)

## What a road page shows

A road is a line drawn on a property: a gravel road, a dirt road, a paved drive, or a field road or turnrow. Open one from the Roads list on its property's page, or tap it on the map and choose **View full page**.

- **Length** in feet and **Miles**, worked out from the drawn line.
- **Road type** (Gravel, Dirt, Paved, Field road / turnrow, or Other) and **Notes**, when they were entered.
- **Edit** opens the name, road type, and notes so you can change them; **Save** keeps the change.
- **View on map** opens the map on this road.
- **Documents and photos**: **Add document** files a paper or photo on this road.

## Common questions

- **How do I add a road?** On the Map, tap **+ Add**, then **Road**, and draw the line.
- **How do I change where it runs?** Tap **View on map**, then **Edit line** in the road's panel, and drag its points.
- **How do I move it to another property?** On the property page, under Roads, use the Move link.
- **How do I delete it?** From its panel on the map.
- **A road washed out. Where does that go?** Mark it on the map as a maintenance issue so it shows on Home until it is fixed. See the Maintenance issues topic.
- **Is a public road or a neighbor's right of way a road here?** No. A right someone else holds across your land is an easement. See the Easements topic.

# Settings  (page: /settings)

## Your account

At the top of Settings: **Your name** (type a new one and tap Save name), the email address you sign in with, and **Change password**. Sign out is at the bottom of the page.

## Members

Admins invite people, set their role (**admin** sees and manages everything; **user** sees only the entities ticked for them), manage each user's access, and can remove a member. Inviting saves the invitation but does not send an email: the admin sends the sign-up link shown on the page. See the "Members, roles, and who sees what" topic for the full picture. Members who are not admins see the member list only.

## Admin sections

Platform administrators see extra sections: the county GIS registry (the public parcel services behind Import from county records, each verified live, with the identifier fields the county publishes such as PPIN mapped so tax statements can be resolved against county records), the parcel identifier tools (re-harvest, the pre-retention fetch, and a per-county refresh that re-reads every parcel in a county and reports how many gained a PPIN), and program parameters for government payment estimates (reference prices, loan rates, factors by program year). Regular users do not see these.

## Common questions

- **Change my name?** Type it under Your account and tap Save name.
- **Change my password?** Tap Change password under Your account. If you cannot sign in at all, use Forgot your password on the Sign in page.
- **Remove someone?** An admin taps Remove from account on that person's row. Their past uploads stay.
- **Change my email address?** Not from the app yet. Ask an admin to invite the new address, then create an account with it.

# Members, roles, and who sees what  (page: /settings)

## The two roles

Every member of your organization is an **admin** or a **user**.

- **Admins** see everything and manage everything: land, leases, taxes, documents, farm data, members, and access.
- **Users** see only the data belonging to the **entities** ticked for them: those entities' properties and everything on them (parcels, ag fields, timber, roads, easements, assets), plus the leases, income, taxes, documents, FSA farms, and shared farm data that reach the land through those properties. A user with no entities ticked sees an empty account until an admin ticks some.

The rule is enforced in the database itself, not just hidden in menus: a restricted user cannot reach another entity's records through any page, export, print, stored file, or the Ask assistant.

## Changing someone's role or access

On Settings under Members, each member other than you has a **Role** choice. For a user, a **Can see** list appears with a box per entity. Tick the entities they should see and tap **Save**. One Save covers both the role and the boxes, and a line under the button says what was saved or why it was not.

You cannot change your own role, so there is always at least one admin.

## Inviting someone

1. Under **Invite someone**, enter their email, pick the role, and for a user tick at least one entity.
2. Tap **Invite**. The invitation is saved, but **no email is sent from here**.
3. Send them the **sign-up link** shown below the form yourself, by text or email. **Copy link** copies it.
4. They create their account with that same email address and are connected automatically with the role and access you chose.

Waiting invitations are listed under **Invited, not signed up yet**. **Revoke** removes one. To change a waiting invitation, invite the same address again; the new choices replace the old.

## Removing someone

Tap **Remove from account** on their row and confirm. They can no longer see anything on this account. Their sign-in is not deleted, so inviting the same address again later reconnects them. Documents they uploaded stay.

## Records visible to admins only

A user reaches a record through the entity that owns its land. A record that is not tied to any entity is visible to admins only; unassigned never means visible to everyone. An amber notice in the Members section lists these so the gap is deliberate and not an accident:

- a property with no entity;
- an asset, easement, or open maintenance issue with no property;
- a lease with no land listed, a timber sale with no stands, an FSA farm not linked to a property;
- an income record with neither a property nor an entity;
- an unfiled document.

Documents attached to a tenant are always admin-only. The tenants themselves (names and contact details) are visible to every member.

## Common questions

- **A user says the app is empty.** They have no entities ticked yet, or their entities hold no properties. Tick entities for them on Settings, and check the amber notice.
- **Can a user create leases or upload tax statements?** No; creating leases, timber sales, FSA farms, tax statements, and farm connections is admin work. Users view and edit within their entities.
- **Can a user see tenants?** Yes. Tenant names and contact details are shared across the organization so lease pages read correctly for everyone.
- **Someone was invited but cannot get in.** They most likely signed up with a different email address than the one invited. See "Signing in, your password, and getting connected".

# Property taxes  (page: /taxes)

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

# Property tax report  (page: /taxes/report)

## What it is

On the Property Taxes page, **Tax report** reads every bill you uploaded together with the county's own parcel records. In this order it shows: the year's tax and why it changed, things worth a look (with dollars and a deadline where there is one), whether each parcel is getting current use and how its acres compare, tax per acre and as a share of income by property, the values printed on the bills, next year's bills where the county records already show them, the dates to know, and tax paid by calendar year. Pick the year, entity, property, or county at the top; **Print or save PDF** prints it.

The report is a worksheet to help you prepare, not legal or tax advice, and it says so under its title. Confirm deadlines and figures with the county, and tax questions with your accountant.

Under the year's tax, the top box reads "No 2026 bills on file" (with the year you picked) when nothing is uploaded for that year. It reads "Paid in full" only when bills are on file and nothing is open.

## Things worth a look

Each finding says what was found, about how many dollars it is worth, what to do, and by when. **Act** items come first, then **Ask**, then **Tidy**. A deadline that has already passed reads "This was due" with its date.

- **Not on current use**, or "Looks like it is not on current use": a parcel of 5 acres or more that the county record shows as not on current use, or whose taxable land value per acre is more than 25% above the state's current use value for the best soil class. In the 2025 table that value is $532.00 an acre for crop and pasture land and $827.00 for timber, mixed by the county's timber acres. The dollars are what current use would save at average soil, with a range from good to poor soil. Ask the revenue commissioner whether the parcel is enrolled. If it qualifies, apply between Oct 1 and the last business day of December (form cuapp); confirm the dates with the county. A new owner, including a new LLC or trust, must apply again.
- "No 2026 bill on file": from Oct 1 of the tax year, a parcel that was billed last year and has no tax on file this year. It is flagged even when a whole county's bills are missing. Taxes are owed whether or not a bill arrives.
- **Unpaid** or **Delinquent**: a bill for the report year with a balance, within 60 days of its delinquent date or past it. The finding gives the last day to pay on time, which is the day before the delinquent date.
- **Bill line does not look like this parcel**: the statement line is more than double, or less than half, the county's own figure for the next year. Either the line belongs to another parcel, or the value basis changed (for example current use granted or lost). Check the statement, then confirm the parcel's current use status with the county.
- **County figure does not tie out**: assessed value times the district millage, plus 10 cents per timber acre and any building fee, is off from the county's tax by more than $5.00 and more than 2%.
- **Acreage does not agree**: deed, county, and map acres differ by more than 10% and 2.0 acres. If the county counts more acres than the deed, ask the assessor to check the parcel against the deed.
- **County owner name differs** from the entity, so bills and current use may follow the wrong name or address.
- **Tax up**: a parcel's tax rose more than 15% and more than $50.00. Look at the valuation notice. A value increase can usually be protested to the Board of Equalization within 30 days of the notice; use the deadline printed on it.
- **Protest window open**: a valuation notice you logged is less than 30 days old. The date shown is counted 30 days from the notice date. Use the deadline printed on your notice and confirm it with the county Board of Equalization.
- Tidy items: more timber on your stands than the county counts, tax above 10% of a property's income for the year, a parcel entered twice, and bill lines not tied to a parcel.

## Current use and acreage

One row per parcel that has a county record on file: county, deed, and map acres; the county's timber acres; taxable land value per acre, with the best-soil current use value beneath it; the current use status; the year's tax; and a bill check that reads **Ties out** or **Off** with the difference.

The status is your answer when you gave one, the county's answer where its record shows one, or an estimate: "Looks like current use", "Looks like market value", or "Can't tell". Use the **Enrolled? Not sure** list on the row to record what you know (**Enrolled in current use** or **Not enrolled**); your answer overrides the estimate. Once you answer either way, that parcel's current use finding leaves the list above; a parcel you marked Not enrolled keeps, on its row, the estimate of what current use would save where one can be figured. The **Homestead** box records that a parcel holds a home you live in. It is kept as a note; the report's figures do not use it.

## Protest packet

**Protest packet**, under each parcel's tax in the Current use and acreage table, makes a PDF for that one parcel to take to the county. Page one says it is a worksheet, not legal or tax advice. It holds:

- The grounds the report found, each marked for the Board of Equalization, for the revenue commissioner, or as background for you. Acreage is a ground for the Board only when the county counts more acres than the deed (or than your map, when no deed figure is on file).
- The county's record for the parcel, and the values and taxes on your bills by year.
- Up to six other parcels of the same entity in the same county, for comparison.
- The state current use table.
- A filing checklist, with the date counted from the notice if you logged it.
- A draft protest letter with blanks to fill in and sign.

Use the deadline printed on your notice and confirm it with the county Board of Equalization. Nothing is sent to the county.

## Values on the bills

The value each year's bill printed, by parcel, marked "market" when it is a market value printed beside a lower current use value. Where a market value is known for a parcel on current use, **Current use saves** shows about what current use saves a year.

**Re-read bills for market and current use values** (the link under the report's title, shown to admins) reads each stored bill file again for everything it prints beyond the tax: market value, current use value, land and buildings, assessment ratio, tax district, millage, and timber acres. Tap **Read values** on a file, or **Read every unread file** at the top. Check what was read, then tap the save button under it, which names the count ("Save 12 lines"), or **Discard**. Tax amounts and parcel matches are never changed. New uploads read these values automatically.

## Dates to know and valuation notices

**Dates to know** lists the coming dates the report works to: taxes delinquent after Dec 31, the current use application window, and valuation notice season. It also notes that Alabama's limit on yearly increases in taxable value may end around Oct 1, 2027, which is not confirmed. Confirm every date with the county.

When a county's valuation notice arrives, pick the county, enter the date printed on the notice, and tap **Log notice**. The report then shows a protest date 30 days later at the top until it passes. A protest is usually due within 30 days of the notice; use the deadline printed on your notice and confirm with the county Board of Equalization. **Remove** deletes a notice logged by mistake.

## Tax paid by calendar year

For the accountant: property tax paid, grouped by the calendar year it was paid, then by entity and property, for the four most recent years with payments. A bill covering several parcels is split by each parcel's tax. Payments without a paid date are left out. The page treats tax as counting in the year it was paid, not the year on the bill; confirm with your accountant.

## Where the numbers come from

- Tax amounts: your uploaded statements. Year-over-year change is measured on tax, because the values printed on older bills mix market and current use value.
- Values, acres, timber acres, tax district: the county GIS records. A copy of each year's record is kept when the records are refreshed.
- Current use values: the Alabama Department of Revenue table. The 2027 table (ADOR Directive CU-2027) is loaded for bills collected from Oct 1, 2027.
- Millage: rural Lawrence and Colbert 30 mills and Lawrence town districts 37 mills, checked against the county records; Morgan 37.4 mills, checked against the 2025 Morgan bills.
- Savings are estimates at average soil.

The report prepares; you or your accountant act. Nothing is sent to the county.

# Tenants  (page: /tenants)

## What this page is for

Tenants are the people and operations that lease your land. Open the page from Leases, then the **Tenants** tab. Each row shows the tenant's name, contact person, phone, and email, an insurance badge, and how many active leases the tenant holds. Tenants that came from a farm connection are listed first with a **From farm data** chip. Tap a name to open the tenant's page.

**+ New tenant** adds one with a name and, if you like, a contact person, phone, and email; **Create** opens the new tenant's page. A tenant is also created when you choose **+ New tenant...** on a lease, and for each farming entity a connected farmer shares.

## A tenant's page

- **Details**: name, contact person, phone, email, mailing address, and notes. **Save changes** saves them.
- **Insurance**: tick **Insurance certificate on file** and enter **Insurance expires**. The badge then reads Insured through the date, Insurance expires (within 60 days), or Insurance expired. For a tenant with an active lease, Home lists a certificate that has expired or expires within 60 days, and a hunting lease that requires insurance when none is on file.
- **Farming entity**: which of a connected farmer's farming entities this tenant is. Linked, leases with this tenant use that entity's fields and prices from the farm connection; otherwise the whole operation's. When every matched field on the tenant's leases belongs to one entity, the page suggests it with **Use this**. Or pick one from the list and tap **Save**. **Unlink** removes the link.
- **Leases**: each lease with this tenant, with its type, dates, and status. Tap one to open it.
- **Documents (insurance certificates, W-9s)**: for admins, **Add document** files paperwork on the tenant. Other members do not see that button.
- **Delete tenant**: possible only when the tenant has no leases, and it asks first. Documents attached to the tenant stay in Documents but are no longer attached to a tenant. A timber sale that listed the tenant as buyer keeps the buyer's name.

## Who can see what

Every member of your organization can see, add, and edit tenants, contact details included. Documents attached to a tenant are for admins. Other members see one only when it is also filed on a property they can see, and they are not offered **Add document** on a tenant's page. The leases listed on a tenant's page are only the ones on land you can see.

## Common questions

- **Where do I record that a tenant paid?** On the lease, in its Payments section, or with **Upload rent received** on the Income page.
- **Can I rename a tenant that came from farm data?** Yes. The link to the farming entity stays.
- **Why can I not delete a tenant?** It still has a lease. Delete that lease, or change its tenant under **Edit lease terms**, first.

# Timber stands  (page: /timber)

## What a stand is

A timber stand is an area managed as one unit: planted pine of one age, a hardwood bottom, a mixed block. Each has a type (planted pine, natural pine, hardwood, mixed, other), species, the year it was planted or established, site index, trees per acre planted, a main goal (timber, wildlife, both, looks, or conservation), notes, and a boundary. The Timber page lists stands by property with each stand's age, last thinning and burn, and its next step. Buttons at the top open **Timber basis**, **Cost-share**, **Tax summary**, and **Timber sales**.

## Upcoming on your land

The top of the Timber page gathers the work that needs attention across all stands: thinnings that are due, burns, replanting after a harvest. Routine items (the yearly walk, a forester walk-through, a final harvest whose window has arrived) are grouped into one line each. Planted pine stands with no planting year are listed in one line asking for it. The schedule comes from typical timing for the stand type:

- **Planted pine**: herbicide release in years 1 to 2, first thinning around age 13 to 18 (earlier on better ground: add the site index for a sharper window), a prescribed burn every 3 to 5 years after thinning (2 to 3 if the goal is wildlife), a second thinning 6 to 10 years after the first, final harvest around age 28 to 38, and replanting after a clearcut or salvage harvest.
- **Natural pine**: a forester walk-through about every 10 years, and the burn cycle kept going if burns are on record.
- **Hardwood and mixed**: a forester walk-through about every 10 years.
- **Every stand**: walk it once a year and look for storm damage and trespass, plus fading or red crowns (beetles) in pine.

These are starting points for a conversation with your forester, not orders.

## Recording what happened (a stand's history)

On a stand page, **Record work** asks "What happened here?" with plain buttons: Planted, Sprayed, Burned, Thinned, Harvested, Walked it, Storm or bugs, Site prep, Fertilized, Cruised, and more. Then a short form:

- **Already done** or **Planning to do it**. Planned work shows at the top of the history with **Mark done**.
- **Year** (enough on its own) or an exact date.
- **Which stands**: one burn or spray can cover several stands of the property; it then shows in each stand's history.
- **More details** for the specifics: species, seedlings per acre and genetics for a planting; product and rate for a spray; burn manager and AFC permit number for a burn; buyer and kind of thinning; cause and acres for damage; the forester's value estimate for a cruise.
- **Timber sale**: on a Thinned, Harvested, or Cruised entry, when the property's stands are part of a sale, pick the sale the work belongs to.
- **Paperwork**: each history entry has its own documents (invoices, burn permits, cruise reports).

Each suggestion under **Coming up** has its answers beside it: **Already done: record it** (opens the form, already filled in), **Schedule it** (planned work), or **Not needed** (the suggestion goes away). A suggestion marked Later offers only the last two. Not needed answers are kept at the bottom of the history behind a "Show ... marked not needed" link; **Delete** one there and the suggestion comes back.

## Costs and taxes

Add each bill to the work it paid for (**+ Add a cost**): amount, date paid, who was paid, and what for. Every cost asks one question, "This cost was for:", and keeps the matching tax category:

- Getting new trees growing (site prep, seedlings, planting, early spraying): **replanting cost**, which counts toward the Section 194 replanting deduction.
- Upkeep of the woods (burning, firebreaks, spraying older trees, advice): **upkeep expense**.
- Selling timber (the forester's sale fee, a cruise for the sale, legal): **selling expense**. It lowers the taxable gain on a sale only when the cost is tied to that sale: enter it under **Selling costs** on the sale's page, or on a Thinned, Harvested, or Cruised entry with the **Timber sale** picked. A selling cost with no sale is not counted, and the tax summary lists it so it is not lost.
- Something that lasts (a road, culvert, bridge, gate): **lasting improvement**.
- Not sure: left for the accountant.

The app suggests the category from the kind of work (a spray in the first three years after planting counts as replanting). If the property has a cost-share contract, each cost row also has a picker for the contract that helped pay the bill (contracts are under Timber, then Cost-share).

A cost on work still marked **Planning to do it** is not counted as paid. It stays out of the stand's cost total and the timber tax summary until the work is marked done.

The stand page totals recorded costs by category. These are for your accountant: confirm with them before filing.

## Adding stands

- On the Map: **+ Add**, then **Timber stand**. The save form asks for the stand type (required) and a property, and prefills Loblolly pine for pine picks.
- From Timber Scan: let the app propose stands from USDA land cover data, then accept and save the ones that look right (see Timber Scan).
- From a file: a zipped shapefile, KML, KMZ, or GeoJSON through Import, choosing Timber stand for each shape.

## Working with stands

- **Split**: tap the stand on the map and press **Split**, then draw a line all the way across it and double tap to finish. The app shows the acres of each piece and asks before splitting. The stand's details are copied to the new stand, which takes the same name with "(2)" added. The history stays with the original stand.
- **Colors**: planted pine deep teal, natural pine olive, hardwood burnt orange, mixed violet, other gray, with a legend on the map.
- **Sales**: a stand page shows the sales it is part of and the timber income allocated to it.
- **Forested wetlands** stay timber stands (hardwood with a note); the Wetland type is for open marsh and sloughs.

## Common questions

- **The last thinning or burn year is wrong.** Record the thinning or burn in the stand's history; the latest year wins. The "Last thinning year (before the history)" and "Last burn year (before the history)" fields in Edit are for work done before you started recording, and still count.
- **The schedule says a thinning is past due, but it was thinned.** Use **Already done: record it** with the year it happened; the schedule moves on to the next step.
- **Why does it ask for the planting year?** The planted pine schedule is built from the stand's age. Add the year in Edit, or record a Planted entry with the year, and the suggestions appear.
- **Two stands should be one.** On the map, tap one, choose **Edit boundary**, use **Add area** to cover the other, and save. Then delete the spare from its map panel. The spare's history and sale links do not move to the stand you keep, so check them first.
- **Deleting an entry with paperwork.** Delete or move its documents first; the app will not delete the entry while documents are attached. Deleting an entry also deletes its costs, and asks first.

# Timber sales and settlements  (page: /timber-sales)

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

# Timber Scan  (page: /timber-scan)

## What it does

Timber Scan looks at a property with public USDA land cover data and proposes draft timber stands: where forest is, roughly what kind (pine, hardwood, mixed, or wetland hardwood), and how many acres. You correct the proposals, accept the ones that are right, and save them. Accepting alone saves nothing: no stand is saved until you press the save button at the bottom, which reads "Save 3 stands" with your own count.

## How to use it

- Open a property page and tap **Timber Scan**. The same button is on the property's panel on the Map. A first scan can take 10 to 30 seconds.
- Proposals draw as dashed outlines in draft colors so they never look like saved stands, and each is listed under the map with its kind, acres, and mix. Tap one on the map or in the list to select it.
- Fix a proposal before accepting it: **Edit shape** lets you drag its points (then **Save shape**), **Split** cuts it with a line you draw across it, **Merge** joins it with another proposal you pick, and **Remove** takes it off the list.
- **Accept** opens a short form on the proposal: stand name, stand type, primary species, year established, and notes. A pine proposal asks whether it is planted or natural; **Suggest planted vs natural** has the app look at the satellite image for planting rows and suggest an answer for you to confirm.
- The save button ("Save 3 stands", counting the accepted ones) saves every accepted proposal as a real stand. A pine stand cannot be saved until planted or natural is chosen. If a stand does not save, it stays on the list with the reason so you can try again.

## Good to know

- The data behind it is a satellite classification at roughly 30 meter resolution. Edges are approximate, and narrow hardwood drains can disappear. Treat it as a head start, not a cruise.
- Scans are clipped to the property boundary, so draw or import the boundary first.
- Ground that is already a saved stand is never proposed.
- A proposal that overlaps an ag field by more than 1.0 acre gets an amber "Overlaps ag field" chip. It is usually young pine on former cropland or an edge error; you decide.

## Common questions

- **It missed a young plantation.** Recently planted ground often classifies as open land. Draw that stand by hand.
- **Can I rerun it?** Yes. Opening Timber Scan again shows the last scan with the stands you have already saved left out. **Rescan** asks for a fresh one. Saved stands are never changed by a scan. Edits to proposals you did not save are not kept.
- **The scan failed.** The USDA service is sometimes slow or down. The page says so and offers **Try again**. If a **Rescan** fails, the earlier results stay on screen; press **Rescan** again later.

# Timber basis and depletion  (page: /timber/basis)

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

A tract's page lists every timber sale on its stands with what this tract received (its share, when a sale covers more than one property), the selling costs tied to that sale, the depletion, and the approximate taxable gain. Selling costs count here only when they are linked to the sale: entered under **Selling costs** on the sale's page, or on a Thinned, Harvested, or Cruised entry with that sale picked. A cost on work still marked **Planning to do it** is left out until the work is marked done, the same as on the tax summary.

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

# Cost-share contracts  (page: /timber/cost-share)

## What this page is for

Timber, then **Cost-share**, keeps every program contract that helps pay for work on the land: NRCS EQIP or CSP, FSA CRP pines, the Alabama Forestry Commission's Southern Pine Beetle Prevention program, Longleaf Alliance, or others. **Add a contract** records the property, the contract holder (the taxpayer), program, agency, contract number, status, signed and end dates, approved dollars, acres, the practices it pays for, and the date the practices must be kept up until.

The list shows each contract with dollars received against dollars approved, and an amber line while practices must still be kept up or a payment's tax choice is undecided.

## Payments and the tax choice (Section 126)

On a contract's page, under **Record a payment received**, enter the date, amount, and practice, pick how it is taxed, and press **Add**:

- **Exclude from income (Sec 126)**: not taxed now, but the costs it paid for cannot be deducted, and it is recaptured as income if the land is sold within 20 years (the page shows that date).
- **Report as income**: taxed now, and the costs it paid for can be deducted or count toward the replanting deduction.
- **Not decided yet**: your accountant chooses when the return is prepared; the tax summary flags it.

The choice can be changed later from the same dropdown on the payment. The amount that can be excluded has a cap and not every program qualifies, so have your accountant confirm the figure.

## Linking bills to a contract

When you record work on a stand (**Record work**, then **+ Add a cost**), each cost row has a dropdown that starts at "No cost-share" and lists that property's contracts. It appears once the property has at least one contract. A contract's page lists the bills linked to it under **Costs it helped pay**. Excluded cost-share is netted out of the replanting costs linked to its contract, so the replanting deduction never counts the same dollars twice.

## Paperwork

Attach the contract, practice approvals, and payment letters under **Contract and approvals**.

# Timber tax summary  (page: /timber/tax-summary)

## What it is

Timber, then **Tax summary**, gathers one taxpayer's timber numbers for one year into a page to hand the accountant. Pick the year and the entity at the top; **Print or save PDF** prints it, **Download CSV** gives a spreadsheet. It is built from the timber records (stand costs, timber basis, sales and settlements, cost-share) and is for your accountant: confirm with them before filing.

## What is on it

- **Bottom line**: four figures: **Timber received**, **Taxable timber gain (about)**, **Replanting deduction**, and **Upkeep and other costs**.
- **Before you send this**: what is missing or left out. See the list below.
- **Timber sales**: each sale on this entity's land with the dollars received this year (its share when a sale covers several properties), selling costs, depletion, the gain, whether it was held over a year (inherited timber always is), and the form it usually goes on (lump sum: Form 8949 and Schedule D for an investment; pay as cut: Form 4797 Part I under Section 631(b)). Selling costs count in the year they were paid, and only when they are linked to the sale. Depletion counts in the year it is dated on the timber basis page.
- **Replanting deduction (Section 194)**: per property, replanting costs paid this year, cost-share excluded from income netted out, the part deducted now (up to $10,000.00 per property per year; a trust gets none), and this year's amortization of the rest (84 months: 1/14 the first year, 1/7 the next six, 1/14 the eighth).
- **Cost-share received** with each payment's tax choice.
- **Other timber costs paid**: upkeep, lasting improvements, and "not sure" items. Whether upkeep is deducted now or added to basis depends on investment versus business treatment; the accountant decides.

Property taxes on timber land are on the Property Taxes page.

## Before you send this

The amber list names what to fix or ask about before the page goes to the accountant:

- A sale that took in money this year but has no timber stand linked. It is left out of the summary until its stands are linked on the sale page.
- A sale on a property with no timber basis set up, or with proceeds this year and no depletion recorded.
- Selling costs not linked to a timber sale. They are not counted. Pick the sale on the Thinned, Harvested, or Cruised entry the cost was entered with, or enter the cost under **Selling costs** on the sale page instead.
- Selling costs linked to a sale that has no stand on the cost's property. They are not counted either; check the stands linked on the sale page.
- Selling costs paid in a year the sale brought in no money. They are counted in the year paid; ask your accountant which year they belong in.
- Costs left out because the work they were entered on is not marked done. Costs on planned work are never counted; if the work is finished and paid, mark it done on the stand page.
- Cost-share payments with the tax choice not decided.
- Costs marked "not sure".
- A sale whose holding period cannot be shown because the timber basis has no acquisition date.
- A reminder that a trust gets amortization only, with no immediate replanting deduction.
- When depletion is claimed, a reminder that Form T is likely needed.

# Wetland pages  (page: /wetlands)

## What a wetland page shows

A wetland is open wet ground drawn inside a property: a marsh, a slough, a duck hole, or ground under a wetland easement. Forested bottomland is kept as a timber stand, not a wetland. Open a wetland from the Wetlands list on its property's page, or tap it on the map and choose **View full page**.

- **Acres**, worked out from the drawn boundary.
- **Notes**, if any were entered.
- **Edit** opens the name and notes so you can change them; **Save** keeps the change.
- **View on map** opens the map on this wetland.
- **Documents and photos**: **Add document** files a paper or photo on this wetland.

## Common questions

- **How do I add a wetland?** On the Map, tap **+ Add**, then **Wetland**, and draw it.
- **How do I change the boundary?** Tap **View on map**, then **Edit boundary** in the wetland's panel.
- **How do I move it to another property?** On the property page, under Wetlands, use the Move link.
- **How do I delete it?** From its panel on the map.
- **Where do I record a wetland easement?** As an easement, so its holder, recording, and restrictions are kept. See the Easements topic.
