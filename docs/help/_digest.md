# Turnrow Landowner capabilities digest

Generated 2026-08-22, version 0.1.0, build 9a31b98. Compiled from docs/help; regenerate with npm run help:build.

# What Turnrow Landowner does NOT do

Turnrow Landowner keeps a landowner's records: property and parcel boundaries on a satellite map, timber stands, roads, easements and assets, leases and tenant payments, timber sales, property taxes, documents, government program base acres, and the farm activity a tenant chooses to share. It deliberately does not do the following. If someone asks, say so plainly and do not improvise a workaround:

- **No accounting or tax preparation.** Income views show projected and received rent, timber money, and property taxes for planning. They are not a ledger, a P&L, or anything for a tax return.
- **No legal advice.** Boundaries plotted from deeds are estimates that follow the quality of the description. A licensed survey is the only thing that settles a line.
- **No payment processing.** Rent and timber checks are recorded by you; nothing moves money.
- **No farming operations.** No planting, spraying, or equipment records. Farm activity comes only from a tenant's farm software when the tenant shares it.
- **No weather or market advice.** Price benchmarks feed lease projections; nothing recommends when to sell.
- **No automatic county data.** County parcel records and public USDA data are looked up when you ask and always shown for your confirmation before anything saves.
- **No app-store app.** The app runs in the browser and can be added to a phone home screen from the browser's share or menu button.
- **No self-serve signup.** New organizations and users join by invitation.
- **US land, US dollars, US programs only.** County parcel lookups cover the counties in the registry (north Alabama first).

# Ask about your land  (page: /ask)

## What Ask does

Ask answers questions about **your own records**: "How many acres do I own in Lawrence County?", "Which parcels have unpaid 2025 taxes?", "What did timber sales bring in last year?", "What easements cross the river farm?" It reads the same figures the pages show and tells you, in plain language, what it looked at to answer.

## What it does not do

It does not change anything, and it cannot see other organizations' data. It does not know how to use the app; for that, open the ? button, whose how-to chat knows the app and not your data. Keep the two straight: Ask knows your land, Help knows the app.

## Tips

- Name the year when it matters ("2025 taxes").
- If it says it could not find something, check that the records exist (a lease with no land linked has no acres to count).
- It has an hourly limit per person to keep costs sane.

# Assets list  (page: /assets)

## What this page is for

Every well, pivot, bin, building, pond, fence, and pipe you have recorded, filterable by property and type, with a total estimated value. Tap a row to open the asset page, or Show on map to zoom to it.

## The asset page

Shared fields (name, property, year installed, condition, estimated value, notes) plus a form specific to the type: well depth and pump details, pivot make and wetted length, bin capacity and diameter, building construction and utilities, and so on. Pivots, risers, and pipes can link to their supply well. Photos and documents attach below. Deactivate keeps the history and takes the asset off the map; delete is permanent.

## Common questions

- **The bin diameter changed the circle on the map.** That is on purpose: a grain bin drawn as a circle uses the same diameter both places.
- **Where do I place it?** Assets are placed from the Map (pin, drawn outline, or circle). An asset created without a location says so and waits.

# Getting started  (page: /dashboard)

## What this app is for

Turnrow Landowner keeps the records of land you own and lease out: where the boundaries are, what is on the ground (timber, roads, wells, bins, easements), who leases it and what they owe, what the county charges in property taxes, the papers that prove it all, and the government program base acres tied to it. Everything you enter is private to your organization.

## Where to begin

- **Get your land on the map.** The fastest start is Import, then Import from county records: search by owner name, pick the parcels, and the boundaries arrive already drawn. If the county is not in the registry yet, upload a shapefile, KML, or GeoJSON, or draw boundaries by hand on the Map.
- **Group properties under the right owner.** If family land sits in an LLC, a trust, and your own name, create an entity for each under Properties then Entities and assign properties to them. Most pages can be filtered by entity.
- **Add what is on the ground.** Timber stands, roads, wells, pivots, bins, and easements are drawn or pinned from the Map's Add button.
- **Bring in the paperwork.** Leases, tax statements, deeds, surveys, and FSA-156EZ forms can be uploaded and read for you; you review what was read before it saves.

## The Dashboard

The Dashboard shows total acres, property count, ag field and timber acres, and counts of wells, pivots, bins, and buildings, with a satellite thumbnail that opens the map. When land sits in more than one entity, chips across the top scope the numbers to one entity. Alert cards flag things that need attention, such as tenant insurance about to expire or taxes coming due.

## Getting help

- **The ? button** in the top bar opens Help on every page: a guide to the page you are on, a search across all topics, a how-to chat that knows the app, and Contact support, which reaches a person.
- **Ask** (in the menu) is different: it answers questions about your own land and numbers from your records, such as "how many acres do I own in Lawrence County".

## Common questions

- **Can I use this on my phone?** Yes. The app is built for phones first. Add it to your home screen from the browser menu and it opens like an app.
- **Can someone else in the family log in?** Yes. An owner invites people by email under Settings then Members.
- **Is my data shared with my tenant?** No. The only connection runs the other way: a tenant can choose to share their field data with you.

