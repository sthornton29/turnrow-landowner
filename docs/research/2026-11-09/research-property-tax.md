# Property Tax Report: Research and Proposal

Prepared 2026-11-09 for Turnrow Land. Research only: no app code and no database writes.

---

## 1. Executive summary

North Alabama farm and timber land is taxed very lightly, and that is exactly why the biggest dollars are in **whether each parcel is actually getting the lightly taxed treatment it qualifies for**, not in shaving a few percent off an appraisal. Under Alabama's current use program, the best cropland is valued at **$532 an acre** and the best timberland at **$827 an acre** (the cropland number has not changed since 1982). With rural Lawrence and Colbert at about **30 mills**, that works out to roughly **$1.00 to $2.60 an acre** in tax. The same land taxed at market value (about $5,300 an acre for cropland and $2,000 for timber in 2025 Alabama sales) would owe about **$6 to $16 an acre**. So one cropland parcel that has quietly dropped out of current use can cost more than a whole property's correctly assessed bill. The report should open with a one-screen bottom line: what you paid, what changed and why, tax per acre, and tax as a share of land income. Next comes a short, ranked list of "Things worth a look", each with a dollar figure and a deadline. Drill-down tables and a printable PDF for the accountant or a Board of Equalization protest come after that. Most of these checks can run on data the app already has, especially the county GIS attributes stored on parcels (land value, timber acres, assessed value, tax district). Three cheap additions unlock the rest: small reference tables for current use values and millage, a yearly snapshot of the GIS values, and a richer statement-extraction schema.

---

## 2. What the app has today, and what the data really supports

**Today's report** (lib/taxChange.ts, components/taxes/TaxChangeReport.tsx, taxReportPdf.ts) compares two years by parcel. It shows tax and appraised-value changes, splits each change into an "appraisal effect" and a "rate effect", and flags assessment-ratio shifts, exemption changes, appraisal spikes over 15%, and parcels that appear or disappear. The Taxes page adds coverage tiles (parcels on a statement, due, paid, outstanding) and an entity rollup.

**Data profile (live DB, from the coordinator), with the source tag used in the rest of this document:**

| Tag | Source | What is reliable |
|---|---|---|
| **[S]** | tax_statement_lines (330 rows, 2021 to 2025, 4 rows 2026) | tax_due 330/330, appraised_value 323, legal_description 304, matched to a parcel 283 (47 unmatched). Thin: assessed_value 87, exemptions 9, acres 5, property_address 16. No class, no market vs current-use split, no millage. |
| **[H]** | tax_statements header + tax_payments (99 statements, 96 payments) | county, account_number, entity_id, amount_due, due_date, reconciled, payments by date |
| **[G]** | parcels.attributes (county GIS snapshot, 83 parcels) | Lawrence KCS layer example: TTV (total taxable value, looks like current use value), TAV (assessed, about 10% of TTV), CLandValue, CImpValue, TimberAcres, CALC_ACRE, DeededAcres, TaxDist, Neighborhood, FCODE, TotalTaxDue, TaxYearDue, Owner, MailAdd, DeedBook/Page. **Current snapshot only, no history.** Field names differ by county. |
| **[P]** | parcels.acres (GIS computed), parcels.deeded_acres, properties.entity_id | acreage and ownership chain |
| **[L]** | timber_stands, fields, pastures, lease_lands, fsa_farms (cropland_acres) | the owner's own land-cover picture |
| **[I]** | payments, leases, timber_sales, gov payments via lib/income.ts (allocateToProperties) | income by property and year |
| **[R]** | **new** reference tables (not in the app yet): ADOR current use values, county millage by district | public data, a few dozen rows a year |

**A worked check that proves the "expected bill" idea works.** The sample Lawrence parcel shows TAV $9,700, TimberAcres 9, and TotalTaxDue $291.90. Rural Lawrence millage for 2025 is 30 mills (state 6.5 + county 13.5 + school 10). $9,700 × 0.030 = $291.00, and the statewide timberland acreage tax of $0.10 × 9 acres = $0.90, for a total of **$291.90, exactly the bill.** So the report can recompute each bill from public rates and flag any that do not tie out.

**Two corrections the redesign should make to the current math:**

1. **A 10% assessment ratio does not mean current use.** Class III (10%) covers farm, forest, and owner-occupied homes whether they are valued at current use or at market value. The current flag text ("10% (Class III, current use)") overstates this. The reliable current use test is **land value per acre**: current use land cannot exceed about $532 an acre (crop or pasture) or $827 an acre (timber) before improvements, while market value is several times higher. A 10% to 20% move still means a class change, for example to Class II.
2. **The "rate effect" now hides the 7% cap.** Since tax year 2025, Alabama caps the yearly rise in taxable assessed value at 7% for most Class II and III real property. The current split (tax ÷ appraised) puts the cap, exemption changes, the timber acreage tax, and real millage changes all into one "rate" bucket. Where assessed value is known, the split should be four parts: millage change, taxable value change (including the cap), exemption change, and flat per-acre or per-dwelling fees.

---

## 3. Ranked report sections

Effort: **S** = days, **M** = about a week, **L** = multi-week or needs new data collection.

