# Turnrow Land: Timber Section Research

Prepared 2026-11-09. Research only: no app code or database changes were made.

Audience assumed: family forest owners and farm families in north Alabama with tens to a few thousand acres of planted pine and hardwood, who sell timber every few years through a consulting forester and hand their numbers to an accountant. Not TIMOs or REITs.

Tax notes here are general information drawn from USDA Forest Service and extension publications. They are not tax advice, and the app should say so wherever it shows tax numbers.

---

## 1. Executive summary

**The biggest gap is money, not maps.** Turnrow already does what most landowner tools do well (stand maps, auto-proposed stands, a sale contract record, settlement import with per-stand allocation). Almost no tool aimed at families does the next part: the records that decide how much tax a family pays when timber is sold. That means timber basis, depletion, reforestation costs, cost-share, and casualty losses.

The USDA Forest Service's 2025 tax tips put it simply. You pay tax on net timber income: gross proceeds minus selling expenses, severance or yield taxes, and the depletion allowance (your timber basis). Their worked example turns a $20,000 sale into $10,500 of taxable gain just by subtracting basis and expenses. A practitioner deck for landowners calls basis "the biggest issue" and notes that if you cannot prove basis, the IRS presumes zero.

So the most valuable thing Turnrow can build is a **timber basis and depletion ledger** tied to stands and sales, fed by a **per-stand activity and cost history**. On top of that sits an **accountant-ready annual timber tax summary**. Each piece is modest on its own. Together, with the map and sales features Turnrow already has, they are something no family-focused product offers in one place.

Second priority is **management continuity**: a simple management plan with a schedule of upcoming work, generated from templates by stand type. Examples are herbicide release at age 1 to 2, first thinning around age 13 to 17 depending on site index, and burns every 3 to 5 years after thinning. This turns the timber page from a record of the past into "what should happen next on my land."

Third is **selling well**: extend the existing sale record into a full workflow. That covers cruise, prospectus, sealed bids, contract checklist, harvest inspections, closeout and BMP check, then the replanting obligation and its costs flowing straight into the Section 194 tracker.

Top recommendations, in order:
1. Stand activity log with costs and a tax category on every cost (must-have, M).
2. Timber basis accounts and depletion ledger, driven by sales and settlements (must-have, L).
3. Reforestation (Sec 194) and cost-share (Sec 126) trackers that fall out of the same cost data (must-have, M).
4. Annual timber tax summary per owner entity, exported as PDF and CSV for the accountant (must-have, M).
5. Sale workflow from planning to post-harvest, with bids, inspections, and closeout (must-have, M).
6. Management plan plus a schedule of recommended activities from stand-type templates (should-have, M).
7. Cruise and inventory records, and price references beside the sale form (should-have, M and S).

---

## 2. What exists today (from the codebase)

| Area | What Turnrow has now | Where |
|---|---|---|
| Stands | `timber_stands`: property, name, stand_type (planted_pine, natural_pine, hardwood, mixed, other), species, year_established, site_index, last_thinning_year, last_burn_year, notes, boundary, computed acres | migration 0002, `app/(app)/timber/` |
| Stand discovery | Timber Scan proposes stand boundaries from imagery and land-cover data, with AI assist for planted vs natural pine | migration 0011, `lib/timberScan/` |
| Sales | `timber_sales`: lump_sum or pay_as_cut, harvest_type, status, contract date, harvest deadline, performance deposit, sale acres, lump-sum price, stumpage rates by product ($/ton or $/MBF with log scale), payment schedule, delivered_net, allocation method | migrations 0003, 0018, `app/(app)/timber-sales/`, `components/timber/TimberSaleForm.tsx` |
| Settlements | Pay-as-cut settlement entries with per-product lines. Spreadsheet import (AI maps columns, deterministic math collapses loads). Allocation to stands by acres or manual percents | `lib/timberSettlement.ts`, `lib/timberAllocation.ts`, `SettlementUpload/Review` |
| Matching | Suggests which stands a contract or settlement refers to | `lib/timberMatch.ts` |
| Payments | expected_payments and payments for lump-sum installments | migration 0003 |
| Documents | Vault with entity links (timber_sale supported) | migration 0020 and later |
| Owner entities | `owner_entities` (useful: the tax summary must be per taxpayer) | migration 0009 |
| Stand page | Shows allocated timber income by sale and attached documents | `app/(app)/timber/[id]/page.tsx` |

Current data: 15 stands, 0 sales. That is good timing. The sale and basis model can be extended before real sales exist, so there is nothing to migrate.

---

## 3. Gap analysis

| Capability a best-in-class family system needs | Today | Gap |
|---|---|---|
| Stand facts a forester would ask for (origin, plant year, trees per acre planted and current, basal area, site index with base age and source, genetics, rotation goal) | Partial: type, species, year, site index, last thin and burn year | Missing TPA, BA, origin detail, age, site index source; "last" fields are single values instead of a history |
| Per-stand activity history (planting, site prep, release spray, burns, thinnings, fertilization, inspections, damage) | None (only last_thinning_year and last_burn_year) | **Major.** Nothing records what was done, when, at what cost, or by whom |
| Costs and their tax treatment (reforestation, capitalized, operating, selling expense) | None | **Major.** No timber expense records at all |
| Timber basis accounts and depletion | None | **Major.** No acquisition info on properties, no basis, no depletion unit, no Form T support |
| Reforestation deduction and amortization (Sec 194) | None | **Major** |
| Cost-share awards, obligations, Sec 126 exclusion | None | **Major** |
| Casualty and forest health events (SPB, ips, storm, fire) | None for timber (maintenance_issues covers washes, sinkholes) | Medium |
| Management plan and schedule of recommended work | None | **Major** for the "what's next" experience |
| Cruise and inventory records | None | Medium (sale value and basis volume depend on it) |
| Sale workflow (cruise, prospectus, bids, contract clauses, inspections, closeout, reforestation duty) | Contract and money side are strong | Pre-sale and post-harvest steps missing; no bid tabulation; no 1099-S tracking; no selling expense link |
| Price references (TimberMart-South, AFC, extension reports) | None | Medium |
| Annual timber tax summary for the accountant | None | **Major** |
| Documents tied to stands, activities, cost-share, basis | Vault exists; timber_sale attachment only | Small: extend entity types and doc types |
| Map layers for SMZs, firebreaks, burn units, damage spots | Roads exist; general drawing exists | Medium |
| Carbon, easements, current use valuation, certification | Easements module exists for utilities; property taxes module exists | Later |