# Documents  (page: /documents)

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

# Plotting a boundary from a deed  (page: /documents)

## Two kinds of descriptions

- **Aliquot parts**: "the NW quarter of the SE quarter of Section 12, Township 4 South, Range 8 West." The app finds that section on the public survey grid, subdivides it by quarters and halves, unions the parts, subtracts any "less and except" parts, and lands a boundary on the map directly.
- **Metes and bounds**: a starting point and a chain of calls, "thence N 45 degrees 30 minutes E 660 feet." The app reads the calls into a table you can correct, plots the shape, and you place it on the map.

## The steps

- **Read**: the description is extracted from the document and shown for review, amber where unsure. Fix tracts or calls in the table. Bearings that cannot be read are flagged red.
- **Resolve or plot**: aliquot tracts resolve against the survey grid. Before anything is fetched you see the reference as fields, not prose: the county the deed states, the principal meridian that county sits in, township number and N or S, range number and E or W, the section, and the aliquot parts as ordered chips (largest division first, each next chip a part of the one before). Fix a misread letter or digit there. After the lookup, two checks run: the resolved section must sit in the deed's county (a failure is a red flag with one-tap retries), and a section far from all your boundaries gets a distance warning. Metes and bounds calls plot into a shape with the **error of closure** shown up front: the gap between where the last call ends and the starting point, as feet and as a ratio. Green is 1:5,000 or better, amber down to 1:1,000, red worse. **Force close** spreads the gap across the courses and is labeled as an adjustment.
- **Place** (metes and bounds only): pin the point of beginning on the satellite map, drag it to fit, and nudge the rotation a fraction of a degree if the deed's basis of bearing differs from true north. The shape follows live.
- **Preview and save**: the plotted boundary overlays the current one with acres side by side (plotted, current, deeded). Save it as a new property or parcel, or replace an existing boundary after a confirmation that states the old acres. The document remembers which boundary it produced.

## Honest limitations

Plot quality follows description quality. Old deeds omit curves, mix units, or reference monuments that no longer exist. Aliquot math assumes regular sections; government lots along rivers and township lines are approximations. Closure is shown, never hidden. When the county's parcel map agrees with your records, Import from county records is faster and usually better. Nothing here replaces a licensed survey.

## Common questions

- **The shape is mirrored or spun.** Check bearing quadrants (N 45 E vs N 45 W) in the calls table, then use the rotation control for small differences.
- **Units?** Feet, chains (66 ft), poles or rods (16.5 ft), links, and meters are understood; pick the unit per call when the deed mixes them. Varas are not converted (the vara differs by state and era); convert those calls to feet first.

## Why did my plot land in the wrong place?

Almost always one of two things, and the app now guards against both.

- **The wrong survey (meridian).** Township and range numbers repeat across a state. Alabama has three main surveys: Huntsville for the Tennessee Valley and north Alabama, St. Stephens for the middle and south, Tallahassee for the southeast corner. "T4S R7W" exists under more than one of them, so the lookup must name the survey. The app takes it from the county the deed states; you can override it per tract. A lookup without a meridian is never made.
- **A flipped direction letter.** If the reader turns R7W into R7E (or T4S into T4N), a real section comes back hundreds of miles away. The county check catches this: the resolved section has to sit in the county the deed names. When it does not, you see "resolved to Baldwin County, deed says Lawrence" and one-tap retries for the likely fixes (flip the township letter, flip the range letter, try the other survey).

Two more aids: a section more than 25 miles from every boundary you already have shows a distance warning (new land is possible; a misread is likelier), and each resolved tract prints a diagnostic line ("Resolved: Huntsville PM (from Lawrence County), T4S R7W, Sec 31, BLM CadNSDI section layer, county check passed (Lawrence), 2.1 mi from River Place") that is also saved with the boundary, so a wrong plot can be traced later. For metes and bounds, the point-of-beginning pin shows the county it sits in beside the deed's county.

# Easements  (page: /easements)

## What counts as an easement

A recorded right someone else holds over your land, or one you hold over a neighbor's. Types are grouped into families: utility (powerline, pipeline, waterline or sewer, telecom or fiber), access and transport (private access, public road right of way, railroad), water (drainage, flowage for a reservoir), conservation (land trust or USDA conservation easements), and other (cemetery access, temporary construction, solar or wind, other). Severed mineral rights are not an easement and are not recorded here.

## Recording one

Draw it from the Map: + Add, Draw, Easement, then Line or Area. The save form asks the type, whether it **burdens** your land (the default) or **benefits** it (an access lane you hold across a neighbor, drawn outside your boundary on purpose), the holder, the recorded reference (book and page or instrument number), an expiration date (blank means permanent), notes, and depending on type: width for a line (informational only; draw an area if you want the strip), the flowage elevation, and the conservation program and its restrictions.

## On the map and in print