### 1. Bottom line (the first screen) [S, H, I, G, P]
- **Shows:** For the selected scope (all, entity, property) and year: total billed, paid, and outstanding; the change from last year in dollars and percent, with a one-sentence reason ("up $412, mostly from higher values on three Colbert parcels"); tax per acre; tax as a percent of land income; the number of findings and the dollars at stake; and the next deadline with its date.
- **Why:** Plain-language reporting guidance puts the conclusion first because most readers scan and stop early ([NN/g inverted pyramid](https://www.nngroup.com/articles/inverted-pyramid/?so=1)). Owners can only judge a tax number against something, such as acres or income.
- **Data:** tax_statements.amount_due [H], tax_payments [H], line tax_due [S], parcels.acres / deeded_acres [P], lib/income.ts allocateToProperties [I].
- **Have it?** Yes, all of it. The income rollup already exists.
- **Effort:** S.

### 2. Things worth a look (the findings list) [all sources]
- **Shows:** A ranked list of the automated checks from section 4. Each entry gives a one-line headline, the parcel and property, the dollars at stake per year, a deadline, "what to do" in one sentence, and a "show me" link to the evidence. Findings are sorted by dollars, and anything with a deadline inside 60 days goes on top.
- **Why:** This is the core of what appeal services and commercial tax software sell: deadline tracking, assessment review, and flagged bills ([Avalara Property Tax](https://www.avalara.com/us/en/products/property-tax/videos/video-avalara-property-tax-for-enterprise.html), [CSC AppealTrack](https://www.cscglobal.com/service/corporate-tax-services/property-tax/appealtrack/), [Itamlink](https://tax.com/property-tax/itamlink/)).
- **Data:** See section 4.
- **Have it?** About two thirds of the checks run on today's data. The rest need [R] tables.
- **Effort:** M for the framework plus the first ten checks.

### 3. Current use check (biggest dollar lever) [G, L, R, S]
- **Shows:** Per parcel: land value per acre (CLandValue ÷ acres), compared against the ADOR current use ceiling for that land type. Each parcel gets a status of "Looks like current use", "Looks like market value", or "Can't tell", plus an estimate of what current use would save each year. It also lists ag or timber acres the owner tracks (stands, fields, pastures, FSA cropland) on parcels that look market-valued.
- **Why:** Current use values (crop and pasture $110 to $532 an acre, timber $360 to $827) sit far below market. You must apply between Oct 1 and Jan 1. The benefit is lost on a sale unless the new owner applies, and new owners often miss this ([ADOR current use](https://www.revenue.alabama.gov/property-tax/current-use/), [CU-2025 directive](https://revenue.alabama.gov/wp-content/uploads/2025/01/CU-2025rev.pdf)). Entity transfers, LLC reorganizations, and inherited land are the classic way this lapses.
- **Data:** CLandValue, CImpValue, CALC_ACRE, TimberAcres, TTV [G]; timber_stands / fields / pastures acres [L]; current use value table and millage [R]; appraised_value history [S].
- **Have it?** Mostly. The GIS land value and acres exist (Lawrence verified). The CU table is about 30 numbers a year from ADOR. There is no `current_use` flag column, so the status is inferred. A confirmed status per parcel, set by the owner or read from the county, would be a small new column.
- **Effort:** M.

### 4. What changed and why (improved year-over-year) [S, G, R]
- **Shows:** A tax bridge from last year's total to this year's: value changes, the 7% cap holding values down, millage changes, exemption changes, parcels added or dropped, and flat fees. Under it, the parcels with the biggest changes, each with its plain sentence (the existing `decompositionSentence`, extended).
- **Why:** Alabama taxes rise only through values (annual reappraisal of a quarter of the county, with a full four-year cycle) or voted millage ([ADOR real property FAQ](https://www.revenue.alabama.gov/faq-categories/real-property)). The owner needs to know which one caused the change before deciding whether to protest (values) or nothing can be done (votes).
- **Data:** appraised and assessed by year [S]; the millage table [R]; the cap rule.
- **Have it?** Partly. Appraised values are good. Assessed is thin (87 of 330), so a four-way split is only possible on some lines until re-extraction (section 7).
- **Effort:** M.

### 5. Tax per acre benchmarks [S, P, G, R]
- **Shows:** Tax per acre by parcel, property, entity, and county over time, next to the "expected" range for current use land in that district. Example for 30-mill Lawrence/Colbert rural land: cropland $0.33 to $1.60 an acre, timber $1.18 to $2.58 an acre including the 10 cent timber tax. Outliers are highlighted.
- **Why:** Per-acre tax is how farm and timber owners compare land. A Georgia study put Alabama's average enrolled timberland tax near $2.00 an acre and non-enrolled timberland at $10 to $15 or more ([Georgia Forestry, 2017](https://digital-editions.todaymediacustom.com/georgia-forestry/fall-2017/files/basic-html/page27.html)). Midwest extension tracks farmland tax per owned acre the same way ([farmdoc daily](https://farmdocdaily.illinois.edu/wp-content/uploads/2025/10/fdd102125.pdf)).
- **Data:** tax_due [S]; acres (deeded_acres, then CALC_ACRE, then GIS acres) [P][G]; millage and CU tables [R].
- **Have it?** Yes for actuals. The expected range needs [R].
- **Effort:** S for actuals, plus S once [R] exists.

### 6. Tax versus income [S, I]
- **Shows:** For each property and year, tax as a percent of land income (rent, hunting lease, timber, gov payments) and tax per acre against rent per acre. Timber income is lumpy, so also show a 5-year average.
- **Why:** This is the landlord's carrying-cost view. Example: Alabama Extension's 2025 non-irrigated cropland rent is $105 an acre in Lawrence and $104 in Colbert, and correctly assessed current use tax is under $2 an acre, so about 1.5% of rent ([ACES ANR-2745, 2025 cash rents](https://www.aces.edu/wp-content/uploads/2025/08/ANR-2745_AlabamaCashRentalRates2025_020226L-G.pdf)). A property where tax is 10% or more of rent is either market-valued or under-rented.
- **Data:** allocateByLines [S/H], allocateToProperties [I].
- **Have it?** Yes.
- **Effort:** S.

### 7. Acreage reconciliation [P, G, S, L]
- **Shows:** One row per parcel with deeded acres, county calculated acres (CALC_ACRE), app GIS acres, statement acres, county TimberAcres against the app's timber stand acres, and the gap. Large gaps are flagged.
- **Why:** Tax roll, deed, and GIS acreage often disagree. Assessors also deduct roads and easements, or include a neighbor's sliver ([UNC School of Government](https://deathandtaxes.sog.unc.edu/?p=1072), [MapWV acreage note](https://mapwv.gov:443/parcel/docs/Acreage.pdf)). Being billed for acres you don't own is a straightforward correction. A wrong timber or crop acreage split changes the current use value.
- **Data:** deeded_acres, acres [P]; CALC_ACRE, DeededAcres, TimberAcres [G]; timber_stands, fields, pastures [L].
- **Have it?** Yes (statement acres are mostly empty, but GIS covers it).
- **Effort:** S.

### 8. Billing hygiene and coverage [H, S, G]
- **Shows:** Parcels with no bill this year, unmatched statement lines (47 today), duplicate billing (the same land on two accounts), statements that do not reconcile, owner name or mailing address on the county record that does not match the entity, and payment status (late, partial).
- **Why:** In Alabama the bill is mailed "only as a courtesy" and you owe the tax whether or not it arrives ([ADOR FAQ](https://www.revenue.alabama.gov/faq-categories/real-property)). Unpaid taxes go delinquent Jan 1 and to a tax sale in May, with redemption at 12% a year ([ACES tax sales](https://www.aces.edu/blog/topics/home/tax-sales/), [Nolo](https://www.nolo.com/legal-encyclopedia/what-happens-if-i-dont-pay-property-taxes-alabama.html)). A wrong mailing address is how this happens.
- **Data:** Owner, MailAdd [G]; entity names and aliases; coverage logic already on the Taxes page.
- **Have it?** Yes. Much of this already exists on the Taxes page and should be summarized into the report, not duplicated.
- **Effort:** S.

### 9. Bill check: does it tie out? [G, S, R]
- **Shows:** For each parcel: expected tax = taxable assessed value × district millage + $0.10 × timber acres (+ fire fee if a dwelling), against the actual bill. It also shows implied millage = (tax − timber acre tax) ÷ assessed × 1000, against the published rate for the TaxDist.
- **Why:** This catches the wrong tax district (inside versus outside a town), a missing homestead exemption, a misapplied cap, and extraction errors. It is proven by the $291.90 example above.
- **Data:** TAV, TaxDist, TimberAcres, TotalTaxDue [G]; assessed_value [S] where present; millage table [R].
- **Have it?** Needs [R] millage, which is a small table from the ADOR yearly millage PDF ([2025 millage rates](https://www.revenue.alabama.gov/wp-content/uploads/2025/09/2025-Millage-Rates.pdf)). It also needs a per-county mapping of GIS field names.
- **Effort:** M.

### 10. Deadlines and calendar [R]
- **Shows:** A dated list for the owner's counties: current use application window (Oct 1 to Jan 1), protest window (30 days from the valuation notice), taxes due Oct 1 and delinquent after Dec 31, the 7% cap sunset (runs through the tax year beginning Oct 1, 2027), and Mississippi dates where relevant. Each date links to the finding it affects.
- **Why:** Missing the 30-day protest window forfeits the appeal for that year, and the circuit court appeal after the Board is also strictly 30 days ([Ala. Code 40-3-25](https://law.justia.com/codes/alabama/2022/title-40/chapter-3/section-40-3-25/), [Alabama Lawyer on BOE appeals](https://www.alabar.org/news/from-the-alabama-lawyer-appeal-of-board-of-equalization-valuations/)).
- **Data:** county_tax_defaults already holds due and delinquent dates. Add a valuation notice date per county per year, entered by the owner when the notice arrives.
- **Have it?** Partly.
- **Effort:** S.

### 11. Next year's estimate [S, G, R]
- **Shows:** An estimated bill for next year by entity and property. It uses this year's taxable value grown by the smaller of the parcel's own trend and the 7% cap, at this year's millage, with a range. It adds a "cap ends" scenario: if the cap is not renewed after tax year 2027, taxable value resets to full assessed value.
- **Why:** Budgeting and setting lease escalators. Commercial tools sell "forecasting and accruals" for the same reason ([Itamlink](https://tax.com/property-tax/itamlink/)).
- **Data:** As in section 4.
- **Have it?** Yes for a simple version.
- **Effort:** S to M.

### 12. Accountant pack [H, I]
- **Shows:** Tax paid by calendar year (the payment date, which is the year a cash-basis taxpayer deducts it) by entity and by property, with the statement account, check, and date, plus a column for how the parcel is used (rented farm, timber investment, homestead).
- **Why:** Treatment differs: rental and farm use (Schedule E or F), timber held as an investment (itemized, or elected to be capitalized as a carrying charge), timber business ([timbertax.org guidance](https://timbertax.org/publications/aghandbook731/Chapter%203.%20General%20Tax%20Considerations.pdf)). The accountant needs paid-date totals, not tax-year totals.
- **Data:** tax_payments.paid_date and amount [H]; allocation to entity and property exists.
- **Have it?** Yes.
- **Effort:** S.

### 13. Protest packet for one parcel (PDF) [S, G, P, L]
- **Shows:** A one or two page per-parcel PDF: value history, value per acre against the CU ceiling and against the county's own neighbors (if neighbor data is ever pulled), acreage evidence, land cover map, a timber or crop use summary, and the deadline. It ends with a blank "owner's opinion of value" line.
- **Why:** Board of Equalization protests are about market value only. Some county boards say they have no authority over class, current use, or exemptions, which go to the assessor ([Mobile County BOE](https://www.mobilecountyal.gov/government/govt_boe.html)). Evidence of actual use (photos, harvest or crop records) carries weight in classification disputes ([Iowa State CALT](https://www.calt.iastate.edu/article/land-classified-agricultural-two-cases)).
- **Have it?** Mostly. The map exists via the print system.
- **Effort:** M.

---

## 4. Actionable findings catalog

Notation: `mills` = district millage ÷ 1000 (Lawrence/Colbert rural ≈ 0.030, Morgan rural ≈ 0.0374). `CUmax` = ADOR current use value for the best soil group ($532 crop/pasture, $827 timber, 2025 table). Dollar impact is **per year** unless noted. Severity: High = act now, Medium = ask the county, Low = tidy up.

| # | Check (trigger) | Severity | Dollar impact formula | Source tags | Data today? |
|---|---|---|---|---|---|
| F1 | **Likely not on current use.** Land value per acre (CLandValue ÷ acres, or appraised minus improvements ÷ acres) > 1.25 × CUmax for that land's type, AND the owner has ag or timber use on it (stands, fields, pastures, lease, FSA cropland) or the county shows TimberAcres > 0. Deadline: apply by Jan 1. | High | (land value − acres × CU value for its mix) × 0.10 × mills. Use the typical CU value ($443 crop, $630 timber) for the estimate and show a range from good to poor soil. | G, L, R | Yes for Lawrence GIS parcels; [R] needed |
| F2 | **Current use lost this year.** Land value per acre jumped from ≤ CUmax to > 1.25 × CUmax year over year, or the ratio moved 10% → 20%. Often follows a sale or an entity transfer. | High | (new taxable − old taxable) × mills. Also warn: if land is converted out of use, rollback = 3 years × (market − CU value) × 0.10 × mills. | S, G | Yes |
| F3 | **Ag or timber acres untaxed as such.** The app's timber stand acres on a parcel exceed the county TimberAcres by more than 5 acres or 20%, or crop/pasture acres are not in the county's use split. | Medium | Small but real: the timber acreage tax differs by $0.10/ac, and the CU value class differs (e.g. crop $443 versus timber $630). Show the acre gap and send the owner to the assessor. | G, L | Yes |
| F4 | **Value up with no improvements.** Appraised (or land) value up > 15% (adjustable) and CImpValue unchanged, no new structure. Deadline: 30 days from the valuation notice. | Medium | (Δ taxable value) × mills, capped by the 7% rule after 2025. Under current use, a land value rise usually means market valuation, so route it to F1. | S, G | Yes (appraised) |
| F5 | **Cap not applied.** Taxable assessed rose > 7% (plus $20 rounding) year over year with no class change, ownership change, or improvement. | Medium | (taxable this year − 1.07 × taxable last year) × mills | S (assessed, thin), G snapshots | Partly; needs assessed history |
| F6 | **Bill does not tie out.** \|actual − (TAV × mills + $0.10 × TimberAcres + fees)\| > $5 and > 2%. | Medium | The difference itself. | G, S, R | Needs the millage table |
| F7 | **Wrong tax district.** Implied millage matches a different district (e.g. inside town) than the parcel's location. | Medium | (implied mills − correct mills) × TAV | G, R | Needs [R] |
| F8 | **Millage went up.** The district's published rate rose year over year (a vote or commission action). Informational: not appealable. | Low | Δmills × taxable value, summed per entity | R | Needs [R] history |
| F9 | **Acreage mismatch.** Max/min of (deeded, CALC_ACRE, GIS acres) > 1.10 and the gap is > 2 acres. | Medium if county acres > deed | (county acres − deeded acres) × taxable value per acre × mills | P, G | Yes |
| F10 | **Missing bill.** A parcel owned all year has no matched line for the tax year after Oct 1. Deadline: delinquent after Dec 31. | High after Dec 1 | Last year's tax for that parcel (exposure), plus 12%/yr interest and sale risk if missed | S, P | Yes (exists on the Taxes page) |
| F11 | **Duplicate billing.** The same parcel (by any identifier) appears on two accounts in the same year, or two lines overlap the same land. | High | The duplicated line's tax | S, H | Yes (unique index guards matched lines; check unmatched lines against identifiers) |
| F12 | **Unpaid or partial near the deadline.** Balance > 0 within 30 days of Dec 31, or already delinquent. | High | Balance + $5 fee + 12%/yr | H | Yes |
| F13 | **Owner or mailing address mismatch.** The county Owner does not match the entity name or aliases, or MailAdd differs from the entity's address. Bills go astray. | Medium | Exposure = that parcel's annual tax | G, entities | Yes |
| F14 | **Exemption dropped.** A homestead code (H1 to H4) on last year's line is gone this year. | Medium | H1 ≈ $2,000 assessed exempt from county tax ≈ $2,000 × county mills; over-65/disabled can be larger | S (thin: 9 rows) | Partly; needs re-extraction |
| F15 | **Homestead not claimed.** A parcel with a dwelling (CImpValue > 0) that is the owner's residence (owner input) shows no exemption. Up to 160 acres. | Medium | Exemption amount × applicable mills | G, owner input | Needs an owner flag |
| F16 | **Unmatched lines.** A statement line has no parcel (47 today). | Low | That line's tax is not in any per-acre or per-property figure | S | Yes |
| F17 | **Tax eats income.** Tax ÷ land income > 10% for a leased property (or > 5% for 3 years running). | Low | Shown as a %. Pair with F1 if the land looks market-valued. | S, I | Yes |
| F18 | **New owner window.** A deed or purchase date within the last 15 months on a CU-eligible parcel, with no CU application document on file (documents.doc_type = current_use_application). | High | As F1 | documents, G (DeedBook/Page) | Yes |
| F19 | **Rollback risk.** A parcel at current use has a planned or recorded non-ag use (lot sale, easement build, house site). | Info | 3 × (market − CU) × 0.10 × mills, a one-time charge to the owner of record next Oct 1 | G, owner input | Partly |

**Thresholds to make adjustable:** the F4 spike percent (keep the existing 15%), F9 acre tolerance, and F17 income percent. Everything else is rule-based.

**How dollar figures should read on screen:** "About $1,430 a year (range $960 to $1,590)". Always round, always a range when soil group is unknown, and always "estimate".

---

## 5. Alabama facts reference

**Assessment classes** ([ADOR assessment](https://www.revenue.alabama.gov/property-tax/property-tax-assessment/))
- Class I utilities 30%; Class II everything not otherwise classed (commercial, rentals, non-ag land) 20%; **Class III farm, forest, owner-occupied home, historic 10%**; Class IV personal autos 15%.
- Tax = appraised × class ratio × millage, minus exemptions, plus flat fees.

**Current use** ([ADOR current use page](https://www.revenue.alabama.gov/property-tax/current-use/), [Rule 810-4-1-.01](https://www.law.cornell.edu/regulations/alabama/Ala-Admin-Code-r-810-4-1-.01), Code §§ 40-7-25.1 to 25.3)
- Class III only. Land used to grow and sell crops, livestock, or timber.
- **Apply between Oct 1 and Jan 1** with the county assessing official ([form cuapp.pdf](https://www.revenue.alabama.gov/wp-content/uploads/2021/10/cuapp.pdf): acres by row crop, pasture, timber, homesite; purchase price if bought within 5 years; notarized). No reapplication needed each year. **A new owner must apply or the land goes to market value.** Parcels of 5 acres or less may need an Alabama Forestry Commission management plan. Counties may want aerial photos.
- Values are set by ADOR yearly by soil group 1 to 10. **CU-2025 table (for bills due Oct 1, 2025)** ([CU-2025 rev](https://revenue.alabama.gov/wp-content/uploads/2025/01/CU-2025rev.pdf)):
  - Row crop and pasture: Good $532, Average $443, Poor $310, Non-productive $110 (unchanged in the 2022, 2023, and 2024 directives).
  - Timber: Good $827, Average $630, Poor $449, Non-productive $360 (2023: $805/613/437/350; 2024: $816/622/443/355). Timber values creep up about 1.3% a year.
  - A Directive 2027 was posted in November 2026 ([PDF](https://www.revenue.alabama.gov/wp-content/uploads/2026/11/Directive-2027-Current-Use-Valuation-Procedures.pdf)). It is a scanned image that could not be read here, so its values still need to be read by eye before loading the table.
- After the county sets CU values, the owner has **30 days from the notice** to dispute the soil group.
- **Rollback** (§ 40-7-25.3): when CU land is converted to a non-qualifying use, or sold and converted within 2 years, the owner of record on the next Oct 1 pays the difference for up to **3 prior years**. The difference is figured on the greater of sale price or market value, at the 10% ratio. A 2023 bill (SB349) to cut this to 1 year was not confirmed as enacted.

**7% cap** (Act 2024-344, § 40-7-2.2; [ADOR cap page](https://www.revenue.alabama.gov/property-tax/7-cap-information-hb73-act-2024-344/), [Rule 810-4-1-.28](https://admincode.legislature.state.al.us/api/rule/810-4-1-.28))
- Taxable assessed value of Class II and III real property can rise at most 7% a year (rounded to the nearest $20 not over 7%). The base year is Oct 1, 2024, first applied to the bills due Oct 1, 2025.
- **The cap is lifted** by: a class change, an ownership change (except spouse or family transfers for no or nominal pay, inheritance, or foreclosure/tax sale redemption, which need an affidavit), new or significantly improved property, or a TIF district.
- **Sunset:** runs "through the fiscal year beginning October 1, 2027". A 2026 bill (HB167) proposed tying the cap to CPI, and its final status is unconfirmed ([HB167 introduced](https://alison.legislature.state.al.us/files/pdf/SearchableInstruments/2026RS/HB167-int.pdf)). Tuscaloosa's 2026 notice insert says "sunsets 2028 unless extended" ([insert](https://www.tuscco.com/wp-content/uploads/2026/05/Insert-for-2026-Valuation-Notices-CAP-Doc-3-1.pdf)).

**Millage** ([ADOR 2025 millage rates](https://www.revenue.alabama.gov/wp-content/uploads/2025/09/2025-Millage-Rates.pdf))
- State 6.5 mills everywhere. Each school district must levy at least 10 local mills ([Alabama Arise handbook 2026](https://alarise.org/resources/the-alabama-tax-and-budget-handbook-2026-property-taxes/)).
- **Lawrence 2025:** state 6.5; county 13.5 (general 7.0, road and bridge 2.5, hospital 4.0); school countywide 7.0 + district 3.0 = 10.0. **Rural total ≈ 30.0 mills**, with municipal levies on top inside towns. $25 fire fee per dwelling or commercial building.
- **Colbert 2025:** state 6.5; county 8.5 (general 6.5, road and bridge 2.0); school countywide 4.0 + district 11.0 = 15.0 in districts 1, 2, and 6 to 8 (higher in Tuscumbia and Muscle Shoals). **Rural total ≈ 30.0 mills.** $50 fire fee per dwelling outside the three cities.
- **Morgan 2025:** state 6.5; county 13.8 outside the cities; school district 1 17.1. **Rural total ≈ 37.4 mills.**
- **Statewide $0.10 per acre timberland tax** on every forest acre (this explains small leftovers on bills).
- Millage changes require a local vote or legislative or commission action ([ADOR FAQ](https://www.revenue.alabama.gov/faq-categories/real-property)).
- (These totals were read from the ADOR PDF layout. Confirm them against one 2025 bill per district before loading the table.)

**Exemptions** ([ADOR homestead](https://revenue.alabama.gov/property-tax/homestead-exemption/), [Marengo County codes](https://www.marengocountyal.com/home/revenue/homestead-exemptions/))
- Homestead = owner-occupied single-family home and up to **160 acres**. You must own and occupy it on Oct 1 of the tax year, and apply at the county.
- The regular homestead exempts $4,000 of assessed value from state tax and $2,000 from county tax (school taxes vary).
- Over 65, permanently and totally disabled, or blind: exempt from the state portion. Over 65 with income ≤ $12,000 gets a larger county exemption. Codes commonly print as H1 (regular), H2/H3 (65+ or disabled with income tests), H4 (65+ no income limit). Codes vary by county, so verify.

**Reappraisal and notices** ([ADOR FAQ](https://www.revenue.alabama.gov/faq-categories/real-property), [Tuscaloosa 2026 insert](https://www.tuscco.com/wp-content/uploads/2026/05/Insert-for-2026-Valuation-Notices-CAP-Doc-3-1.pdf))
- Annual reappraisal: counties must review at least 25% of parcels each year, with a full county cycle every 4 years.
- Valuation notices go out when value rises, a parcel is new, or the owner is new. They are typically mailed between spring and summer, county by county ([APTC archive](https://www.aptcnet.com/property-tax-resources/national-property-tax-updates/alabama-property-tax-updates)). You can protest without one.

**Appeals** ([§ 40-3-25](https://law.justia.com/codes/alabama/2022/title-40/chapter-3/section-40-3-25/), [Alabama Lawyer](https://www.alabar.org/news/from-the-alabama-lawyer-appeal-of-board-of-equalization-valuations/), [Madison County](https://www.madisoncountyal.gov/departments/tax-assessor/my-property-taxes-are-too-high))
- Written protest to the county Board of Equalization within **30 days of the valuation notice**. The protest is about market value. Class, current use, and exemptions go to the assessor or revenue commissioner.
- Then appeal to circuit court within **30 days of the Board's final decision**. Notice must reach both the Board secretary and the circuit clerk, and a cost bond is required. Taxes must be paid by Dec 31 or bonded.

**Due dates and delinquency** ([ADOR FAQ](https://www.revenue.alabama.gov/faq-categories/real-property), [ACES tax sales](https://www.aces.edu/blog/topics/home/tax-sales/), [Rule 810-4-6-.01](https://www.law.cornell.edu/regulations/alabama/Ala-Admin-Code-r-810-4-6-.01))
- Due Oct 1; **delinquent after Dec 31**; sent to probate in Feb; advertised in April; tax sale or lien auction in May (each county chooses which by Oct 1).
- Redemption within 3 years at 12% a year plus fees. The buyer pays 3 straight years of taxes before a tax deed.

**Mississippi in brief** ([MSU Extension](https://extension.msstate.edu/publications/understanding-mississippi-property-taxes), [MSU land use info sheet](https://www.mafes.msstate.edu/publications/information-sheets/is1365.pdf), [MS DOR FAQ](https://dor.ms.gov/county-services/property-tax-frequently-asked-questions))
- Farm and forest land is Class II at **15%**, valued by **use** (soil type and productivity, state guidelines) on Jan 1. Owner-occupied homes are Class I at 10%.
- Taxes due **Feb 1** of the following year. Objections go to the county Board of Supervisors by the **first Monday in August**. Tax sale usually the last Monday in August. Homestead: regular credit up to $300; 65+ or disabled exempts the first $7,500 of assessed value.
- Some counties take ag use applications Jan 1 to Apr 1 ([Madison County MS form](https://www.madison-co.com/sites/default/files/ag_use_form_092020_1.pdf)).
- The report should key its deadlines and ratios by state, so MS parcels get MS rules.

---

## 6. Market context numbers (for estimates; label them as estimates)

- 2025 Alabama verified sales averages: farm and cropland about $5,300/ac, pasture about $4,700/ac, timberland just over $2,000/ac ([Saunders 2025 Alabama report](https://www.saundersrealestate.com/services/market-research/alabama-land-values-become-increasingly-segmented-amid-strong-2025-transaction-activity/)).
- 2025 cash rents (ACES): Lawrence non-irrigated $105, irrigated $160, pasture $31.50; Colbert non-irrigated $104, pasture $32.50; Morgan non-irrigated $76.50, pasture $27.50 ([ANR-2745](https://www.aces.edu/wp-content/uploads/2025/08/ANR-2745_AlabamaCashRentalRates2025_020226L-G.pdf)).
- What current use is worth per acre at 30 mills: cropland market ≈ $15.90 versus CU good ≈ $1.60, **about $14 saved per acre a year**. Timber market ≈ $6.10 versus CU good ≈ $2.58, **about $3.50 saved per acre a year**. On 1,000 crop acres that is about $14,000 a year.
- Alabama taxes timberland at roughly a third of the rate in neighboring Georgia, Tennessee, and Mississippi ([Alabama Arise, citing a 2020 Auburn study](https://alarise.org/resources/the-alabama-tax-and-budget-handbook-2026-property-taxes/)). Expect owners to see small absolute numbers, which is why the per-acre and income-share framing matters.

---

## 7. Data work that unlocks the rest (ranked by payoff)

1. **Reference tables [R]** (S): `current_use_values(state, year, land_type, soil_group, rating, value_per_acre, source_url)` and `millage_rates(state, county, district, year, state_mills, county_mills, school_mills, municipal_mills, per_acre_timber, fees, source_url)`. These are platform-curated like `covered_commodities`, about 30 plus about 100 rows a year, and updated each October.
2. **Yearly GIS value snapshots** (S): copy each parcel's `attributes` into a `parcel_valuations(parcel_id, tax_year, land_value, improvement_value, taxable_value, assessed_value, timber_acres, calc_acres, tax_district, tax_due, owner, mail_address, fetched_at)` row on each county refresh. Today the report can't see GIS history because attributes get overwritten. Also add a per-county field map (Lawrence TTV/TAV/CLandValue, and so on, with Colbert and Morgan names to be confirmed).
3. **Richer statement extraction** (M, plus a re-run over 99 statements): add to the line schema `market_value`, `current_use_value`, `land_value`, `improvement_value`, `assessment_class` or ratio, `taxable_assessed_value` (after cap), `exemption_amount`, `millage` or `tax_district`, `timber_acres`, and `acres`. Assessed (87/330), acres (5), and exemptions (9) are the current gaps. Re-running costs extraction tokens on about 330 lines and needs review of changed values. Cost it as one batch job with a diff screen. The fixtures (2024 Lawrence, 24 pages) are the test.
4. **Owner-confirmed flags per parcel** (S): `current_use_status` (enrolled / not enrolled / unknown, with date and document link) and `is_homestead`. These turn F1 and F15 from guesses into checks.
5. **Valuation notice log** (S): a date per county per year, entered by the owner, which starts the 30-day protest clock.

Leave out for now: soil-group mapping from NRCS soil data (SSURGO) to ADOR soil groups. It is possible and would let the app estimate the exact CU value per parcel, but the mapping rules live in an ADOR appendix and need validation. That is an L, and a phase-two item.

---

## 8. Competitive and product landscape

| Tool | What it does | What a rural owner would value | What is overkill |
|---|---|---|---|
| **Ownwell** and similar appeal services ([review](https://www.moneycrashers.com/ownwell-review/)) | Contingency-fee (often 25%) residential appeals using comps, plus ongoing monitoring. Limited states, not Alabama farmland. | A "you may be overpaying by $X" headline and ongoing monitoring | Comps-based market appeals: on CU land the value is set by a table, not comps |
| **Avalara Property Tax, CSC PTMS/AppealTrack, Itamlink, Ryan, Orbis** ([Avalara](https://www.avalara.com/us/en/products/property-tax/videos/video-avalara-property-tax-for-enterprise.html), [CSC](https://www.cscglobal.com/service/corporate-tax-services/property-tax/appealtrack/), [Itamlink](https://tax.com/property-tax/itamlink/), [Ryan](https://ryan.com/tax-technology/property-tax)) | Enterprise: bill capture, due-date calendars, assessment notice review, appeal tracking, accruals and forecasts, approval workflows | Deadline calendar, bill tie-out, the forecast, a "savings found" summary | Approval workflows, accrual journals, multi-state compliance returns |
| **AcreValue, Acres.com, FBN, Regrid, LandGate** ([AcreValue](https://www.acrevalue.com/resources/farming/navigating-farmland-property-taxes-a-comprehensive-guide/), [Acres GIS vs courthouse acres](https://support.acres.com/gis-vs-courthouse-acres)) | Parcel maps, owner names, soils, sales comps, value estimates | Soil-aware land values, GIS versus courthouse acres | Buyer prospecting and lead lists |
| **Farm accounting (Ambrook, Traction, Granular)** ([Ambrook on AL current use](https://ambrook.com/funding/alabama-current-use-valuation-farm-and-timberland)) | Expense tracking. Ambrook lists AL current use as a "funding" opportunity. | Tax as an expense line by entity, for the accountant | Full general ledger |

**Takeaway:** No tool combines the owner's own land-use records (stands, fields, leases) with the county's valuation and the state's current use tables. That combination is what makes Turnrow's current use and acreage checks unique. Nobody else can say "you have 140 acres of pine on this parcel but the county shows 9 timber acres".

---

## 9. Report design patterns to follow

- **Answer first, then reasons, then evidence** (inverted pyramid; [NN/g](https://www.nngroup.com/articles/inverted-pyramid/?so=1)). The Bottom line fits in one screen without scrolling.
- **Every finding = dollars + deadline + one action + evidence link.** No finding without a dollar estimate or an explicit "can't estimate: here's why".
- **One plain sentence per number** ("Up $412: $380 from higher values, $32 from the new school millage"). The existing decompositionSentence pattern is right.
- **Context for every figure:** per acre, percent of income, versus last year, versus the expected range. A bare dollar amount means nothing to a landowner.
- **Progressive disclosure:** summary, then findings, then property tables, then parcel detail, then the source statement PDF (already linked from documents).
- **Honest confidence labels:** "Confirmed" (owner or county verified), "Likely", "Can't tell (missing value)". Show coverage ("based on 283 of 330 lines matched to parcels").
- **The print version is a different artifact, not a screenshot:** letter portrait, a cover page with scope and date, findings first, tables with repeated headers, a sources and assumptions page at the back, and the reference rates used (millage and CU table year) so an accountant or Board member can check the math.

---

## 10. Proposed report outline

**Screen (opened from the Taxes page as "Tax report", full page, not a collapsible):**
1. Scope bar: year, entity chips, property, county (keep today's controls). Drop the spike-threshold control into a settings popover.
2. **Bottom line card:** total tax, change and reason sentence, tax per acre, percent of income, findings count and dollars at stake, next deadline.
3. **Things worth a look:** ranked findings (section 4), each expandable to its evidence.
4. **What changed and why:** a bridge chart (last year to this year) and a top-movers table.
5. **Current use and acreage:** a per-parcel table with land value per acre against the CU ceiling, county versus deed versus GIS acres, county timber acres versus stand acres, and a status column.
6. **Benchmarks:** tax per acre and percent of income by property, with a 5-year trend sparkline.
7. **Next year estimate:** by entity, with the "if the cap ends" scenario.
8. **Deadlines:** the calendar for the owner's counties and states.
9. **Bill details:** parcel lines by statement, payments, and an unmatched list (link to the existing Taxes page sections rather than rebuilding them).
10. "How we figured this": rates used, data coverage, assumptions.

**PDF (two flavors from one button):**
- **Owner / accountant report:** cover with scope; bottom line; findings; what changed; tax paid by calendar year by entity and property (the accountant page); benchmarks; next year estimate; assumptions and sources.
- **Protest packet (one parcel):** parcel facts and map; value history; value per acre against the CU table; acreage evidence; land-use evidence (stands, leases, FSA); the deadline and where to file; blank owner opinion of value.

**Leave out to keep it easy:**
- Market comps and automated market value models (wrong tool for CU land, and the data is costly).
- Statistical charts beyond one bridge and one trend line, and no scatterplots.
- A per-taxing-body breakdown for every parcel (show it only in "bill check" detail).
- Multiple decomposition methods or "index theory" language. One plain sentence only.
- Personal property lines in per-acre figures (keep them in totals, labeled).
- Any automatic filing or contact with the county: the report prepares, the owner acts.

---

## 11. Open questions for the owner

1. Do you know which parcels are enrolled in current use today? Is there a list from the Lawrence or Colbert assessor, or CU applications in the S: drive, so F1 can start from confirmed facts?
2. Should we spend the extraction cost to re-read all 99 statements with the richer schema (market and CU value, class, assessed after cap, millage), or only the 2024 and 2025 statements?
3. Do the Colbert and Morgan GIS layers carry land value, timber acres, and tax district like Lawrence's KCS layer? If not, statements are the only source there, which raises the value of re-extraction.
4. Which parcels are anyone's homestead (for the exemption checks), and are any owners over 65 or disabled?
5. What should "income" include for the percent-of-income figure: cash rent only, or hunting, timber (averaged), and government payments too?
6. Who reads the PDF: your accountant (calendar-year paid totals), a lender, or a Board of Equalization? That decides which PDF flavor to build first.
7. Do you want the report to suggest current use applications for parcels that are not ag or timber today (e.g. idle land you could plant in pine)? That is a management decision, not just a tax one.
8. Are the Mississippi holdings big enough to warrant MS-specific checks in the first release, or just MS deadlines?
9. How much rounding do you want in dollar figures: nearest $10 for findings, exact cents only in bill details?

---

## 12. Sources

- ADOR Current Use: https://www.revenue.alabama.gov/property-tax/current-use/
- ADOR CU-2025 directive (revised): https://revenue.alabama.gov/wp-content/uploads/2025/01/CU-2025rev.pdf ; original https://revenue.alabama.gov/wp-content/uploads/2024/10/CU-2025.pdf ; CU-2024 https://revenue.alabama.gov/wp-content/uploads/2024/09/CU_Directive-2024.pdf ; CU-2023 https://REVENUE.ALABAMA.GOV/wp-content/uploads/2024/01/CU_Directive-2023.pdf ; CU-2022 https://www.revenue.alabama.gov/wp-content/uploads/2022/11/CU_Directive_2022.pdf ; Directive 2027 (scanned) https://www.revenue.alabama.gov/wp-content/uploads/2026/11/Directive-2027-Current-Use-Valuation-Procedures.pdf
- CU application form: https://www.revenue.alabama.gov/wp-content/uploads/2021/10/cuapp.pdf
- Rule 810-4-1-.01: https://www.law.cornell.edu/regulations/alabama/Ala-Admin-Code-r-810-4-1-.01
- ADOR 7% cap: https://www.revenue.alabama.gov/property-tax/7-cap-information-hb73-act-2024-344/ ; Rule 810-4-1-.28 https://admincode.legislature.state.al.us/api/rule/810-4-1-.28 ; Marengo County cap page https://www.marengocountyal.com/home/revenue/7-cap/ ; Tuscaloosa 2026 notice insert https://www.tuscco.com/wp-content/uploads/2026/05/Insert-for-2026-Valuation-Notices-CAP-Doc-3-1.pdf ; HB167 (2026) https://alison.legislature.state.al.us/files/pdf/SearchableInstruments/2026RS/HB167-int.pdf
- ADOR assessment classes: https://www.revenue.alabama.gov/property-tax/property-tax-assessment/
- ADOR 2025 millage rates: https://www.revenue.alabama.gov/wp-content/uploads/2025/09/2025-Millage-Rates.pdf
- ADOR real property FAQ: https://www.revenue.alabama.gov/faq-categories/real-property
- ADOR homestead: https://revenue.alabama.gov/property-tax/homestead-exemption/ ; Marengo County codes https://www.marengocountyal.com/home/revenue/homestead-exemptions/
- Alabama Arise 2026 handbook: https://alarise.org/resources/the-alabama-tax-and-budget-handbook-2026-property-taxes/
- Ala. Code 40-3-25: https://law.justia.com/codes/alabama/2022/title-40/chapter-3/section-40-3-25/ ; Alabama Lawyer on BOE appeals https://www.alabar.org/news/from-the-alabama-lawyer-appeal-of-board-of-equalization-valuations/ ; Madison County appeals https://www.madisoncountyal.gov/departments/tax-assessor/my-property-taxes-are-too-high ; Mobile County BOE https://www.mobilecountyal.gov/government/govt_boe.html ; APTC Alabama updates https://www.aptcnet.com/property-tax-resources/national-property-tax-updates/alabama-property-tax-updates
- Tax sales: https://www.aces.edu/blog/topics/home/tax-sales/ ; https://www.nolo.com/legal-encyclopedia/what-happens-if-i-dont-pay-property-taxes-alabama.html ; Rule 810-4-6-.01 https://www.law.cornell.edu/regulations/alabama/Ala-Admin-Code-r-810-4-6-.01
- ACES 2025 cash rents (ANR-2745): https://www.aces.edu/wp-content/uploads/2025/08/ANR-2745_AlabamaCashRentalRates2025_020226L-G.pdf
- Saunders 2025 Alabama land market: https://www.saundersrealestate.com/services/market-research/alabama-land-values-become-increasingly-segmented-amid-strong-2025-transaction-activity/
- Georgia Forestry timberland tax per acre comparison: https://digital-editions.todaymediacustom.com/georgia-forestry/fall-2017/files/basic-html/page27.html
- farmdoc daily farmland taxes: https://farmdocdaily.illinois.edu/wp-content/uploads/2025/10/fdd102125.pdf
- Timber tax treatment: https://timbertax.org/publications/aghandbook731/Chapter%203.%20General%20Tax%20Considerations.pdf
- Acreage discrepancies: https://deathandtaxes.sog.unc.edu/?p=1072 ; https://mapwv.gov:443/parcel/docs/Acreage.pdf ; https://support.acres.com/gis-vs-courthouse-acres
- Ag classification evidence: https://www.calt.iastate.edu/article/land-classified-agricultural-two-cases
- Mississippi: https://extension.msstate.edu/publications/understanding-mississippi-property-taxes ; https://www.mafes.msstate.edu/publications/information-sheets/is1365.pdf ; https://dor.ms.gov/county-services/property-tax-frequently-asked-questions ; https://www.madison-co.com/sites/default/files/ag_use_form_092020_1.pdf
- Products: https://www.moneycrashers.com/ownwell-review/ ; https://www.avalara.com/us/en/products/property-tax/videos/video-avalara-property-tax-for-enterprise.html ; https://www.cscglobal.com/service/corporate-tax-services/property-tax/appealtrack/ ; https://tax.com/property-tax/itamlink/ ; https://ryan.com/tax-technology/property-tax ; https://www.acrevalue.com/resources/farming/navigating-farmland-property-taxes-a-comprehensive-guide/ ; https://ambrook.com/funding/alabama-current-use-valuation-farm-and-timberland
- Report design: https://www.nngroup.com/articles/inverted-pyramid/?so=1