---

## 4. Prioritized feature list

Effort: S = days, M = 1 to 3 weeks, L = 3 to 6 weeks for this codebase.

All tables follow the existing pattern: organization_id with org RLS, composite foreign keys to keep rows in-tenant, jsonb `details` for type-specific fields validated in app code (like `lib/assetTypes.ts`), and documents attachable through the vault.

### MUST-HAVE

#### M1. Stand activity log (with costs)

**What it is.** A dated history for each stand: site prep, planting, herbicide release, precommercial thinning, commercial thinning or harvest (linked to a sale), prescribed burn, fertilization, firebreak or road work, boundary marking, inspection or walk-through, damage observed, and other. Each activity can carry one or more costs.

**Why it matters.** Extension guidance is consistent that records are what let you deduct legitimate expenses, recover reforestation costs, and reduce tax on timber sales (Mississippi State "Setting the Books Using a Tree Farm Journal": https://extension.msstate.edu/publications/forestry-income-tax-series-setting-the-books-using-tree-farm-journal ; Penn State "Keeping Records of Forest Management Activities": https://extension.psu.edu/forest-finance-3-keeping-record-of-forest-management-activities). The IRS accepts informal records such as journals and calendars (Michigan Tech: https://msaf.forest.mtu.edu/ForestInfo/MSUElibrary/Taxes-Schlosser.PDF). It is also the backbone for ATFS certification and stewardship plan follow-up. And it answers the family's real question: "when did we last burn the back 80?"

**Data model sketch.**
- `stand_activities`: date (or start and end), activity_type, status (planned, done, skipped), title, notes, performed_by (vendor or "family"), acres_treated, timber_sale_id (optional), plan_recommendation_id (optional, see S1), details jsonb by type. Examples: planting has species, seedlings per acre, genetics or family, seedling source. Herbicide has product, rate, target. Burn has burn manager, permit number, weather, acres burned. Inspection has findings.
- `stand_activity_stands`: activity to one or more stands, with acres in each (one burn often covers several stands).
- `timber_costs`: date paid, amount, vendor, description, stand(s) or property, activity_id (optional), timber_sale_id (optional), owner_entity_id, **tax_category** (reforestation, capital_improvement, operating_expense, carrying_charge, selling_expense, depreciable, personal_nondeductible), cost_share_award_id (optional), document link (invoice).
- The stand's "last burn" and "last thinning" become computed from the log, with the old columns kept as a fallback for history entered before the log existed.

**Effort.** M.

#### M2. Timber basis and depletion ledger

**What it is.** One or more "timber accounts" per owner entity per tract, each holding an original basis and a volume, split by product (for example pine sawtimber tons, pine pulpwood tons). When timber is sold, the app proposes the depletion: quantity cut times the depletion unit (basis divided by volume). The adjusted basis then rolls forward.

**Why it matters.**
- Taxable gain is proceeds minus selling expenses minus depletion. USDA's example: $20,000 sale, $6,000 basis, $2,500 selling expenses, $1,000 yield tax, so $10,500 taxable. Their depletion example: 1,000 tons sawtimber with $10,000 basis gives $10 per ton, and 6,000 tons pulpwood with $6,000 basis gives $1 per ton. Selling 500 tons and 3,000 tons recovers $8,000 of basis (USDA FS-1275, Tax Tips for Forest Landowners 2025 Tax Year: https://timbertax.org/publications/fs/taxtips/2025-tax-tips.pdf).
- Purchased land: total cost is allocated between land and timber by fair market value. USDA's example: $33,000 cost, with land and timber valued $10,000 and $20,000, gives $22,000 timber basis (same source).
- Inherited land: basis is FMV at date of death, a "step-up." Gifts carry over the donor's basis (Rural Tax Education, Timber Tax Basics 2026: https://www.farmers.gov/sites/default/files/documents/timber-tax-basics-for-landowners-2026.pdf).
- With no records, a forester can do a retroactive appraisal that "ungrows" the timber back to the acquisition date (Mississippi State P1983: https://extension.msstate.edu/sites/default/files/publications/P1983%20revised%202023_web.pdf ; Missouri: https://extension.missouri.edu/media/wysiwyg/Extensiondata/Pub/pdf/agguides/agroforestry/af1014.pdf). Unused basis is lost if a sale happens without it (SREF webinar: https://sref.info/woodland-stewards/2022/basics_timber_basis_webinar_slides_012522.pdf).
- If basis cannot be proven, the presumption is zero (Timber Tax Basics 2026, above).
- Form T is required when claiming depletion, but not for occasional sales (one or two every 3 to 4 years). Adequate records are still required either way (FS-1275). The IRS Form T instructions are at https://www.irs.gov/instructions/it , and the Forest Landowners' Guide annotations of Form T are at https://timbertax.org/publications/aghandbook731/Appendix%20D.%20Annotations%20for%20IRS%20Form%20T%20(Timber).pdf.
- Casualty losses are limited to the lesser of FMV decline or basis in the timber "block," so zero basis means zero deduction (FS-1275). Basis records pay off twice.

**Data model sketch.**
- `property_acquisitions` (or columns on properties, per owner entity): how acquired (purchase, inheritance, gift, transfer into entity), date, total cost or date-of-death value, allocation to land, timber, and improvements, source (closing statement, estate appraisal, retroactive appraisal), document links.
- `timber_accounts`: owner_entity_id, property_id, name, product (or "all merchantable"), unit (ton default, MBF option), opening volume, opening basis, is_qualified_timber_property flag (for Sec 194, see M3), notes.
- `timber_account_stands`: which stands the account covers.
- `timber_account_entries`: date, entry_type (opening, capitalized_cost, reforestation_basis, volume_adjustment such as re-cruise or growth, depletion_from_sale, casualty_loss, transfer), volume_change, basis_change, timber_sale_id or settlement_id or cost_id, memo. Adjusted basis, volume, and depletion unit are computed by summing the entries.
- Pure function in `lib/timberBasis.ts` (unit-tested like `timberAllocation.ts`): given account entries plus sale quantities by product, return the proposed depletion. The user confirms (the project's standing "suggestions only" rule).
- Lump-sum sales without per-product quantities: deplete using the cruise volume sold (from the sale's cruise) or a percent of the account. The UI should ask in plain language: "About how much of this stand's timber was sold?"

**Effort.** L (the biggest feature, but mostly arithmetic and forms, with no external dependencies).

#### M3. Reforestation cost tracking toward the Sec 194 deduction

**What it is.** Every cost tagged "reforestation" (site prep, seedlings, planting labor, release spray in the establishment phase, replanting) rolls up per qualified timber property per tax year. The app shows the immediate deduction (up to $10,000 per QTP per year, $5,000 married filing separately), the amount left to amortize over 84 months, and an amortization schedule.

**Why it matters.** After a clearcut and replant, this is often the largest deduction a family will have, and it is easily missed. Rules from FS-1275 and the statute:
- Up to $10,000 per year per QTP can be deducted immediately (194(b)). The rest is amortized over 84 months (194(a)) with no cap.
- Both owned and leased land qualify if used for commercial timber. Trusts get amortization only. Personal labor does not count.
- A separate account is required for each QTP until the timber is disposed of.
- There is a recapture rule if the property is sold at a gain within 10 years.
- Sources: FS-1275 (above) and 26 USC 194: https://www.govinfo.gov/link/uscode/26/194 . Note that the older 26 CFR 1.194 regulation text reads the $10,000 as applying across all properties per year (https://timbertax.org/research/regulations/26cfr1.194-1), while current USDA guidance says per QTP. The app should show the per-QTP figure with a note to confirm with the accountant.
- The amortization half-year convention: the 84 months start on July 1 for calendar-year taxpayers, so year one and year eight get 1/14 each and years two to seven get 1/7 each (statute text above; Idaho LandCAN summary: https://www.idaholandcan.org/article/Federal-Reforestation-Deduction-and-Amortization/2544).
- Cost-share that is excluded under Sec 126 cannot also be deducted (FS-1275), so M3 must subtract it.

**Data model sketch.**
- No new core table. Uses `timber_costs` where tax_category = reforestation, grouped by `timber_accounts` flagged as QTP and by tax year.
- `reforestation_elections`: owner_entity_id, timber_account_id, tax_year, total eligible cost (computed), cost-share excluded (computed from M4), amount expensed under 194(b), amount amortized under 194(a), first amortization year. A computed schedule of 8 tax years and a recapture-watch end date (plus 10 years).
- Pure function `lib/reforestation.ts`: (costs, cost-share exclusions, expensed amount) gives deduction and schedule.

**Effort.** M.

#### M4. Cost-share tracking (awards, obligations, Sec 126)

**What it is.** A record of each cost-share or incentive contract (NRCS EQIP, CSP, CRP pine, AFC Southern Pine Beetle Prevention, Longleaf Alliance, emergency restoration). It holds the practices and acres, approved dollars, payments received, the practices' maintenance obligations, and the tax choice for each payment: include as income, or exclude under Sec 126.

**Why it matters.**
- Cost-share is income unless excluded. Programs that qualify include CRP, EQIP, and the Forest Health Protection Program. If excluded, the related costs cannot be deducted or added to basis, and there is recapture if the timber is sold within 20 years (FS-1275).
- The excludable amount is the present value of the greater of 10% of average annual income from the affected acres over the prior 3 years, or $2.50 per affected acre. A statement showing the calculation is attached to the return (26 CFR 16A.126-1: https://www.law.cornell.edu/cfr/text/26/16A.126-1 ; UNH worked example: https://extension.unh.edu/resources/files/Resource001323_Rep1734.pdf ; NC Forest Service: https://ncagr.gov/divisions/nc-forest-service/FHMCostShareTax/open).
- Alabama specifics: the AFC SPB Prevention cost-share covers first thinning of loblolly and shortleaf, understory burning, and low-density planting, for owners of 10 or more contiguous acres (https://forestry.alabama.gov/Pages/Management/CostShare.aspx ; https://forestry.alabama.gov/Pages/News/2023/SPB_Prevention_Cost_Share.aspx). NRCS EQIP forestry practices include 490 site prep, 612 tree planting, 338 prescribed burning, 666 forest stand improvement, and a CAP 106 forest management plan written by a technical service provider (https://efotg.sc.egov.usda.gov/references/public/IN/CAP_106_Forest_Management_Plan_Criteria_FY18_(national).pdf ; FY2026 Alabama EQIP practice scenarios: https://nrcs-prod.azureedge.us/sites/default/files/2026-03/EQIP_2026_Alabama_Eligible_Practice_Scenarios_BIC_02_26_2026.pdf). Federal programs need an FSA farm number (ACES: https://www.aces.edu/blog/topics/forestry-wildlife/resources-for-beginner-landowners/). Turnrow already tracks FSA farms.
- Contracts carry obligations (practice lifespan, CRP contract term). Breaking them can mean repaying, so the app should remind.

**Data model sketch.**
- `cost_share_awards`: owner_entity_id, program (eqip, csp, crp, afc_spb, longleaf, other), agency, contract number, signed date, end date, status, total approved, notes, documents.
- `cost_share_practices`: award_id, practice code and name, stand(s), planned acres, completed date, approved amount, maintenance obligation through date.
- `cost_share_payments`: award_id, date, amount, practice_id, sec126_choice (exclude, include, undecided), excludable amount computed with inputs (affected acres, prior 3-year income, discount rate), recapture-watch end date (plus 20 years). Optionally link to the existing `payments` table for income views.
- Link `timber_costs.cost_share_award_id` so M3 knows what to net out.

**Effort.** M.

#### M5. Sale workflow from planning to post-harvest

**What it is.** Extend `timber_sales` into a guided path with clear stages:
1. **Planning**: why sell (thinning due, salvage, final harvest), stands, forester hired, forester fee.
2. **Cruise and prospectus**: link a cruise (S2), estimated volume and value, minimum acceptable bid.
3. **Marketing**: sealed-bid date, bidders invited, bids received.
4. **Contract**: the existing contract fields, plus a key-clause checklist.
5. **Harvest**: start date, inspections (activity log entries), settlements (existing).
6. **Closeout**: BMP check, roads and skid trails, gates, deposit returned, final settlement reconciled.
7. **After the harvest**: replanting due date for a clearcut, creating planned activities and costs that feed M3. Thinning sales prompt "schedule next burn."

**Why it matters.**
- Alabama Extension: a consulting forester is "highly recommended," especially for owners who sell infrequently. Research shows forester-assisted sellers net more even after fees. Sealed bidding usually brings the best offer. A cruise before the sale sets the minimum bid (ACES FOR-2101 "How Timber Is Sold": https://www.aces.edu/blog/topics/forestry/how-timber-is-sold/). The Alabama Forestry Commission publishes "Alabama Timber Sale Contract Considerations" and a sample notice of sale (referenced in FOR-2101).
- Key clauses seen in Alabama sale notices and contracts: cut-and-removal deadline, performance deposit, payment terms (lump sum due at signing), BMP compliance, buyer responsible for volume estimates, boundaries and SMZ marking, closeout of skid trails, roads, and stream crossings, insurance and liability, and damage to residual trees and improvements (University of Alabama lands notices: https://universitylands.ua.edu/?p=368 ; ADCNR bid notices: https://www.outdooralabama.com/sites/default/files/Thigpen%20Hill%20Full%20Bid%20Notice%20and%20Map%20ADA%20Check.pdf ; ACES FOR-2101).
- Alabama BMPs: a streamside management zone of at least 35 feet each side of streams, marked before harvest and ideally before bids (ACES: https://www.aces.edu/blog/topics/forestry/timber-harvesting-guidelines-for-forestry-best-management-practices/ ; AFC water quality: https://afc.forestry.alabama.gov/water-quality-protection/).
- Selling expenses (forester fees, appraisal, legal) reduce taxable gain (FS-1275). Linking them here is what makes the M7 summary right.
- 1099-S: lump-sum standing timber sales (since 2009) and pay-as-cut sales are reportable on 1099-S, due to the seller by January 31 (NC State: https://content.ces.ncsu.edu/new-reporting-rules-for-lump-sum-timber-sales). Tracking "1099-S received, amount" lets the accountant reconcile.
- Tax form hints for the summary: investors report lump-sum sales on Form 8949 and Schedule D, and pay-as-cut on Form 4797 Part I and Schedule D. Timber held in a business uses 631(b) and Form 4797. The 631(a) election applies to cutting your own timber (FS-1275).

**Data model sketch.**
- `timber_sales` add: stage (planning, cruise, marketing, contract, harvesting, closeout, complete), forester_name and contact, forester_fee_pct or fee amount, min_acceptable_bid, bid_date, cruise_id, harvest_start, harvest_end, closeout_date, deposit_returned_date, reforestation_due_date, form_1099s_amount, form_1099s_received.
- `timber_sale_bids`: sale_id, bidder (free text or tenant link), amount, received date, is_winner, notes.
- `timber_sale_checklist`: sale_id, item_key (from a built-in list of contract clauses and closeout items), status (yes, no, not applicable), note. The list lives in app code, like product classes.
- Inspections are `stand_activities` of type inspection with timber_sale_id. Selling expenses are `timber_costs` with tax_category = selling_expense and timber_sale_id.

**Effort.** M.

#### M6. Document attachments everywhere in timber

**What it is.** Let the existing vault attach files to stands, activities, cost-share awards, timber accounts (basis evidence), cruises, plans, and sales. Add document types: cruise report, timber appraisal (including retroactive and date-of-death), management plan, seedling invoice, herbicide or burn prescription, burn permit, cost-share contract, 1099-S, settlement, closeout or BMP inspection, closing statement or estate appraisal.

**Why it matters.** Basis "evidence" is a document (closing statement, estate appraisal, cruise). USDA advises keeping basis records for the life of ownership plus the period the return stays open. Every tax number in M2 to M4 should be one click away from the paper behind it.

**Data model sketch.** Extend the documents entity_type check and the doc type taxonomy (the existing taxonomy completeness test will enforce coverage). The AI upload path that already routes timber contracts and settlements can learn cruise reports and cost-share contracts later.

**Effort.** S.

#### M7. Accountant-ready annual timber tax summary

**What it is.** One page per owner entity per tax year, as PDF and CSV, with source documents listed:
- Timber sales: buyer, sale type (lump sum or pay-as-cut), contract date, gross proceeds received this year, 1099-S amount, selling expenses, depletion (from M2), net gain, holding period over 1 year (yes, or inherited), and a suggested form (8949 and Schedule D, or 4797).
- Reforestation: eligible costs per QTP, cost-share netted, the 194(b) expense amount, and this year's amortization from prior years' schedules.
- Cost-share received: by program, with the Sec 126 choice and computed excludable amount, and a statement draft.
- Operating expenses and carrying charges by category (forester, herbicide, burning, firebreaks, travel), with a note on investor vs business treatment.
- Property taxes on timber parcels (from the existing taxes module).
- Casualty losses (from S4) with basis limit.
- A flag: "Form T likely required" when depletion is claimed or sales are frequent.
- Open questions for the accountant (for example "was this a business or investment?").

**Why it matters.** This is the moment a family feels the value. FS-1275 shows taxes depend on classification (personal, investment, business), and each changes forms and deductions. Most owners sell rarely and cannot remember the rules. Handing a clean packet to the CPA is the payoff that justifies every record above. No family-focused tool found in this research produces one.

**Data model sketch.** Read-only, computed from M1 to M5 plus existing sales, settlements, payments, and tax statements. Optional `timber_tax_years` per owner entity: tax_year, classification (personal, investment, business), sec266_capitalize_carrying_charges flag, 631(a) election in effect, accountant notes, finalized_at (locks numbers once filed).

**Effort.** M (after M1 to M4).

### SHOULD-HAVE

#### S1. Management plan and schedule of recommended activities

**What it is.** A plan record (who wrote it, date, type such as AFC Stewardship, NRCS CAP 106, ATFS, or consultant plan, objectives, expiry or review date, PDF) plus a list of recommended activities by stand with target year or season. Most families will not have a plan, so Turnrow generates a starter schedule from **templates by stand type and age** that the owner or their forester can edit.

**Why it matters.**
- AFC Forest Stewardship requires a written plan, 10 or more forest acres, and leads to TREASURE Forest recognition (https://www.forestry.alabama.gov/Pages/Management/Stewardship.aspx ; https://forestry.alabama.gov/Pages/Management/TreasureForest.aspx). ATFS certification requires a current written plan meeting its standards (https://treefarmsystem.org/landowners/how-it-works). NRCS funds CAP 106 plans.
- Timing drives value. Mississippi State models first thinning of loblolly at about age 17, 14, and 13 for site index 60, 70, and 80 (base age 25), with second thinnings around 30, 22, and 21. A common first-thin window is 13 to 15, and delaying thinning lengthens rotations and cuts value (https://extension.msstate.edu/publications/protect-your-pine-plantation-investment-thinning). NC Forest Service gives first thinning 15 to 25 and final harvest 35 to 50 depending on site and goals (https://www.ncagr.gov/divisions/nc-forest-service/FM08/download).
- Thinning overstocked pine is the main defense against southern pine beetle. Alabama had about 12,000 SPB spots on 25,000 acres in 2024 (ACES FOR-2200, April 2026: https://www.aces.edu/blog/topics/forestry/bark-beetles-threatening-alabamas-forests/).

**Template example: planted loblolly** (defaults, editable):
- Year 0: site prep, plant (with a reminder to record costs for Sec 194).
- Years 1 to 2: herbicide release, survival check.
- Age about 12 to 17 (site index driven): first thinning, ask the forester to cruise first.
- After first thinning: prescribed burn every 3 to 5 years.
- Age about 20 to 25: second thinning, or fertilization if the forester recommends it.
- Age about 28 to 35: final harvest, then replant.
- Every year: walk boundaries and look for fading crowns in spring and summer (SPB).

Other templates: natural pine, upland hardwood, bottomland hardwood (mostly "protect and inspect," SMZ, select cut on forester advice), mixed, longleaf (burn-centric), and CRP pine (contract obligations).

**Data model sketch.**
- `forest_plans`: owner or property scope, plan_type, author, plan_date, review_by date, objectives text, document.
- `plan_recommendations`: plan_id (nullable when template-generated), stand_id, activity_type, target_year, target_season, priority, reason in plain language, status (upcoming, done, skipped, deferred), completed_activity_id (links to M1 when done).
- Templates live in code (`lib/timberTemplates.ts`), keyed by stand_type and origin, parameterized by plant year and site index.
- Surfaces: an "Upcoming on your land" card on the timber page and dashboard, a stand page timeline (past from M1, future from S1), and optional inclusion in the Morning Brief through the existing ops API.

**Effort.** M.

#### S2. Inventory and cruise records

**What it is.** Store each cruise or inventory: date, cruiser or forester, method (plot cruise, 100% tally, walk-through estimate), stands covered, and per stand per product the volume (tons or MBF), trees per acre, basal area, average DBH, site index observed, and an estimated value at the time. The full report goes in as a PDF. Plot-level data import (CSV from Forest Metrix and similar) comes later.

**Why it matters.** Cruises set the minimum bid (ACES FOR-2101), establish basis volume for depletion (M2), support casualty loss claims (S4), and support retroactive appraisals. They also give the "what is my timber worth" number families want.

**Data model sketch.**
- `timber_cruises`: date, forester, method, purpose (sale, basis, appraisal, management), total value estimate, price source, document.
- `timber_cruise_stands`: cruise_id, stand_id, acres cruised, TPA, basal area per acre, average DBH, average height, site index.
- `timber_cruise_products`: cruise_stand_id, product (the same product slugs as the sale form), volume, unit, log scale, price used, value.
- When a cruise is saved, the stand shows the latest TPA and BA, and the app offers to adjust timber account volumes (M2) as a volume_adjustment entry.

**Effort.** M.

#### S3. Price references

**What it is.** A small table of stumpage price references by product, region, and quarter, entered by hand from public reports, or imported if a license allows. Shown beside the rate fields on the sale form ("South-wide Q4 2025 pine sawtimber averaged $23.23 per ton"), on cruises to value volume, and on the stand page as "rough value today."

**Why it matters.** Families have no sense of whether an offer is fair. TimberMart-South is the standard reference and is subscription-based. Public summaries exist from university extension: Southern Ag Today and Farms.com reported Q4 2025 pine sawtimber at $23.23 per ton and pine pulpwood at $5.96 per ton South-wide, with Alabama sawtimber about $17 to $21 per ton and down about 19% year over year (https://www.farms.com/news/pine-sawtimber-prices-soften-as-pine-pulpwood-continues-to-fall-237672.aspx ; https://thetimberlandinvestor.com/alabama-stumpage-timber-prices/). Arkansas and NC State publish free quarterly reports (https://www.uamont.edu/academics/CFANR/forestbusiness/1Q2026ATPR.pdf ; https://content.ces.ncsu.edu/north-carolina-standing-timber-price-report-2025). The app must label these as averages that vary widely by tract, access, and mill distance. A sealed-bid sale is the real price test.

**Data model sketch.** `timber_price_refs` (global, admin-maintained, not per org): source, region, period (year and quarter), product, unit, low, average, high, url, entered_at. Optional per-org overrides.

**Effort.** S (manual entry), M if an import is licensed.

#### S4. Forest health and casualty events

**What it is.** Mapped events: SPB spot, ips, annosus, storm or tornado, ice, wildfire, flood, theft or trespass cutting. Each has date found, mapped polygon or point, acres affected, severity, status (watching, salvage planned, salvaged, resolved), linked salvage sale, and an optional casualty loss worksheet.

**Why it matters.** SPB and ips can spread fast and look alike (ACES FOR-2200, above; Mississippi State on ips: https://accessibility.extension.msstate.edu/publications/ips-the-other-pine-bark-beetles). Casualty loss is the lesser of FMV decline and basis. It needs a professional appraisal, can be taken before a salvage sale, and salvage gain can be deferred as an involuntary conversion (FS-1275). Recording the event, photos, and appraisal at the time is what makes the claim possible later.

**Data model sketch.** `forest_events`: event_type, found_date, geom, acres, severity, status, stand links, timber_sale_id (salvage), FMV before and after (from appraisal), basis limit (from M2), proposed loss, document links. The loss posts to the timber account as a casualty_loss entry. This mirrors the `maintenance_issues` map pattern, so the map UX can be reused.

**Effort.** M.

#### S5. Richer stand records

**What it is.** Add fields to stands: origin (planted, natural, direct seeded), plant year (age computed), trees per acre planted, current TPA and BA (latest cruise), site index with base age and source (NRCS soil survey, forester, cruise), seedling genetics (open-pollinated, mass control, varietal), management goal (timber, wildlife, mixed, aesthetics), and an "under contract" flag (CRP, carbon, easement). Hide advanced fields behind "More details."

**Why it matters.** These are the fields any forester, plan, or cost-share application asks for first. Site index drives the thinning template (S1). Forest Metrix advertises NRCS soils site index by species as a field feature (https://forestmetrix.com/). Turnrow could pull soil-based site index automatically from SSURGO for the stand polygon.

**Effort.** S (fields), M with the soils lookup.

### LATER

| Feature | What and why | Effort |
|---|---|---|
| L1. Simple growth and value projection | Projected volume and value by year from site index and age using published loblolly yield tables, so families see "thin in 2029, about $X." Ecotrust's Forest Planner did this with FVS for the Pacific Northwest, and its code is now archived (https://www.github.com/Ecotrust/forestplanner), so the niche is open in the South. | L |
| L2. SMZ and BMP map layer | Auto-buffer streams (NHD) by 35 feet as a draft SMZ layer on stand and sale maps. Add firebreaks and burn units as line and polygon types. | M |
| L3. Prescribed burn records | A burn plan and prescription checklist, permit number, Certified Prescribed Burn Manager name. Alabama requires a permit, and liability protection needs a CPBM and a written, witnessed or notarized prescription (https://www.forestry.alabama.gov/Pages/Informational/Legal/Prescribed_Burn_Act.aspx ; https://forestry.alabama.gov/Pages/Fire/Burn_Permits.aspx). Partly covered by M1 details. | S |
| L4. Carbon and conservation contracts | Track contract terms that restrict harvests (Family Forest Carbon Program needs 30 or more acres of naturally regenerating, non-planted forest and operates in Alabama: https://familyforestcarbon.org/how-it-works/ ; NCX dropped its one-year small-tract product per Mississippi State: https://extension.msstate.edu/news/feature-story/2023/carbon-market-no-longer-serving-small-tract-forests). Carbon income is likely ordinary income (FS-1275). Warn when a planned harvest conflicts with a contract. Easements donated under 170(h) can be large deductions. | M |
| L5. Current use valuation status | Per parcel: Alabama Class III current use granted (yes or no, date). Applications go to the county between October 1 and January 1, need 5 or more acres, and once granted do not need renewal. Conversion triggers revaluation (https://www.revenue.alabama.gov/property-tax/current-use/). Fits the existing property taxes module. | S |
| L6. Certification readiness | ATFS and TREASURE Forest checklist showing what the plan and records already cover. | S |
| L7. Forester sharing | A limited role or share link so a consulting forester can view stands, add cruises, and add recommendations. Existing roles and entity access (migration 0034) are a base. | M |
| L8. Plot-level cruise import | CSV import from cruising apps to fill S2 automatically. | M |
| L9. Wildlife and hunting integration | Food plots, stands, and burns shown together. Hunting leases already exist, so link timber plans to lease notices (for example "harvest in Unit 3 next fall"). | S |
| L10. Severance tax lines | Alabama forest products severance tax is small (for example $0.10 per ton for pine logs) and usually handled by the buyer or mill, but it can appear on settlements and is a deductible selling cost (https://www.revenue.alabama.gov/tax-types/forest-products-severance-tax/). Capture it as a settlement deduction line. | S |

---

## 5. Product landscape (what others do)

| Product | Aimed at | Does well | Overkill or missing for families |
|---|---|---|---|
| MyLandPlan.org (American Forest Foundation) | Family woodland owners | Free map drawing, goals and task list, a private forest journal with photos, learning library (https://sref.info/articles/Care-for-Your-Forest-with-MyLandPlan.org ; https://treefarmsystem.org/mapyourland) | No costs, no basis, no sales, no tax. Much of the coverage is from 2012 to 2019 and activity appears to have slowed |
| Forest Metrix | Consulting foresters, timber buyers | Phone cruising, offline maps, NRCS soils with site index, reports. $649 to $1,299 per year (https://forestmetrix.com/) | Priced and designed for professionals. No landowner tax or plan view |
| iCruisePro, TCruise, StandTally, TwoDog | Cruisers and consultants | Field tally and volume math | Pure inventory tools |
| TRACT, Logger's Edge, StumpGeek, 3LOG | Loggers, procurement, mills | Load tickets, settlements, payables | Built for the buyer side. Turnrow's settlement import already covers what a landowner needs from tickets |
| HuntStand Pro, onX Hunt | Hunters and hunting land managers | Maps, satellite change detection (shows thinnings and clearcuts), stands and blinds, group editing, about $30 per year (https://app.huntstand.com/about ; https://www.onxmaps.com/land-management) | No timber records or money |
| LandGate LandApp | Landowners curious about value | Parcel data, land and lease value estimates (https://www.landgate.com/landapp/land-owners) | Not a management or records tool |
| Ecotrust Forest Planner and Landmapper | Pacific Northwest family owners | Free stand-level scenario modeling with FVS, plan maps (https://nnrg.org/informing-forest-stewardship) | Regional, and the Forest Planner code is archived |
| Avenza Maps | Foresters and owners in the field | Offline georeferenced PDF maps with GPS (general knowledge, not separately sourced) | Maps only |
| TreePlotter (PlanIT Geo) | Cities, urban tree inventory | Tree-by-tree inventory | Wrong audience |
| Trimble Forestry, Silvacom and other enterprise suites | TIMOs, REITs, industry | Full land, inventory, harvest, and accounting systems | Massive overkill, enterprise pricing |
| Extension spreadsheets and account books | Families | Maryland EB-360 Forest Management Account Book (https://extension.umd.edu/sites/extension.umd.edu/files/2022-08/EB-360_Forest_Management_Account_Book.pdf), Mississippi State tree farm journal, UNH Timber Basis Decision Model (https://extension.unh.edu/resource/timber-basis-decision-model-documentation-online-calculator) | Accurate but disconnected from maps, documents, and sales. Easy to abandon |

**The gap.** Nobody combines (a) a map of stands, (b) a dated activity and cost history, (c) timber basis, depletion, Sec 194, and Sec 126 math, (d) the sale and settlement trail, and (e) a CPA-ready summary in one family-friendly place. Professionals have cruising tools. Hunters have mapping apps. Families have a shoebox and an extension PDF. Turnrow already has (a), (d), documents, owner entities, property taxes, and an AI document intake. Adding (b), (c), and (e) is the differentiator.

---

## 6. Keep it simple: design principles

1. **Start with what they already did, not what foresters track.** The first prompt on a stand is "What has happened here?" with big buttons (Planted, Sprayed, Burned, Thinned, Harvested, Storm or bugs, Walked it, Something else). Each opens a short form with sensible defaults. Advanced fields (chemical rate, genetics, BA) sit behind "More details."
2. **Every cost asks one plain question, and the app sets the tax category.** For example: "Was this to get new trees growing?" means reforestation. "Was this to sell timber (forester fee, legal)?" means selling expense. "Was this upkeep (burning, firebreaks, spraying older stands)?" means operating expense. Show the resulting tax category small and editable, with a "Your accountant decides" note.
3. **Templates by stand type fill in the future.** When a stand has a type and plant year, Turnrow proposes a schedule immediately (S1). The owner accepts, edits, or dismisses. Never a blank plan.
4. **Suggest, then confirm** (the project's standing rule). Depletion amounts, stand matches, Sec 126 exclusions, and template activities are proposals with "Use this" buttons, never silent writes.
5. **One number per screen that matters.** The stand page leads with age, acres, and the next recommended activity. The timber account leads with "Basis left: $X ($Y per ton)." The tax year leads with "Taxable timber gain: $X."
6. **Plain words first, the tax term second.** Write "Your cost in the timber (basis)", "Tax recovery when you sell (depletion)", "Replanting deduction (Section 194)." The glossary pops up on tap.
7. **Basis setup is a guided interview, once per tract.** It asks how the land was acquired (bought, inherited, gift, put into the LLC), when, and the price or value. It then asks whether there was a timber cruise or appraisal at the time. If not, it says plainly that "a forester can do one now and work backward," and creates a to-do. Skippable, with a persistent gentle reminder before any sale.
8. **The sale flow is a checklist, not a form.** Seven stages with three to six items each. Contract clauses are a yes/no list the owner can print for the forester or attorney.
9. **Reuse what the app already knows.** Acres from the map, owner entity from the property, property taxes from the taxes module, FSA farm number from FSA farms, settlements from uploads, documents from the vault. Ask only for what is missing.
10. **Progressive depth.** Level 1: stands, activities, upcoming work. Level 2: costs and sales. Level 3: basis and tax summary. Owners who never open level 3 still get value. Owners who do get the payoff at tax time.
11. **Never claim to be tax advice.** Each tax screen carries one short line: "For your accountant. Confirm with them before filing." Show sources in the help topics.
12. **Year-end nudge.** In December or January: "You sold timber this year. Here is your packet for your accountant," with a list of missing items (no basis set, a 1099-S not entered, costs not categorized).

---

## 7. Open questions for the owner

1. **Who files?** Which owner entities hold the timber (individuals, family LLC, trust, partnership)? The tax summary must be per taxpayer, and trusts cannot use the 194(b) immediate deduction.
2. **Investment or business?** Does the family treat timber as an investment (most do) or a trade or business? This changes forms, expense deductibility, and whether Form T is routine.
3. **Acquisition history.** For each property: bought, inherited (date of death), or gifted? Were timber appraisals done at purchase or at the estate? Do you have closing statements or estate appraisals on S: to attach?
4. **Past reforestation.** Were any stands planted in the last 8 years? Their costs may still be amortizing, or were never claimed.
5. **Cost-share history.** Any EQIP, CRP, or AFC SPB contracts now or in the past? Any still under a maintenance obligation or inside the 20-year Sec 126 recapture window?
6. **Consulting forester.** Is there a forester you use? Would you want them to have a login (read and add cruises and recommendations)?
7. **Existing plans.** Do any properties have a Stewardship, CAP 106, or Tree Farm plan? Should Turnrow import its recommendations?
8. **Price data.** Would you pay for a TimberMart-South subscription so the app can show region-specific prices, or are free extension summaries enough?
9. **How much tax detail on screen?** Full ledger visible to all family members, or only to admins and the accountant?
10. **Accountant access.** Should the accountant get a read-only export link, or just the PDF and CSV?
11. **Hardwood strategy.** Are the hardwood stands managed for timber, wildlife, or left alone? This sets which template they get.
12. **Carbon or easements.** Has anyone approached you about carbon credits or a conservation easement on any tract?
13. **Priority check.** Do you agree that basis, costs, and the tax summary come before management plan templates, given that no sales are recorded yet but sales are coming?

---

## Key sources

- USDA Forest Service FS-1275, Tax Tips for Forest Landowners: 2025 Tax Year (Jan 2026): https://timbertax.org/publications/fs/taxtips/2025-tax-tips.pdf
- Forest Landowners' Guide to the Federal Income Tax, Ag Handbook 731: https://research.fs.usda.gov/treesearch/42921 and chapters at https://timbertax.org/publications/aghandbook731/
- Rural Tax Education, Timber Tax Basics 2026 (van der Hoeven): https://www.farmers.gov/sites/default/files/documents/timber-tax-basics-for-landowners-2026.pdf
- IRS Form T instructions: https://www.irs.gov/instructions/it
- 26 USC 194: https://www.govinfo.gov/link/uscode/26/194 ; 26 CFR 16A.126-1: https://www.law.cornell.edu/cfr/text/26/16A.126-1
- Mississippi State P1983 (basis, retroactive appraisal): https://extension.msstate.edu/sites/default/files/publications/P1983%20revised%202023_web.pdf
- Mississippi State thinning: https://extension.msstate.edu/publications/protect-your-pine-plantation-investment-thinning
- ACES FOR-2101 How Timber Is Sold: https://www.aces.edu/blog/topics/forestry/how-timber-is-sold/
- ACES BMP harvesting guidelines: https://www.aces.edu/blog/topics/forestry/timber-harvesting-guidelines-for-forestry-best-management-practices/
- ACES FOR-2200 Bark Beetles (2026): https://www.aces.edu/blog/topics/forestry/bark-beetles-threatening-alabamas-forests/
- NC State 1099-S rules: https://content.ces.ncsu.edu/new-reporting-rules-for-lump-sum-timber-sales
- Alabama Forestry Commission: Stewardship https://www.forestry.alabama.gov/Pages/Management/Stewardship.aspx , Cost share https://forestry.alabama.gov/Pages/Management/CostShare.aspx , Burn permits https://forestry.alabama.gov/Pages/Fire/Burn_Permits.aspx
- Alabama DOR current use: https://www.revenue.alabama.gov/property-tax/current-use/
- Family Forest Carbon Program: https://familyforestcarbon.org/how-it-works/
- Price summaries: https://www.farms.com/news/pine-sawtimber-prices-soften-as-pine-pulpwood-continues-to-fall-237672.aspx ; https://thetimberlandinvestor.com/alabama-stumpage-timber-prices/