Families share a look: utility reds and oranges, access browns with a tie pattern for railroads, water blues with a stronger fill for flowage, a violet hatch for conservation, grays for the rest. The legend lists only the families on screen. Tapping an easement shows its exact type and every field; its page holds the recorded deed.

## Common questions

- **The easement crosses two properties.** Property is optional on easements; leave it blank or pick the main one.
- **Our own buried irrigation pipe?** That is an asset (Underground pipe), not an easement.
- **Where does the easement deed go?** Upload it on the easement's page, or in Documents with type Easement deed.

# Entities  (page: /entities)

## What an entity is

An entity is the legal owner of record: your own name, a family LLC, a trust, a corporation, a partnership, or an estate. Properties are assigned to entities so acres, income, taxes, and government payments can be viewed per owner.

## Where entities come from

- Create one here with a name and type.
- Import from county records creates or matches entities from the owner names on the parcels you import, and remembers how each county printed the name (an alias). The next search from that county shows a Known entity badge on matching records.

## The entity page

Shows the properties held, acres, a year's income and taxes, and documents such as operating agreements. A base acres and government payments card appears once FSA farms are linked to its properties.

## Common questions

- **Two entities are really the same owner.** Open one and use Merge into another entity; its properties, aliases, and documents move to the target.
- **Deleting an entity deletes my land?** No. Its properties stay and simply show no entity.

# Farm activity  (page: /farm-activity)

## What this page shows

Everything connected tenants have shared, by crop year, at three levels.

**The summary at the top** rolls the year up by entity (how your land is held) and by tenant (each farm connection). Each card shows the acres in crops, the crop mix (acres per crop, with a colored bar), harvest progress (acres harvested of acres planted), and, when the farmer shares them, a projected or actual yield per crop and their crop prices. A "No entity" card covers land not assigned to an entity. An organization with one entity and one tenant sees a single card instead of two sections.

**Tap a card** to drill in. The page narrows to that entity or tenant and lists its properties as rows with the same numbers. Tap a property to see its fields: the crop on each mapped field, varieties, planting date, whether it is harvested, and yield when shared. Breadcrumbs at the top step back up, and the filters follow along (drilling in sets the entity, connection, or property filter; clearing a filter returns to the summary).

The card totals are sums of the field rows beneath them, so they always agree.

The Map's Crops layer colors ag fields by the same data for the current year.

## Your tenant's farming entities

A farm often runs as several entities (a family corporation for one set of fields, an LLC for another). When your tenant's software shares which entity operates each field, the tenant's card breaks out per entity (acres, crop mix, harvest, and that entity's own prices) under the whole-operation totals, the field table gains an Entity column, and the map's field panel says who operates the field. A tenant with one entity shows nothing extra.

## Common questions

- **Yield or prices show "Not shared."** The farmer did not enable that scope; ask them or leave it. Acres and harvest progress always show, because plantings are always shared.
- **A field is missing.** Confirm its mapping under Farms then Mapping. Plantings on fields that are not mapped yet count toward the tenant's card but not toward any entity or property.
- **A tenant farms for two of my entities.** The tenant card rolls up across both; each entity card shows only its own land.

# Farm connections  (page: /farms)

## What a connection is

If your tenant uses Turnrow's farm software, they can share part of their records with you: which of their fields are on your land, what they planted, and, if they choose, yields and prices. You redeem a one-time share code they generate (TRW-XXXX-XXXX-XXXX). Nothing flows the other way.

## What the farmer controls

The farmer decides what to share (fields only, plantings, yields, projected prices and yields) and can end the share at any time. When they do, the connection shows as ended and the data already shared stays on your side.

## Mapping fields

After connecting, the app suggests which of the tenant's fields match your ag fields (by name and acres within ten percent). You confirm or ignore each suggestion; the app never confirms for you. Confirmed mappings power the Crops map layer, farm activity, and the tenant data panel on leases.

## Refreshing

Data refreshes on a schedule and with the Refresh now button. When the farm software is unreachable, the last synced data still shows with a note.

## Tenants come from the farm data

Your tenants are the farming entities behind the share. Each entity the farmer's software names becomes a tenant in Turnrow the first time the connection syncs (a share with no entities becomes one tenant for the whole operation); an existing tenant with the same name is linked rather than duplicated, and you can rename a tenant freely. Lease that tenant and the lease's Tenant Data panel scopes to that entity's fields and prices. Farm Data's by-tenant cards are those same entities. For a tenant that did not come from the farm data, the tenant page still lets you link one by hand (Turnrow suggests the entity when every field mapped on that tenant's leases belongs to one).

## Common questions

- **The code says already used.** Codes work once; ask the farmer for a new one.
- **Can I see their whole operation?** No. Only fields they marked as yours, and only the scopes they enabled.

# Government payments  (page: /gov-payments)

## What this page is for

Base acres tied to your land generate USDA program payments (PLC or ARC-CO) every year, paid to whoever farms it. This page records the FSA farms on your land, their base acres and yields by commodity, the program election, and projects what those acres are expected to pay, so you understand what your land is worth in the program and can negotiate leases with open eyes.

## Setting it up

- **FSA farms**: add a farm by its FSA farm number, county, and farmland and cropland acres, and link it to one or more properties (with a split percentage when one farm spans properties). Scanning an FSA-156EZ in Documents creates or updates all of this for you after your review.
- **Base acres**: per commodity, base acres and the PLC yield.
- **Election**: PLC or ARC-CO per commodity per program year (PLC when nothing is recorded).

## How the estimate works, in plain language

- **PLC** pays when the season's average price falls below the commodity's effective reference price. The payment is that gap times the PLC yield times base acres, then reduced by the 85 percent payment factor and sequestration.
- **ARC-CO** pays when county revenue (county yield times price) falls below 90 percent of the county's benchmark revenue, capped at 12 percent of the benchmark, then reduced the same way.
- Prices come from USDA's monthly prices received, blended the way USDA weights a marketing year. County benchmarks come from FSA's published workbook. Program parameters (reference prices, loan rates, factors) are kept current by the platform.
- **Program year vs payment year**: the program year is the crop year; FSA pays it in October of the following year. Toggle between the two framings; the same money stays on screen.

These are estimates. FSA determines actual payments after the marketing year closes.

## Leases and income

Each crop share or flex lease states its treatment plainly on this page and on the lease page: you receive a share (with the percent and whether FSA or the tenant pays it) or the tenant keeps all. The line "base acres on this land generate about $X per year to your tenant" shows only when every lease leaves the payments with the tenant.


Crop share and flex leases carry a **Government payment share percent**. When it is above zero, your share flows into Income as a Government payments line in the payment year. At zero, Income is unchanged and this page still shows "base acres on this land generate approximately this much per year to your tenant."

## Common questions

- **Payment limits?** Not modeled here; those apply to the person receiving the payment.
- **A price is blank.** USDA has not published enough months yet; the panel says what is missing.

# Help and support  (page: /help)

## The ? button

On every page, the ? button opens Help with four tabs: **This page** (the guide for where you are), **All topics** (search), **How-to chat** (an assistant that knows the app from these guides and nothing about your data), and **Contact support** (a message to a person, with your email, organization, and page attached automatically, plus an optional screenshot). Support replies to your email.

## The Help Center

This page lists every topic grouped like the menu, with search across titles, keywords, and content.

## Ask vs Help

**Ask** (in the menu) answers from your records. **Help** answers about the app. If the how-to chat cannot answer, it will say so and point you to Contact support.

# Import files  (page: /import)

## What it does

Upload boundary files you already have: a zipped shapefile from a surveyor, a KML or KMZ from Google Earth, or GeoJSON. Each feature in the file is previewed, you say what it is, and it saves.

## How to use it

- Drop the file in. Polygons can become a property, parcel, ag field, pasture/grassland, wetland, timber stand, or easement; lines become roads, pipes, fences, or line easements; points become assets with a type.
- Each row suggests the property that contains it (a "Suggested from location" chip). Confirm or change it. Properties in the same batch save first so other rows can attach to them.
- Rows that fail are skipped and listed so you can fix and retry them.

## Common questions

- **The file is in the wrong place on the map.** Some files carry a projection the app converts automatically (Web Mercator). If shapes land far away, export the file again in WGS84 (latitude and longitude).
- **Can I import a spreadsheet of acres?** Not here; this page needs shapes. Leases and taxes accept their own documents.

# Import from county records  (page: /import/county)

## What it does

Search a county's public parcel map by owner name or parcel number, preview the parcels on satellite, pick the ones that are yours, and import them with their boundaries, parcel numbers, and deeded acres already filled in. It is the fastest way to get land on the map.

## How to use it

- Pick the county. Only counties in the registry appear; the registry grows as counties are verified.
- Search by owner (try the name as the county prints it, last name first) or by parcel number in any format; separators like dots and dashes do not matter.
- Results group by owner name. Check the parcels you want, choose whether they form a new property or join an existing one, and confirm the owner entity (a Known entity badge means the name was imported before).
- Import. Parcels arrive with boundaries and deeded acres; the property boundary can be set from its parcels in one click afterward.

## Common questions

- **My county is not listed.** Upload a file instead (see Import files), draw by hand, or plot from a deed in Documents. Ask support to add the county; each one is verified live before it appears.
- **Acres show as blank.** Some counties publish no deeded acres; map acres are computed from the shape regardless.
- **Duplicate parcels?** Re-importing the same parcel number into the same property is blocked; importing into another property is allowed so you can fix mistakes.

# Income views  (page: /income)

## What this page shows

A year at a time: expected and received income by type (agricultural rent, hunting, timber, government payments), property taxes due and paid, gross, and net. A second table breaks the same year down by entity and property. Earlier years are a tap away, with a small chart across years.

## Projected vs received

- **Expected** comes from generated payment schedules where they exist, otherwise from each lease's terms and year assumptions. A banner notes when part of the year is a projection.
- **Received** is what you recorded: lease payments by date received, timber settlements, and government payments.
- Amounts split across properties by leased acres for leases and by linked stand acres for timber. Land with no link shows as unassigned so it is never hidden.

## Rent upload

Photograph or upload a rent check or a tenant's settlement sheet. The app reads payer, date, amount, check number, and memo, suggests the lease from the payer, and you confirm before it is recorded. A logger's settlement lands in the timber flow instead.

## Common questions

- **Why is a lease missing from this year?** Expired or terminated leases do not project. Record any late payment directly on the lease.
- **Government payments show as a line but also as a note.** The line is your share under leases that set a share percent. The note is the informational estimate of what the base acres generate for the tenant when your share is zero.

# Leases  (page: /leases)

## Tenants and leases

A **tenant** is the person or operation that rents from you, with contact details and insurance on file. When a farm connection is in place, tenants come from the farm data: each farming entity the farmer shares is a tenant (marked "farm data" in the lease's tenant list), and a lease with that tenant scopes its Tenant Data panel to that entity's fields and prices. A **lease** belongs to a tenant and covers land you pick (whole properties or specific ag fields) with editable leased acres, since contract acres often differ from map acres.

Agricultural leases are **cash** (per acre or lump sum), **flex** (a base rate plus a bonus), or **crop share** (your share of the crop less any shared expenses). Hunting leases are a flat amount or per acre, with an insurance reminder.

## Uploading a lease

Upload the signed lease as a PDF and the app reads the type, dates, acres, rent structure, payment schedule, and special provisions, and suggests a price method from the pricing clause. Fields it was unsure about are highlighted amber. Nothing saves until you review and confirm.

## Government payments on share and flex leases

Crop share and flex leases ask one required question: does the landowner receive a share of government payments (ARC and PLC on the leased base acres), or does the tenant retain them all? If you receive a share, the percent prefills from your crop share and you say how it arrives: FSA pays you directly (you are a party on the farm record) or the tenant remits your share. A tenant-remitted share becomes an expected payment due each October of the following year, so a tenant check can be matched to it in Rent upload. An FSA-direct share is projected as income but is never expected in a tenant check. When you upload a lease, the reader looks for the government payment clause and proposes the answer in amber for you to confirm.

## Payments

Each lease can carry a **payment schedule** (one to four installments with dates and shares). Generate expected payments for a year and record checks against them; status (upcoming, due soon, past due, paid, partial) is worked out from what you record. Unscheduled receipts can be recorded too. Regenerating a year never touches an installment that already has a payment on it. Rent checks can also be photographed on the Income page and matched to the right lease.

## Common questions

- **The lease covers land on two properties.** Link both properties, each with its leased acres; income splits by those acres.
- **The tenant switched from cash to crop share.** End the old lease and create a new one; history stays intact.
- **Where do government payments fit?** Crop share and flex terms have a Government payment share percent. See the Government payments topic.

# Lease price methods and projections  (page: /leases)

## Why a price matters

Crop share and flex rent depend on a crop price. Each lease records **how** its price is established, and the app fills each year's price assumption from that source. The filled value is amber until you save it; nothing is saved for you.

## The methods

- **Manual**: you type the price.
- **Tenant average**: the tenant's farm software shares their projected or final average price for the crop (only if they turned that sharing on).
- **RMA benchmark**: the public USDA crop insurance projected or harvest price for the crop and state, or their average. No connection needed.
- **Custom recipe**: a formula the app designs from the lease's pricing clause (for example the average of two elevator quotes less a basis), computed the same way every year.

## Year assumptions

For each year, a crop share lease holds one entry per crop grown on the leased ground: crop, acres, expected yield, expected price, and shared expenses. Two crops on the same ground (wheat then soybeans) are two entries. Projected rent sums them. An incomplete entry keeps the year marked incomplete rather than guessing.

## The tenant data panel

When a tenant is connected and has mapped fields to this lease's land, a panel shows what they planted on it this year, projected or actual yield, and projected or final price, with Use buttons that fill the assumptions amber for your review.

## Common questions

- **The RMA price is blank.** Price discovery for that crop and state has not started yet; the card says when it opens.
- **The tenant's price is for a different crop.** Prices match crops strictly; a mismatched crop shows under its own row and never fills another crop's price.

# Maintenance issues  (page: /maintenance)

## What this page is for

A lightweight to-do list for the land. Every problem you mark on the map (a bad wash, a sinkhole, a broken terrace, a road washout, or anything else with its own label) shows here until you mark it resolved, grouped by property and then by ag field.

## Adding an issue

On the Map, tap **+ Add**, then **Draw**, then **Maintenance issue** at the bottom of the picker. Pick the type, then how to mark it: a **Pin** for a spot (a sinkhole), a **Line** for something that runs along the ground (a failed terrace section), or an **Area** you trace (a wash, a washout). The save form takes an optional label, notes, and a severity (low, medium, high); "Other" needs a label. The property fills in from where you drew.

Issues are their own layer in warning colors (amber, red when high severity) so they read as problems, never as land. The Layers box has a separate **Maintenance issues** toggle, so you can hide them while working on boundaries and bring them back later.

## Marking resolved

Tap the issue on the map and press **Mark resolved**, or press the button beside it on this page. Resolved issues turn gray on the map and move under Resolved here; **Reopen** brings one back.

## Common questions

- **Does an issue belong to a field?** When it lands inside an ag field the list groups it under that field; otherwise it sits directly under the property.
- **Do issues print?** Yes. The map PDF draws them in their warning colors with their own legend rows and lists the open ones in the frame beside the legend.
- **Who can see them?** Everyone in your organization, like the rest of the map.

# The map  (page: /map)

## What this page is for

The Map is the home page: your properties on satellite imagery with every boundary and feature you have recorded. Tap anything to open its panel, edit its details, or jump to its full page.

## Layers and legend

The Layers box (top left) turns each kind of thing on or off: properties, parcels, ag fields, pastures/grassland, wetlands, timber, cemeteries, roads, easements, and assets. Below a rule sits a separate **Maintenance issues** toggle: problems you have marked (washes, sinkholes, broken terraces, road washouts) live on their own layer in warning colors and can be hidden without touching the land view. Your choices are remembered on this device. Parcels start off because they clutter the view; property names always show.

- **Cemeteries** are a muted violet: a traced plot, or a "C" marker for a single pin.

- **Timber types** get their own legend when stands are on screen (planted pine, natural pine, hardwood, mixed, other).
- **Easements** show a legend by family: utility, access and transport, drainage and flowage, conservation, and other. Railroads get a tie pattern, conservation easements a hatch.
- **Crops** appears when a connected tenant has shared plantings; it recolors ag fields by this year's crop.
- **By entity** appears when land sits in more than one entity; it recolors property outlines by owner.
- **Maintenance issues** are amber, red when marked high severity, and gray once resolved; a pin shows an exclamation mark. See the Maintenance issues topic.

## Tapping things

Tapping a feature opens a panel (a card on desktop, a sheet on phones) with its acres or length, property, details, notes, and buttons: Edit details, Edit boundary or line, Move pin, and the feature's special tools (Split for a timber stand, Edit coverage for a pivot, Edit circle for a round footprint). View full page opens its summary page with documents. A maintenance issue's panel adds **Mark resolved** (or **Reopen**). Where things overlap, maintenance issues and assets win, then roads, easements, ag fields, pastures/grassland, cemeteries, wetlands, timber, parcels, and properties.

## Other controls

- **Zoom all** fits everything you own on screen.
- **Fullscreen** hides the app frame; on a phone the panels stay usable.
- **Print** (top right) makes a PDF of the framed area. See the Printing topic.
- **+ Add** starts drawing or placing. See the Drawing and Assets topics.

## Common questions

- **Why do my acres differ from the deed?** Map acres are computed from the drawn shape. County records often carry deeded acres that differ slightly; parcels show both.
- **A label is hiding something.** Turn that layer off in Layers while you work, then turn it back on.
- **Can I see last year's crop?** The Crops layer shows the current year only; the Farm Data page shows history.

# Drawing boundaries, roads, and easements  (page: /map)

## Pick first, then draw

Tap **+ Add** then **Draw**. A picker asks what you are drawing: Property boundary, Parcel, Ag field, Timber stand, Pasture/Grassland, Wetland, Cemetery (then Draw the plot or Drop a pin), Road, Easement (then Line or Area), Fence, or Underground pipe, and at the bottom, under Needs attention, a Maintenance issue. Once you pick, the right tool loads, the shape you draw shows in that type's color, and the save form already knows what it is, with its extra fields visible from the start (stand type and species for timber, easement type and holder for easements). The type stays fixed for that session; to draw something else, finish or cancel and start again.

## Drawing a shape

- Tap the map to place points. Double tap the last point to finish.
- **Discard shape** (or the Escape key) removes only the shape you are tracing. Finished areas and everything typed in the form stay.
- **Cancel** ends the whole session. If finished areas exist it asks first, so a mistap never throws away minutes of tracing.
- Save fills in the property from where you drew (a "Suggested from location" chip). Change it if the guess is wrong.

## Several areas in one record

After the first area is finished, the save form offers **+ Add area** and **Cut area out**. Add draws another polygon that merges in (areas do not need to touch). Cut draws a hole (a pond, a house lot). The form stays as you left it while you draw more.

## Cemeteries

A family or church plot is usually small. Trace its edge when you know it (the plot shows acres like any land type) or drop a single pin on the marker. Either way it gets its own violet look and a "C" marker so it stays findable when zoomed out.

## Maintenance issues

Problems that need fixing are not land, so they have their own layer. Pick **Maintenance issue**, then the type (wash, sinkhole, broken terrace, road washout, or other with a label), then how to mark it: a **Pin** for a spot, a **Line** along a terrace or ditch, or an **Area** you trace. Give it a severity if you like. Issues draw in amber (red for high severity) and gray once resolved; tap one and press **Mark resolved**, or work the list on the Maintenance page. The Layers box hides or shows them separately from everything else.

## Editing later

Tap a feature and choose **Edit boundary** or **Edit line**. Drag the points, or use **Add area** and **Cut area** on the toolbar for bigger changes, then Save. Timber stands also offer **Split**: draw a line across the stand and it becomes two stands with the details copied.

## Common questions

- **Line or area for an easement?** A line when you know the centerline (a powerline, an access lane); it shows length, and width is a note. An area when you know the strip, the flowage pool, or the conservation tract; it shows acres.
- **Where did Pipe and Fence go?** They are in the Draw picker. Your own buried irrigation pipe is an asset; a pipeline company's corridor is an easement.
- **The wrong type is selected.** Cancel the session and pick again. The type cannot change mid-session on purpose.

# Assets on the map  (page: /map)

## Placing an asset

Tap **+ Add** then **Asset**. Pick the type (well, shop, barn, grain bin, house, pond or dam, and so on) and how to place it:

- **Pin**: a crosshair sits over the map. Pan the map under it or drag the crosshair itself, or tap My location to use the phone's GPS, then press Place here.
- **Draw outline**: trace the footprint (a shop, a barn, a pond surface). The panel then shows the footprint in square feet, or acres when it is large.
- **Circle**: for round structures. Place the center with the crosshair, then set the diameter by typing it or dragging the blue rim handle; the white handle moves the center. Grain bins start on Circle, and the diameter is the bin's diameter on its asset page. Type a new diameter on either side and the other updates.

Only a name is required. Specs, photos, and documents are added on the asset page afterward.

## Irrigation pivots

Tap **+ Add** then **Irrigation pivot**. Place the center, and the coverage editor opens: drag the blue handle or type the wetted length in feet, choose Full or Partial circle (green and red handles set the arc), then Save. The coverage circle drives irrigated acres on the ag fields it covers. **+ Add area** draws extra irrigated ground that joins the coverage (a corner arm lobe, end gun reach); **+ Cut area** removes ground that is watered but not plantable (a pond, a waterway). The panel shows plantable acres, and gross watered acres when they differ.

## Editing

Pins: tap the asset, then Move pin. Footprints: Edit outline. Circles: Edit circle (it reopens the center and diameter editor; circles are never vertex-edited). Pivots: Edit coverage.

## Common questions

- **Can a pond be a circle?** Yes. Circle is offered for every type; it just leads for grain bins.
- **Where is the letter on the marker from?** Each type has a letter (W well, B bin, P pivot, S shop). Footprints and circles keep the letter at their center so they read from far out.
- **Deactivate or delete?** Deactivate keeps the history and takes the asset off the map. Delete is permanent.

# Printing a map PDF  (page: /map)

## Making a printed map

Tap **Print** at the top right of the map. A page-shaped frame appears; pan and zoom until the frame holds exactly what you want printed. The frame is the printed area.

## The setup panel

- **Title and subtitle**: the title defaults to the property name when one property fills the view, otherwise your organization name; the subtitle defaults to today's date.
- **Orientation**: landscape or portrait.
- **Layers and labels**: each layer has its own checkbox for the print, prefilled from the live map, plus a label toggle. Parcel numbers start off in print.
- **Crops** and **By entity** recoloring carry into the print when checked.

## Hiding single items

While the frame is up, tap any item on the map to leave it out of the print. It turns ghosted; tap it again to bring it back. A counter on the frame shows how many are hidden and clears them all in one tap. The panel adds property chips when several properties are in frame and a **Choose items** list with a filter box. Hidden items are gone from the PDF, its labels, and its legend. Nothing about hiding is saved; the next print starts fresh.

## Generate

Generate renders the framed area at print resolution and downloads a Letter PDF with the map, title, a legend of only the layers you checked, a scale bar, a north arrow, and the Turnrow mark. On a phone, open the PDF and print or share from there.

## Common questions

- **Why is the legend short?** It lists only layers that are checked and present in the frame.
- **Can I print more than one page?** Each print is one page. Frame a second area and generate again.

# Properties, parcels, and entities  (page: /properties)

## Properties and parcels

A **property** is a piece of land you think of as one place (the home place, the river farm). Each has a boundary, county and state, optional FSA farm numbers, and notes. **Parcels** are the county's tax parcels inside it, each with a parcel number, its own boundary, and deeded acres when the county supplied them. Tax statements match to parcels, so keeping parcel numbers accurate pays off at tax time.

The Properties page lists every property with acres and counts. Each property page shows its map, details, and sections for parcels, ag fields, pastures/grassland, wetlands, timber stands, roads, easements, assets, leases, taxes, documents, and government program base acres.

## Entities

Under Properties then **Entities**, create the owners of record: an individual, LLC, corporation, partnership, trust, or estate. Assign each property to its entity on the property page. Entity pages roll up acres, income, and documents (operating agreements, formation papers). Land held in your own name does not need an entity. Dashboard, Income, and Government Payments can be filtered by entity.

## Moving things between properties

Every parcel, ag field, pasture/grassland, wetland, timber stand, road, and asset has a **Move to another property** control on its page. Use it when two properties should become one, or when an import put something on the wrong place. Properties with nothing left on them can be deleted.

## Acres

- **Map acres** are computed from the drawn boundary and shown to one decimal. They change whenever the shape changes.
- **Deeded acres** come from the county record and are shown beside map acres on parcels.
- **Irrigated acres** on an ag field are the part covered by pivot coverage circles; the rest is dryland.

## Common questions

- **A property's boundary is missing.** On the property page, Set boundary from parcels unions its parcels into one outline; or draw it on the map; or plot it from a deed in Documents.
- **Can one property belong to two entities?** No. Split it into two properties if ownership is split.
- **What are FSA numbers for?** They tie the property to USDA farm records and show on the map panel and the property page. Government Payments has its own FSA farm records with base acres.

# Settings  (page: /settings)

## Members

Owners invite people by email and set their role. **Owner** can invite and manage members; **member** can do everything else. Invites show until accepted. Sign out is at the bottom.

## Admin sections

Platform administrators see extra sections: the county GIS registry (the public parcel services behind Import from county records, each verified live) and program parameters for government payment estimates (reference prices, loan rates, factors by program year). Regular users do not see these.

## Common questions

- **Change my name?** Your display name is editable on this page.
- **Remove someone?** Owners can remove a member; their past uploads stay attributed.

# Property taxes  (page: /taxes)

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

# Timber stands  (page: /timber)

## What a stand is

A timber stand is an area managed as one unit: planted pine of one age, a hardwood bottom, a mixed block. Each has a type (planted pine, natural pine, hardwood, mixed, other), species, year established, site index, last thinning and burn years, notes, and a boundary. The Timber page lists stands by property with acres by type.

## Adding stands

- On the Map: + Add, Draw, Timber stand. The save form asks the stand type (required) and prefills Loblolly pine for pine picks.
- From Timber Scan: let the app propose stands from satellite and crop data, then accept the ones that look right (see Timber Scan).
- From a file: shapefile or KML through Import.

## Working with stands

- **Split**: from the map panel, draw a line across a stand to cut it into two with the details copied; useful after a partial harvest.
- **Colors**: planted pine deep teal, natural pine olive, hardwood burnt orange, mixed violet, other gray, with a legend on the map.
- **Sales**: a stand page shows the sales it is part of and the timber income allocated to it.
- **Forested wetlands** stay timber stands (hardwood with a note); the Wetland type is for open marsh and sloughs.

## Common questions

- **Last thinning year is wrong.** Edit it on the stand page, or let a thinning sale offer to update it when the sale is marked complete.
- **Two stands should be one.** Edit the boundary of one with Add area to cover the other, then delete the spare.

# Timber sales and settlements  (page: /timber-sales)

## Recording a sale

Create a sale with the buyer, contract date, harvest deadline, deposit, acres, and whether it is **lump sum** (one price, optional split payments) or **pay as cut** (stumpage rates per product). Products cover pine sawtimber, chip-n-saw, pulpwood, hardwood sawtimber and pulpwood, poles, veneer, crossties, and chips, priced per ton or per thousand board feet with a log scale. A delivered-price arrangement (mill price less cut and haul) is pay as cut with net rates and the Delivered net flag. Link the stands being cut.

You can also **upload the contract**: the app reads it, suggests the terms and the matching stands, and you review everything before it saves.

## Settlements

Each logger check is a settlement: date, period, lines by product (tons or MBF, rate, amount), check number, and load count. Upload the settlement as a PDF, photo, or the logger's spreadsheet and the app reads it; spreadsheets collapse load-by-load rows into product totals. Rates that do not match the contract are flagged, not blocked. Settlements count directly as timber income.

## Allocation across stands

Income is spread across the linked stands **by acres** (default), by **manual** percentages you set, or **not at all**. A settlement can override the sale's method. The allocated amounts show on each stand page.

## Common questions

- **The check covers two sales.** Record two settlements, one per sale, splitting the lines.
- **We were paid before cutting started.** Record it as a payment against a lump sum schedule, or as a settlement with a note.
- **Marking a thinning complete:** the sale offers to update last thinning year on its stands.

# Timber Scan  (page: /timber-scan)

## What it does

Timber Scan looks at a property with public land-cover data and proposes draft timber stands: where forest is, roughly what kind, and how many acres. You review each proposal, adjust the edges if needed, and accept the ones that are right. Nothing saves until you accept.

## How to use it

- Open a property page and tap Timber Scan.
- Proposals draw in light dashed colors so they never look like saved stands. Tap one to see its suggested type and acres.
- Accept, edit the boundary first, or dismiss. Accepted proposals become real stands with the type you confirm.

## Good to know

- The data behind it is a satellite classification at roughly 30 meter resolution. Edges are approximate and small openings disappear. Treat it as a head start, not a cruise.
- Scans are clipped to the property boundary, so draw or import the boundary first.

## Common questions

- **It missed a young plantation.** Recently planted ground often classifies as open land. Draw that stand by hand.
- **Can I rerun it?** Yes. Previous accepted stands stay; new proposals appear only where no stand exists.
