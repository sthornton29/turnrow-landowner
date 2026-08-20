# Turnrow Landowner: Project Summary

Last updated: 2026-08-20 (utility easements became polygon boundaries,
migration 0017; timber sale contracts and logger settlements with AI
extraction, allocation across stands, migration 0018; one Settings
page; map-first landing; logo-only banner; Taxes renamed Property
Taxes; print item exclusions)

## What this product is

Turnrow Landowner is commercial software for rural landowners (farmland first,
timberland and ranchland too) who lease their property out rather than farm it
themselves. Landowners see their property on a satellite map, track boundaries
and acreage, and in later phases manage leases, taxes, assets, and tenant farm
data. Multi-tenant from day one: every landowner account is an "organization"
and Postgres row level security guarantees each org sees only its own data.

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind CSS 4
- Supabase: Postgres (PostGIS enabled), auth, file storage, via @supabase/ssr
- Vercel hosting, deployed from the main branch of GitHub repo
  sthornton29/turnrow-landowner
- Mapbox GL JS 3 (satellite-streets-v12 style) + @mapbox/mapbox-gl-draw
- File parsing: shpjs (zipped shapefiles), @tmcw/togeojson (KML), jszip (KMZ)
- Anthropic API (claude-sonnet-4-6) planned for AI document extraction in
  Phase 3+
- Mobile-first responsive PWA (manifest + icons wired; no service worker yet)
- @turf/area for geodesic pre-import acre estimates in the GIS proxy;
  @turf/intersect, difference, union, buffer, simplify for Timber Scan
  clipping and the split tools; geotiff + proj4 for CDL raster decode
  and EPSG:5070 <-> 4326 reprojection
- xlsx (SheetJS) for reading Excel/CSV logger settlement exports
  server-side in /api/extract
- Vitest (dev only) for unit tests: npm test runs every *.test.ts under
  lib/ (owner names, spatial reference, property matching, GIS where
  clauses, lease land matching, timber scan raster pipeline, price
  expressions, RMA parsing, lease pricing, crop matching, tenant data
  aggregation, lease logic, income projections, pivot geometry,
  easement line-to-polygon buffering, timber settlement spreadsheet
  collapse + MBF/Doyle handling, timber allocation math)

## Environment variables (local .env.local and Vercel)

- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY
- NEXT_PUBLIC_MAPBOX_TOKEN
- ANTHROPIC_API_KEY (server-side only, no NEXT_PUBLIC_ prefix; used by
  /api/extract for AI document extraction with claude-sonnet-4-6)
- FARM_API_BASE_URL (Phase 6; base URL of the farm software's partner API,
  e.g. https://<farm-domain>/api/partner/v1, no trailing slash)
- FARM_API_ENCRYPTION_KEY (Phase 6; 64 hex chars, AES-256-GCM key that
  encrypts farm API tokens at rest in farm_connections)
- CRON_SECRET (Phase 6; shared secret Vercel sends when invoking the
  /api/farm/sync cron; the route rejects anything else)
- SUPABASE_SERVICE_ROLE_KEY (Phase 6; used ONLY by the cron sync, which
  runs with no signed-in user and scopes every query itself)

## Database schema (migrations 0001_phase1_schema.sql, 0002_phase2_timber_roads_assets.sql)

All geometry columns are geometry(MultiPolygon, 4326). Acres are computed by
Postgres in a stored generated column: st_area(boundary::geography) /
4046.8564224, so acreage can never drift from the shape. Every table carries
organization_id and is protected by RLS ("organization_id =
private.user_org_id()").

Tables:

- organizations: id, name
- profiles: id (= auth.users id), organization_id (nullable until invited
  user joins), role (owner | member), full_name, email. Auto-created by a
  trigger on auth.users insert. Users may only update their own full_name
  directly (column-level grant); org/role changes go through functions.
- invites: organization_id, email, role, accepted_at. Unique per (org, email).
- properties: name, county, state, notes, boundary, acres (generated),
  unique (id, organization_id) as a composite-FK target. Migration 0010
  adds fsa_numbers text[] (optional FSA farm numbers, several per
  property; entered comma-separated, shown as chips on the property
  page, in the list line, and in the map click panel; the shared
  EditField "list" flag in FeaturePanel/RowEditor handles the
  comma-string <-> array conversion)
- parcels: property_id, parcel_number, county, notes, boundary, acres.
  Composite FK (property_id, organization_id) -> properties (id,
  organization_id) makes cross-tenant references impossible.
- fields: property_id, name, notes, boundary, acres. Same composite FK.
  ALWAYS LABELED "Ag Fields" in UI text (nav, layers, dialogs, lists,
  tiles); tables, columns, and code identifiers stay `fields`.
  Migration 0014 adds irrigated_acres: DERIVED in PostGIS as the field
  boundary intersected with the UNION of active irrigation coverage
  polygons (pivot plantable shapes + laterals; union means overlapping
  pivots count once), recomputed by row triggers on irrigation asset
  geometry changes (org-wide) and field boundary changes (that field),
  never on read; dryland = acres - irrigated, computed in the app.
  lib/geo/irrigation.ts mirrors the same rule for unit tests (fully
  inside, partial overlap, overlapping pivots counted once). Shown on
  the ag field summary page, map click panel, property rollup, and a
  dashboard Irrigated acres tile.
- pastures (migration 0014): a land type mirroring fields (property_id
  required, name, notes, MultiPolygon boundary, generated acres, RLS,
  composite FK, pastures_geo view, set_geometry + documents entity_type
  gain 'pasture'). Present but not emphasized: appears in the boundary
  save dialog, imports, map layer (warm tan #d2b48c + labels + legend
  toggle), property detail section, dashboard acres tile, and a
  /pastures/[id] summary page. FUTURE AREA: no grazing management
  features yet (deliberate).
- utility_easements (created as lines in 0016, POLYGON BOUNDARIES since
  migration 0017): powerline/pipeline/other corridors, ALWAYS labeled
  "easement" (a pipeline easement is the utility's corridor, never the
  farm's own underground irrigation pipe asset). organization_id,
  property_id NULLABLE (easements cross property lines; property
  deletion DETACHES via set null, a deliberate departure from roads'
  cascade), name, easement_type check, holder, recorded_ref, notes,
  MultiPolygon boundary with the same generated acres column as every
  land type. Migration 0017 converted existing centerlines by
  buffering to half their width_ft (geography buffer, true ground
  feet; null widths used a 50 ft default, got a visible note appended,
  and were listed in migration NOTICEs) then dropped the line columns
  (geom, width_ft, length_feet, miles). lib/geo/easementBuffer.ts
  mirrors the buffering rule for unit tests. RLS, geo view,
  set_geometry polygon branch + documents 'utility_easement' (easement
  deeds are exactly the documents landowners lose; the summary page
  says so). Drawn via the BOUNDARY dialog's "Easement" type with
  inline fields (type, holder, recorded ref, notes; session-persistent
  like the timber fields; property optional), multi-area supported;
  map layer (persisted toggle): translucent per-type strips (fill
  0.18) with dashed outlines, powerline red #dc2626 long-dash,
  pipeline safety orange #f97316 dot-dash, other gray, per-type
  legend swatches; click panel and /easements/[id] show acres, holder,
  recorded ref, documents.
- wetlands (migration 0015): same pattern as pastures, for OPEN
  wetlands only (marsh, sloughs, duck holes, WRP/easement ground;
  labels and dialog help text say so). Forested bottomland remains a
  timber stand (hardwood with the wetland note); no timber behavior
  changed. Map color muted steel blue #6487a8 (checked distinct from
  kelly, every crop color, the timber palette including planted pine
  teal #0f766e and other-gray #6b7280, pivot light blue, pasture tan,
  entity outlines). Appears everywhere pastures do plus
  /wetlands/[id]. FUTURE AREA: no wetland program management features
  yet (deliberate).
- documents: generic attachments via entity_type + entity_id
  (entity_type check now covers property, parcel, field, timber_stand,
  road, asset; Phase 3+ adds lease, timber_sale, tax_statement). Files live
  in the private "documents" storage bucket under
  <organization_id>/<entity_type>/..., with storage RLS keyed on the first
  path segment. Asset PHOTOS are simply documents with image content
  types; the UI shows images as a gallery and other files as a list.

Phase 2 tables (all with the same org RLS + composite property FK):

- timber_stands: property_id (required), name, stand_type (planted_pine |
  natural_pine | hardwood | mixed | other), species, year_established,
  site_index, last_thinning_year, last_burn_year, notes, MultiPolygon
  boundary, generated acres.
- roads: property_id (required), name, road_type (gravel | dirt | paved |
  field_road | other), notes, MultiLineString geom, generated length_feet
  and miles.
- assets: ONE table with a type system. property_id (nullable),
  asset_type (well, irrigation_pivot, underground_pipe, riser, shop,
  shed, barn, grain_bin, house, fence, pond_dam, other; an
  irrigation_lateral type existed briefly in 0013 and was removed in
  0015 with zero rows), name (only required field), geometry accepting Point/Line/Polygon, year_installed, condition
  (excellent/good/fair/poor), estimated_value, notes, details jsonb
  (type-specific fields validated in the app against lib/assetTypes.ts,
  which drives the dynamic forms and panels), parent_asset_id
  (self-reference: pivot/riser/pipe links to its supply well; composite FK
  keeps it in-tenant), is_active (deactivate instead of delete to keep
  history).
- Views timber_stands_geo / roads_geo / assets_geo mirror the Phase 1 *_geo
  pattern. public.set_geometry(entity_type, id, geojson) generalizes
  set_boundary to every entity type (polygon types incl. utility
  easements since 0017 / line types roads / any for assets, validated
  per type); the app writes all geometry through it.

Phase 3 tables (migration 0003; all with org RLS + composite FKs):

- tenants: name, contact_person, phone, email, mailing_address,
  insurance_on_file + insurance_expires (drives insurance badges and the
  hunting lease warning), notes. One tenant holds many leases.
- leases: tenant_id (restrict delete), lease_type (agricultural | hunting),
  name, status (draft | active | expired | terminated), start/end dates,
  auto_renew, termination_notice_days, rent_structure (cash | flex |
  crop_share; null for hunting), terms jsonb (structure-specific fields
  defined in lib/leaseLogic.ts, same pattern as asset details),
  payment_schedule jsonb (1-4 entries: label, month/day, percent or fixed
  amount), special_provisions.
- lease_lands: lease -> property (+ optional field) with editable
  leased_acres (prefilled from GIS acres; contract acres often differ).
  Total leased acres rolls up from these links.
- lease_year_assumptions: per (lease, year) jsonb for projections (flex
  bonus estimate; crop share holds a crops ARRAY, one entry per crop
  grown that year with crop/acres/yield/price/shared expenses plus
  per-value provenance tags; rows saved in the pre-multi-crop
  single-crop shape still read via lib/leaseLogic.ts cropAssumptions()
  and projected rent sums the entries).
- timber_sales: sale_name, buyer_name (free text) + optional
  buyer_tenant_id, sale_type (lump_sum | pay_as_cut), status, contract
  date, harvest_deadline, performance_deposit, sale_acres, lump_sum_price,
  stumpage_rates jsonb, payment_schedule jsonb (split lump sums: label,
  due_date, amount). Migration 0018 adds harvest_type (clearcut |
  first_thinning | second_thinning | select_cut | salvage | other),
  delivered_net boolean (delivered-price arrangements: mill price minus
  cut-and-haul model as pay_as_cut with per-product NET rates and this
  flag, no separate structure), and allocation_method (by_acres default
  | manual | none). Products cover the Southeast list: pine sawtimber,
  pine chip-n-saw, pine pulpwood, hardwood sawtimber, hardwood
  pulpwood, poles/pilings, veneer/peeler, crossties, topwood/chips,
  plus custom slugs. Rate entries are { product, label, rate, unit
  ('ton' default | 'mbf'), log_scale (doyle default | scribner |
  international, MBF only) }; pre-0018 { price_per_ton } rows read
  forever via normalizeStumpageRate in lib/leaseLogic.ts.
- timber_sale_stands: join to Phase 2 timber_stands; 0018 adds
  allocation_pct (manual allocation percentages).
- timber_settlements: pay-as-cut entries (date, lines jsonb, stored
  total_amount, check number; 0018 adds period_start/period_end and an
  allocation jsonb override: null inherits the sale's method, else
  { method, percents }). Lines are { product, label, quantity, unit,
  rate, amount, load_count?, date_from?, date_to? }; legacy
  { tons, price_per_ton } rows read via normalizeSettlementLine.
  Settlements count directly as received timber income; not duplicated
  into payments. Allocation math lives in lib/timberAllocation.ts
  (unit-tested): by_acres splits by mapped stand acres (equal split
  when no stand has acres), manual uses stored percentages as-is
  (under-100 leaves a remainder unallocated), rounding drift lands in
  the last stand so cents add back up.
- expected_payments: generated rows (year, label, due_date,
  expected_amount) referencing exactly one of lease_id / timber_sale_id.
  Generated by the app (lib/leaseLogic.ts) from terms + schedule +
  assumptions; regeneration deletes/recreates ONLY rows with no payments
  attached. Status (upcoming / due soon 30d / past due / paid / partial) is
  computed, not stored. Rows are individually deletable in the payments
  section (recorded payments against a deleted row become unscheduled
  via the set-null FK). Generation is OPTIONAL for income projections
  (see /income); it exists for dated installments to track and record
  against.
- payments: actual receipts (date, amount, method/check, memo), optionally
  linked to an expected_payment, or unscheduled against the lease/sale.
- documents entity_type check extended with tenant, lease, timber_sale.

Phase 4 tables (migration 0004; org RLS + composite FKs; also adds the
missing unique (id, organization_id) on parcels):

- county_tax_defaults: per-county editable due/delinquent month+day.
  App fallback is the Alabama calendar (due Oct 1 of the tax year,
  delinquent Jan 1 following; a delinquent month at or before the due
  month means next calendar year). lib/tax.ts applies these.
- tax_statements: parcel_id nullable until matched (unmatched statements
  await resolution), tax_year, county/state/authority, parcel number and
  owner name kept verbatim as printed, assessed_value, amount_due,
  due_date, delinquent_date, notes. unique (parcel_id, tax_year) with a
  friendly duplicate error in the UI; status (unpaid / partially paid /
  paid / delinquent) is COMPUTED from tax_payments vs amount_due, never
  stored. Statement PDFs/photos attach via documents (entity_type
  tax_statement).
- tax_payments: paid_date, amount (partials supported), method/check,
  memo. Batch payment from the completeness view writes one row per
  selected statement sharing date and check number.

Phase 5 (migration 0005):

- profiles.is_platform_admin (settable only via SQL; profile updates are
  column-restricted) + private.is_platform_admin() for RLS.
- county_gis_services: the app's first GLOBAL table (no organization_id).
  All authenticated users read it; only platform admins write. Columns:
  state, county, display_name, ArcGIS service_url + layer_id, field
  mappings (parcel_field, owner_field, acres_field, situs_field), status
  (active | broken | untested), last_verified_at, notes. Seeded with
  Lawrence and Colbert County, Alabama (KCS-hosted MapServers behind the
  counties' ISV viewers), both live-verified during the build. Migration
  0008 seeds five more live-verified Alabama counties: Morgan (web5 KCS),
  Lauderdale (web5 KCS), Limestone (county-run ArcGIS at
  gis.limestonecounty-al.gov, KCS-built data, no deeded-acres field so
  acres_field is null and the app computes GIS acres), Madison (web3 KCS
  behind the login-gated revenue ISV; the MapServer itself is public;
  owner field PropertyOwner), and Franklin (web6 KCS, layer 105, parcel
  field ParcelID_GISlink). Each was verified with layer metadata, a
  sample record, and an owner LIKE query returning f=geojson parcels.
- parcels gains deeded_acres (county-supplied, shown beside computed GIS
  acres) and source (attribution text); parcels_geo view recreated with
  both.
- set_property_boundary_from_parcels(property_id): sets a property's
  boundary to the ST_Union of its parcels' boundaries (SECURITY INVOKER).

Phase 6 tables (migration 0006; org RLS + composite FKs; no geometry, the
farm API shares no boundaries, matching is by name + acres):

- farm_connections: one row per redeemed farmer share. label,
  api_key_encrypted (AES-256-GCM via lib/farmCrypto.ts, never plaintext),
  status (active | error | revoked), scopes jsonb (fields/plantings/yields
  booleans from the handshake), operation_name, landowner_name,
  field_count, last_synced_at, last_error (plain-language, shown in the
  UI), unique (id, organization_id).
- field_mappings: per (connection, remote_field_id). Snapshots of
  remote_name/remote_acres/remote_farm_name, and EITHER local_field_id OR
  local_property_id (both composite FKs), status (suggested | confirmed |
  ignored). Sync refreshes snapshots and inserts new remote fields with a
  best-guess suggestion (name similarity + acres within 10%) but NEVER
  changes a status; only the user confirms or ignores.
- farm_field_data: synced plantings/harvest per (connection,
  remote_field_id, crop_year, crop): planted_acres, irrigated_acres +
  dryland_acres (migration 0014; the partner /plantings payload carries
  the practice split), planting_date,
  varieties jsonb, harvested_acres, production_units (null when the farmer
  did not share yields), production_unit, yield_shared, raw payload jsonb.
  Upserted on every sync; the app always renders from this table so farm
  data keeps working when the farm software is unreachable.

Phase 6 server pieces:

- lib/farmApi.ts: typed client for the partner API (redeem, handshake,
  fields, plantings, production) with a 15s timeout; 403 share_revoked is
  recognized and mapped to a friendly "your farmer ended this share"
  state (connection status revoked, data retained).
- lib/farmSync.ts: syncConnection decrypts the token, pulls handshake +
  current-year plantings/production, upserts farm_field_data, refreshes
  mappings, records last_error on failure. Used by connect, the manual
  Refresh now button, and the cron.
- /api/farm/connect: POST a TRW-XXXX-XXXX-XXXX code; redeems it (one-time
  on the farm side), encrypts the returned token, creates the connection,
  runs the first sync.
- /api/farm/sync: POST (signed-in user, one or all connections) and GET
  (Vercel cron, Bearer CRON_SECRET, service-role client). vercel.json
  schedules it every 6 hours; proxy.ts exempts the path from auth
  redirects.

Entity level (migrations 0007 and 0009; org RLS, same policy pattern):

- entities: the ownership level above properties (families hold land in
  LLCs, corporations, trusts, and their own names). name, entity_type
  (individual | llc | corporation | partnership | trust | estate |
  other), notes; unique (id, organization_id) as a composite-FK target.
  UNIFIED with the county-records owner matching: migration 0007
  created this table as owner_entities; 0009 renamed it, so a confirmed
  county grouping and a title-holding entity are the same row (migrated
  rows got a best-guess entity_type from their name, user-correctable;
  lib/entities.ts guessEntityType mirrors the guess for new imports).
- entity_aliases (renamed from owner_aliases; entity_id composite FK):
  alias (verbatim as the county printed it), normalized_alias
  (canonical form from lib/ownerNames.ts), source_county, source_state.
  Unique (organization_id, normalized_alias) makes re-imports
  idempotent. Written when the user imports from an owner group in the
  county import; later entity searches pre-group records whose
  normalized owner matches a known alias and show a "Known entity"
  badge. Available for later reuse by the tax statement upload's owner
  matching, but the tax upload flow is unchanged.
- properties.entity_id: nullable composite FK to entities (a landowner
  with land in their own name is never forced to create an entity).
  Deleting an entity detaches its properties via the column-list form
  of on delete set null (PG15+), which clears only entity_id.
  properties_geo recreated with entity_id appended.
- documents entity_type check gains 'entity' (operating agreements,
  formation docs on the entity page).
- Future ideas, deliberately out of scope for now: ownership
  percentages/members within an entity, inter-entity leases, per-entity
  user permissions.

Lease price methods (migration 0012; price_method lives in leases.terms
jsonb): crop share and flex leases record HOW their average crop price
is established, and the app fills each year's price assumption from the
right source, always reviewed (amber until saved) and never auto-saved:

- manual (default, today's behavior); tenant_average (farm connection);
  rma_benchmark (public USDA data, zero connections needed); custom
  (AI-designed recipe, deterministically computed). The lease AI
  extraction suggests the method from the pricing clause and stores the
  clause verbatim in terms.pricing_clause for recipe setup.
- tenant_average: the partner API's Part A scopes (projected_prices,
  projected_yields, opt-in and default OFF on the farm side) sync into
  farm_marketing_prices (one aggregate number per crop by design:
  price, unit, is_final, as_of) and farm_projected_yields (per shared
  field x crop, basis expected|actual) alongside the normal cron +
  manual refresh; /farms cards show scope chips. Scope off / no
  connection is a quiet explanatory line, never an error, never an
  in-app request. Served on the lease page by the TENANT DATA PANEL
  (below), which superseded the old single-crop price card.
- STRICT CROP MATCHING (lib/crops.ts, unit-tested): tenant crop names
  and lease assumption crops are entered independently, so every
  tenant-data lookup keys through canonicalCrop/sameCrop/matchCrop
  (case-insensitive, trim, singular/plural tolerant, small synonym map:
  beans=soybeans, maize=corn, winter/spring wheat=wheat, rape/rapeseed=
  canola, milo/grain sorghum=sorghum, upland cotton=cotton). A card can
  never render a price whose crop does not match its row (the old card
  fell back to "any priced crop" and once showed a canola price on a
  wheat row); rmaConfigForCrop is equally strict once a crop is typed.
  Unmatchable tenant crops show under their own tenant-named row.
- MULTI-CROP ASSUMPTION YEARS: a crop share year holds one or more
  CropAssumption entries (wheat and canola on the same leased ground);
  the year row renders one sub-row per crop with + Add crop / Remove,
  and projected rent sums the entries (any started-but-incomplete entry
  keeps the year Incomplete). Legacy single-crop rows read untouched
  via cropAssumptions(); saving rewrites in the crops-array shape. No
  SQL migration (jsonb only). RMA and custom-recipe price cards render
  per crop entry, keyed to that entry's crop.
- TENANT DATA PANEL (components/leases/TenantDataPanel.tsx, aggregation
  in lib/tenantData.ts, unit-tested): sits above the assumption rows on
  crop share and flex leases with a mapped connection. One row per crop
  the tenant planted that crop year on this lease's ground (lease_lands
  resolved through confirmed field_mappings; property-level links cover
  all mapped fields on the property): crop (with a "not in this year's
  crops" chip when unmatched), planted acres on leased ground, yield
  labeled PROJECTED (tenant projected, acre-weighted) or ACTUAL (once
  harvested; actuals win), avg price with PROJECTED/FINAL badge and
  as-of date. PRACTICE SPLIT: when the farm data carries the
  irrigated/dryland breakout (plantings acres + projected-yields
  practices arrays), the panel shows one row per crop x practice and
  "Use all" creates practice-split assumption entries
  (CropAssumption.practice: irrigated | dryland | blended, default and
  legacy = blended; the year row has a practice select per entry and
  projected rent sums entries as before, unit-tested). ACTUAL yields
  are NEVER practice-split: the partner /production payload carries no
  breakout, so a harvested crop collapses to one blended ACTUAL row
  (never fabricated; a farm-side API addition is the path to split
  actuals). Scope not granted renders a quiet "Not shared" (tooltip:
  the farmer controls sharing); crop/acres always work. Reads the local
  sync cache, shows last-synced, Refresh reuses /api/farm/sync. Fills:
  "Use all" fills matched crops (or every crop when the year is empty),
  plus per-row and per-cell Use buttons; every filled value lands amber
  and saves only when the row is saved. NO SILENT OVERWRITE: Use all
  never replaces a saved value; conflicting cells show "saved X" with
  an explicit Use. Hand edits after a fill always win. UNIT BOUNDARY:
  cents-per-lb prices (cotton) display as "82.90 c/lb (fills as
  $0.83/lb)" and always FILL in dollars per the yield's native unit,
  so acres x yield x price stays in dollars (a raw 82.90 once inflated
  a projection 100x). Blank payment-schedule rows are ignored by
  expected-payment generation (default annual payment fallback), never
  silently generating nothing. PROVENANCE:
  tenant-filled values save a source tag (tenant projected / tenant
  final / tenant actual, with as-of date) shown subtly under the crop
  sub-row; hand-editing a value clears its tag.
- rma_benchmark: lib/rma.ts implements grain-tracker/docs/RMA_PRICING.md
  and was live-verified 2026-08-17 (Alabama corn 2026: projected $4.42
  Released in the Jan 15-Feb 14 window, harvest In Discovery Aug 1-31
  against ZCU26). Defensive Atom parsing with loud shape-change errors
  and name-boundary anchoring (ProjectedPriceBeginDate must not shadow
  ProjectedPrice), pickPrimaryRow (Conventional practice, preferred
  type, earliest actuarial date), statuses authoritative with
  day-N-of-M running-average labels, the single unit-conversion
  boundary (canola x50 to $/bu, cotton native), staleness daily
  in-window / weekly idle, write-then-swap via /api/rma-price (cache
  reads as the user; cache writes via the service role; a failed fetch
  returns the cached value flagged stale, never blanks it; no_offer is
  data). Per-lease terms.rma_config rows: crop, state (defaults from
  the leased properties), formula projected|harvest|average (average
  preselected). Covers corn, soybeans, wheat, cotton, canola.
- custom: /api/price-recipe turns a pasted or extracted pricing clause
  into a recipe (description, typed inputs with source hints manual |
  rma_projected | rma_harvest | tenant_average and human guidance, and
  an arithmetic expression) reviewed amber and editable before saving
  into terms.custom_recipe; honest copy that the AI structures the
  clause but fetches no bespoke market data. Yearly "Compute price"
  auto-fills sourced inputs, takes manual ones with guidance, evaluates
  with lib/priceExpression.ts (hand-written tokenizer/parser, never
  eval; malformed expressions rejected at save time) and shows the
  substituted formula ("(4.66 + 4.2) / 2 + 0.10 = $4.53") with Use
  this price.
- Flex leases show the method's resolved price card beside the bonus
  estimate as reference; the bonus stays a user-entered number.
- Unit tests: priceExpression (precedence, malformed, division by
  zero), rma (fixture parse, shadowing, conversions, staleness,
  formula resolution with mixed statuses), leasePricing (tenant card
  states, strict no-cross-crop rule, final-then-freshest preference,
  config resolution), crops (normalization, synonyms, no-confident-
  match), tenantData (leased-ground acres aggregation, strict crop
  keying, actual-over-projected, acre weighting, scope-off cells,
  unmatched crops), leaseLogic (multi-crop rent summing, legacy
  single-crop reads, incomplete-entry rule).

Timber Scan (migration 0011 + /api/timber-scan + /timber-scan/[id]):

- Proposes timber stand boundaries for a property automatically, broken
  out into pine/hardwood/mixed/wetland-hardwood, from the USDA NASS
  Cropland Data Layer via CropScape (30m annual land cover; endpoints
  and forest class codes 141/142/143 live-verified during the build;
  190 woody wetlands maps to hardwood with a prefilled bottomland
  note). Geometry AND class both come from the raster; no vision model
  ever produces geometry.
- timber_scans table (org RLS, composite property FK): cached scan
  result jsonb per (property, cdl_year); Rescan forces refresh.
- Pipeline (lib/timberScan/, unit-tested against a synthetic fixture of
  the classic north Alabama layout): classify pixels per class ->
  gentle lone-pixel despeckle (1px hardwood drains survive) ->
  pixel-center clip to the property boundary -> per-class pixel-edge
  polygonization (own tracer; class borders are coincident by
  construction, verified in the fixture test; only lossless collinear
  merging, because lossy simplification would break that guarantee) ->
  holes under 1 acre filled, slivers under 2 acres dropped unless
  elongated ~5x (drain shapes kept) -> per-polygon composition readout
  from pixels ("92% pine, 8% hardwood") -> reproject 5070->4326 (proj4)
  -> exact vector clip to the property line and difference against
  saved stands (never proposes what is mapped) -> ag field overlap
  flagged over 1 acre.
- Review page /timber-scan/[id]: summary banner (wooded acres + per
  class breakout), draft proposals over satellite in DRAFT-only colors
  (amber pine, sky hardwood, violet mixed, teal wetland; dashed), chips
  with class/acres/composition, per-proposal accept / remove / merge
  (across classes, composition re-blended, dominant re-suggested) /
  vertex edit / split with a drawn line (thin-buffer difference), an
  honest-limitations panel (30m accuracy, sub-100ft drains, same-type
  merging, young plantings invisible), and a confirm form per accepted
  stand (name defaults Stand N, pine requires the planted/natural
  choice, species prefilled Loblolly for pine only, wetland note
  prefilled) saving through the normal insert + set_geometry path.
- AI assist (/api/timber-scan/vision): planted vs natural for pine
  proposals only, on demand per stand or all-at-once, one Mapbox Static
  zoom-16 image + one claude-sonnet-4-6 forced-tool call per stand,
  never automatic; suggestions prefill amber-highlighted and unclear
  suggests nothing.
- Entry points: Timber Scan button on property detail, the map's
  property click panel, and the /timber empty state. The split tool was
  also added for EXISTING saved stands (map panel Split button: draw a
  line, largest part keeps the record, other parts become new stands
  with copied info).

The farm side lives in the separate grain-tracker repo (the Turnrow farm
software): migration 070_partner_shares.sql, share management UI at
/settings/shares (farmer picks a landowner + yields on/off, gets a
one-time code, can revoke), share-scoped partner API endpoints, and
docs/PARTNER_API.md documenting the whole partner API.

Functions and views:

- private.user_org_id(), private.user_role(): SECURITY DEFINER lookups used
  by every RLS policy (avoids policy recursion on profiles).
- private.handle_new_user(): trigger, creates a profile at signup.
- public.accept_invite(): SECURITY DEFINER; attaches a newly signed-up user
  to the org that invited their email, marks the invite accepted.
- public.set_boundary(entity_type, id, geojson): SECURITY INVOKER (RLS
  applies); repairs geometry with st_makevalid, extracts polygons, wraps as
  MultiPolygon, saves, returns recomputed acres. The app writes ALL
  boundaries through this.
- Views properties_geo / parcels_geo / fields_geo (security_invoker = true):
  same rows plus boundary_geojson (st_asgeojson), because the REST API
  returns raw geometry as binary hex. The app reads boundaries only from
  these views.

## Tenancy and auth model (Phase 1 decisions)

- Signup is INVITE ONLY. Admin workflow for a new customer (Supabase SQL
  editor): insert an organizations row, then an invites row with the
  customer's email and role 'owner'. The customer signs up with that email;
  the onboarding page calls accept_invite() and connects them. Self-serve
  org creation (with a paywall) can be added later with a small migration.
- Org owners invite additional members from the Members page (no email is
  sent; the invitee just signs up with the same address).
- proxy.ts (Next 16's rename of middleware.ts) refreshes the Supabase
  session and redirects: logged-out users to /login, logged-in users with no
  org to /onboarding (via the (app) layout's requireOrg()).

## App structure

- app/(auth)/: login, signup, onboarding. Dark green (#14532d) background,
  stacked white logo.
- app/(app)/: authenticated shell. Header: white bg; the horizontal
  green logo stands ALONE (T mark on mobile; the "Landowner" wordmark
  came off the working banner 2026-08-20, and the auth pages keep
  their lockup). Tapping the logo goes home, which is the MAP: login,
  the root redirect, onboarding, proxy, and the PWA start_url all land
  on /map, and the nav order starts with Map, then Dashboard,
  Properties, Timber, Assets, Leases, Property Taxes, Income, Farm
  Data, Import, and a gear icon for /settings. Bottom tab bar on
  mobile (Map, Home, Properties, Leases, Income) with the gear in the
  top bar. ONE SETTINGS PAGE (/settings): Members section (list,
  invites, roles; owner-only invite form), Admin section (the
  platform-admin county GIS registry rendered inline via
  AdminGisClient embedded mode, platform admins only), and Sign out.
  /settings/members and /admin/gis redirect there.
  - /dashboard: stat tiles (total acres, properties, field acres, timber
    acres, wells, pivots, grain bins, buildings), static satellite
    thumbnail (Mapbox Static Images API) linking to the map, quick links.
    When the org holds land in more than one entity, an entity chip row
    (?entity= query param) scopes the stat tiles to one entity or "No
    entity"; alert cards and the map thumbnail stay org-wide.
  - /map: full-screen Mapbox satellite map. Property name labels always
    render (text-allow-overlap, zoom-scaled size, heavy halo) so they
    are never crowded out by basemap or parcel/road labels. Toggleable
    layers:
    properties (white outline), parcels (dashed light line; DEFAULTS
    OFF as clutter, and every user's layer toggle choices persist per
    browser in localStorage, defaults applying only to fresh state),
    ag fields (kelly green), pastures (warm tan), wetlands (steel
    blue), timber stands (per-type fills, see TIMBER STANDS below),
    roads (white line over dark green casing, labels along the line),
    utility easements (see the table entry: translucent red/orange/gray
    strips with per-type dashed outlines and legend), and
    assets (dark green circle markers with a per-type letter, dashed light
    blue lines for pipe/fence, faint outline for footprints, light blue
    pivot coverage shapes). PRINT BUTTON (top right): a print setup
    mode overlays a Letter-aspect frame (portrait/landscape, default
    landscape) and the user pans/zooms freely underneath it; the frame
    IS the printed extent (WYSIWYG). The panel has independent
    per-layer checkboxes prefilled from the live toggles, label on/off
    per layer (parcel numbers default off in print), crops and entity
    coloring, a title (defaults to the property name when the view is
    one property, else the org name) and a subtitle defaulting to
    today's date. Generate renders the framed extent on a hidden map
    at print resolution (devicePixelRatio override to 3, ~290 DPI on
    the printed map area, a true render with only the checked layers,
    preserveDrawingBuffer capture) and assembles the PDF client-side
    with jsPDF (components/map/printPdf.ts): map within margins, title
    and date, a legend of only the checked layers with swatches
    matching the map styles (timber types, crops, easement types),
    a scale bar from the render's real ground distance, a north
    indicator, the Turnrow lockup (rasterized brand SVG with text
    fallback), and the Mapbox/OpenStreetMap attribution line. Progress
    shows during rendering; the file downloads as <title>-<date>.pdf
    (phones print from any PDF viewer; no window.print anywhere).
    PRINT ITEM EXCLUSIONS (per print session, never persisted): while
    the frame is up, tapping any rendered item toggles it out of the
    print; excluded items render ghosted (canvas-generated white slash
    pattern + heavy transparency + dashed gray outline in a dedicated
    print-ghost source; tapping a ghost restores it) and are absent
    from the PDF, its labels, and its legend presence checks. A
    counter chip on the frame ("3 items hidden", tap to clear all)
    keeps state visible. The setup panel adds property chips (only
    when more than one property is in frame; excluding a property
    expands to its boundary plus everything on it, so the flat
    "entityType:id" exclusion set stays the single source of truth)
    and an expandable "Choose items" drawer listing only in-frame
    items as a Property > type > item tree with tri-state checkboxes
    and a filter box, two-way synced with the taps. Layer checkboxes
    stay the coarse control; item exclusions apply within checked
    layers.
    Click
    priority assets > roads > fields > timber > parcels > properties, with
    the same detail panel pattern (right card desktop, bottom sheet
    mobile). The Add menu offers: Boundary (polygon draw; save as field,
    parcel, property, or timber stand), Road/pipe/fence (line draw),
    Asset pin (crosshair placement mode: pan to line up, DRAG the
    crosshair itself anywhere on the map (generous touch target), or My
    location via GPS; Place here confirms wherever it sits; moving a
    pin reuses the same mode), and Irrigation
    pivot (crosshair places the center, then the parametric editor
    opens directly; Save asks for name + property, suggested
    from the center's location, and inserts the pivot with its
    parameters and derived polygon in one step). The line dialog's
    kinds are Road, Pipe (yours), and Fence (with a hint that utility
    easements are boundaries now); the boundary dialog's types are Ag
    field, Pasture, Wetland, Parcel, Property, Timber, and Easement.
    When the type is Easement it expands in place with easement type
    (powerline/pipeline/other), holder, recorded ref, and notes,
    property optional (easements cross property lines), all
    session-persistent. When the
    boundary dialog's type is Timber, it expands in place with stand
    type (required, five types), species (prefills "Loblolly pine" on
    a pine pick, never stomping a typed value), year established, and
    notes, all persisting across multi-area sessions; the stand saves
    complete in one step. Every save
    dialog preselects the property whose boundary contains the drawn
    geometry (same lib/geo/propertyMatch.ts logic as the file import)
    with a "Suggested from location" chip that clears if the user picks
    a different property. Geometry edits
    use mapbox-gl-draw vertex editing plus BOOLEAN EDITING for polygon
    boundaries (property/parcel/field/timber stand): the edit toolbar's
    Add area and Cut area buttons let the user draw a polygon that is
    unioned into or differenced out of the shape (turf), and the
    new-boundary save dialog offers the same before saving; results may
    be non-contiguous (MultiPolygon storage everywhere). The save dialog
    stays MOUNTED (css-hidden) through a whole multi-area session so
    the chosen type, name, and property never reset when another area
    is drawn. TWO-LEVEL CANCEL while building: "Discard shape" (button
    + Escape; mapbox-gl-draw keybindings are off so Escape is ours)
    removes only the in-progress polygon, keeping completed areas, the
    form, and drawing mode; the session Cancel confirms first when
    completed areas exist ("Discard 3 drawn areas?"). Acres/miles
    recompute server-side on every save. TIMBER STANDS render like
    fields: prominent per-type fills + solid same-color outlines
    (STAND_TYPE_COLORS in lib/assetTypes.ts: planted pine deep teal
    #0f766e, natural pine olive #6b8e23, hardwood burnt orange #c2410c,
    mixed deep violet #7c3aed, other gray; all checked distinct from
    kelly, the crop palette, entity outlines, the pivot light blues,
    and the light dashed Timber Scan draft palette; STANDING RULE:
    timber types never use hues adjacent to the field/crop greens),
    white name labels, and a "Timber types"
    legend in the control column listing only types present. PIVOT
    COVERAGE SHAPES: a parametric editor (never vertex editing; the
    geometry is derived and regenerated) with draggable center/radius
    handles, a typed feet input (the radius IS wetted_length_ft),
    Full/Partial toggle with two arc
    handles (compass bearings, clockwise sweep, live degrees, ~3
    degree snap to 90/180/270), live acres, and Save through
    set_geometry. Beyond the base circle/sector, exactly two manual
    tools (the earlier extension zones, skip sectors, towable
    positions, custom-shape conversion, and lateral type proved more
    than needed and were removed in 0015 after a check found no assets
    using them): + Add area draws a freehand polygon UNIONED into the
    coverage (corner-arm lobes, end gun reach, odd extensions; a
    corner machine is four small drawn lobes), and + Cut area draws a
    polygon DIFFERENCED out (ponds, waterways, obstacles). Drawn
    polygons list as removable chips in the editor. TWO ACRE NUMBERS:
    acres_covered (headline) = plantable after cuts; acres_watered =
    gross (base + adds); the panel shows "212.4 plantable of 218.1
    watered" when they differ. The saved polygon is the plantable
    shape (holes punch through to satellite). Details schema:
    center_lon/lat, wetted_length_ft (the radius), full_circle,
    start/end_bearing_deg, add_polygons, cut_polygons, all mapManaged
    (cleanDetails carries scalars AND arrays through form saves;
    pre-0015 'cutouts' still read). Pivots render light blue fill +
    solid light blue outline with the P marker kept at the center;
    panels show Coverage (Full circle or N degree sweep, plus added
    area count) and offer Add/Edit coverage (replacing raw geometry
    editing once a circle exists). lib/geo/pivot.ts unit-tests the
    geometry (pi r squared sanity, sector = full x sweep/360, add
    lobes grow gross, cuts reduce plantable only and punch real
    holes, details round trip including the legacy cutouts key,
    bearing conventions, wraparound sweeps, snapping). CSS-based fullscreen toggle (not the native Fullscreen
    API, so iOS modals stay visible). /map?focus=asset:<id> zooms to and
    selects an entity (used by list pages).
  - /import: upload GeoJSON/JSON, KML, KMZ, zipped shapefiles. Polygons
    can be assigned as property/parcel/field/timber stand, lines as
    road/pipe/fence, points as assets (with type). Preview map, per-feature
    review before saving, failures skipped and reported. Properties in a
    batch save first so other rows can reference them. Each feature's
    property assignment is SUGGESTED FROM LOCATION
    (lib/geo/propertyMatch.ts, unit-tested: sample points from the
    geometry scored against property boundaries by hole-aware
    point-in-polygon; majority containment wins, straddlers go to the
    larger side): the review row preselects the containing property
    with a "Suggested from location" chip the user confirms or
    overrides; with no convincing match nothing is preselected and the
    existing validation forces an explicit choice (previously every
    row silently defaulted to the alphabetically first property).
  - /properties, /properties/[id], /parcels, /fields: non-map browsing with
    acres totals and inline editing. The Properties section has two tabs
    (Properties, Entities; same pattern as the Leases tabs, and the nav
    highlights Properties for both). The properties list groups by
    entity with per-entity property counts and acre subtotals once any
    entity exists (flat "All" view one tap away via ?view=flat) and
    every property row carries an inline "Held by" entity picker with
    inline new-entity creation. Property detail shows and edits the
    holding entity the same way. Property detail also carries the
    RESTRUCTURING tools: every child section (parcels, fields, timber
    stands, roads, assets) has a "Move ... to another property" control
    with per-item checkboxes and a target property picker; moving is
    just a property_id update (composite FKs keep it in-tenant,
    boundaries and generated acres untouched, property outlines are NOT
    redrawn). Built so entity-shaped properties can be dissolved into
    real entities plus real properties. Property delete lives on both
    the list rows and the detail page (DeletePropertyButton): a
    confirmation spells out exactly what cascades (parcel/field/timber
    stand/road/asset counts) and warns when lease land links will be
    removed; leases, payments, and tax records are never deleted (tax
    statements on deleted parcels become unmatched via their set-null
    FK), and errors surface inline instead of silently redirecting.
  - /entities and /entities/[id] (Entities tab): list with per-entity
    type, property count, and total acres plus a "No entity" bucket of
    unassigned properties; create with name + type. Detail page: edit
    name/type/notes, properties with acre subtotals, the known
    county-record spellings saved from imports (entity_aliases), and
    documents (entity_type "entity": operating agreements, formation
    docs). Cleanup tools (org OWNERS only, UI hidden for members and
    server actions verify): "Merge into another entity" moves the
    source's properties, aliases, and documents to a chosen target
    (confirmation lists exact counts; storage paths do not encode the
    entity id so files stay valid) then removes the source; delete
    reverts properties to No entity (never deletes them), removes
    aliases (FK cascade), and deletes attached documents with their
    storage files (documents have no FKs, so this avoids orphans), all
    stated in the confirmation.
  - /timber: stands grouped by property with total timber acres and inline
    editing of stand info.
  - /assets: filterable list (property, type, show-inactive) with counts
    and total estimated value; rows link to /assets/[id] and zoom the map.
  - /assets/[id]: full editor: shared fields, dynamic type-specific form
    from lib/assetTypes.ts, supply well link, photo gallery
    (camera-friendly upload), documents, deactivate/reactivate/delete.
  - /settings: the one settings page (Members, Admin for platform
    admins, Sign out), described under the authenticated shell above.
    /settings/members and /admin/gis are redirects.
  - Leases section (one nav item, three tabs): /leases (list with status
    and acres), /tenants and /tenants/[id] (contact info, insurance badge,
    documents, their leases), /timber-sales.
  - /leases/new and /timber-sales/new: "Upload document and extract terms"
    is the primary path (PDF, or photo for timber contracts ->
    /api/extract -> claude-sonnet-4-6 with a forced tool call whose
    schema mirrors the form). The review form shows
    every extracted value; fields the model flagged as unsure are
    highlighted amber; extracted tenant names fuzzy-match existing tenants
    (suggested match) or offer to create one. The lease extraction also
    pulls every tract the document covers (description, acres, county,
    FSA farm numbers, tax parcel numbers) and lib/leaseLand.ts
    (unit-tested) matches each against existing properties: FSA and
    parcel numbers are strong evidence (digits-only comparison), name
    words, county, and acreage-within-15% supporting; a Leased land
    section on the review form preselects the suggested property per
    tract (amber until touched, source text quoted underneath), supports
    any number of properties on one lease (and manual + Add property
    rows), prefills leased acres from the document else GIS acres, and
    saves confirmed rows as lease_lands. Unmatched tracts stay visible
    with their document text and simply save unlinked (linkable later on
    the lease page). Multiple leases per property need no special
    handling (lease_lands is many-to-many). Nothing saves until
    confirmed; extraction failures fall back to the manual form. The
    source PDF is attached to the record on save. Manual entry always
    available.
  - /leases/[id]: terms editor, linked land with editable contract acres,
    per-year projection assumptions (flex bonus, crop share inputs),
    expected-vs-received payments table with status chips and inline
    payment recording, insurance warning for hunting leases, documents.
  - /timber-sales/[id]: linked stands with the allocation method
    (by_acres shares shown per stand, manual percentage inputs, or
    keep-at-sale-level; each settlement can override), lump-sum
    schedule with the same payments engine, or pay-as-cut settlements:
    manual entry in each product's unit (tons or MBF at contract
    rates, computed amounts), "Upload settlement" (below), running
    totals by product with the contract rate beside the dollars, and
    settlement history with period ranges and load counts. Marking a
    thinning-type sale completed offers (reviewed, per-stand
    checkboxes, editable year, never automatic) to set
    last_thinning_year on the linked stands. Documents.
  - TIMBER UPLOAD FLOWS (the 2026-08-20 wave): the contract extractor
    (kind=timber) understands lump sum vs pay-as-cut vs delivered-net
    (saved as pay_as_cut + the delivered_net flag), harvest type,
    tract description, rates with $/ton or $/MBF units and log scale,
    deposit, and penalty/BMP notes; the review form adds a Stands
    section (suggestions matched from the tract description by
    name/acres similarity in lib/timberMatch.ts, amber "Suggested from
    contract" chips, user confirms links and the allocation method)
    and the source file attaches to the sale (each linked stand's page
    lists the sale's documents read-only via DocumentLinks).
    Settlements (kind=timber_settlement) accept PDF, photo, or
    Excel/CSV: spreadsheets parse server-side (xlsx), the model maps
    ONLY columns and product spellings, and per-load rows collapse to
    per-product period lines (load count, date range, weighted rate)
    in deterministic unit-tested code (lib/timberSettlement.ts);
    PDFs/photos extract collapsed lines directly. The shared review
    card (components/timber/SettlementReview.tsx) shows lines against
    the contract's rates with non-blocking mismatch flags ("settlement
    pays $28.50/ton, contract says $30.00", unit mismatches too),
    editable everything, per-settlement allocation override, and saves
    the settlement + document. Uploading from /timber-sales without
    picking a sale first suggests the matching sale by buyer
    similarity + product overlap (lib/timberMatch.ts suggestSaleId),
    user confirms.
  - RICH SUMMARY PAGES: one consistent template
    (components/summary/Summary.tsx: breadcrumbed header with type
    badge and key figure, static satellite thumbnail with the geometry
    overlaid via lib/staticMap.ts (simplified GeoJSON overlay, tap
    opens /map?focus=<type>:<id>; points show a pin), Details card of
    every populated field, related sections rendering only with
    content, documents/photos, and the type's actions) across
    /fields/[id] (irrigated/dryland split, GIS acres beside the
    tenant's planted-by-practice acres labeled by source, covering
    leases with current-year projected rent, farm activity history,
    documents), /pastures/[id], /wetlands/[id], /parcels/[id] (tax
    statements), /timber/[id] (linked timber sales with the stand's
    ALLOCATED TIMBER INCOME per the allocation method, sale documents,
    and an allocated-to-date total), /roads/[id], plus upgraded
    property (thumbnail, pasture section, irrigated rollup, child rows
    linking to their pages) and asset pages (thumbnail). Map click
    panels carry a prominent "View full page" link
    (detailPagePath in FeaturePanel); /map?focus= accepts every entity
    type.
  - AI RENT UPLOAD (components/payments/RentUpload.tsx on /income and
    every lease's Payments section): check photos and settlement PDFs
    -> /api/extract kind=payment (claude-sonnet-4-6 forced tool:
    document kind, payer, date, total, check number, settlement line
    detail, yields, timber lines, unsure_fields amber). Payer matches
    to tenants via the owner-name normalizer (suggested, never
    assumed), then that tenant's leases, then a proposed allocation
    against OPEN expected payments (lib/paymentMatch.ts, unit-tested:
    exact-amount match first even when another is due sooner, else
    due-date-proximity fill supporting one check split across several
    and partials; overflow becomes an unscheduled remainder). Review
    before save, always: confirming inserts the payment row(s) with
    provenance in the memo ("Uploaded check ..., extracted date",
    check # in method), attaches the source file to the lease's
    documents, and refreshes. A document reading as a timber
    settlement offers routing that lands in the SAME SettlementReview
    card as the sale page's Upload settlement (lines vs contract
    rates, allocation, sale suggested by buyer/products, document
    attached to the sale). Settlement yields/prices show as an
    OPTIONAL cross-check against that lease-year's assumptions,
    changing nothing unless the user acts. No match falls back to
    manual tenant/lease pick or unscheduled, same review screen.
  - /income: PROJECTIONS WITHOUT GENERATION: a lease-year with no
    generated expected payments shows its projected rent computed
    straight from terms + leased acres + that year's assumptions (the
    tenant's prices and yields), for draft and active leases (expired/
    terminated stop projecting); an amber note marks years whose
    Expected includes projections ("will change as prices and yields
    update"). Generating a lease's expected payments replaces its
    projection with the schedule (never summed). lib/income.ts
    projectedLeaseYears + effectiveExpectedEntries, unit-tested
    (projection, schedule-wins, terminated, acre allocation). Year
    selector, bar chart by year (expected gray, received
    kelly, taxes paid dark pine), by-type table with Gross income /
    Property taxes / Net rows, by-property table with taxes and net
    received columns (taxes route statement -> parcel -> property;
    unmatched to Unassigned; expense basis: taxes due = expected expense,
    tax payments = actual). Once entities exist, an entity chip row
    filters the by-property table and the table groups properties under
    entity subtotal rows (expected, received, taxes, net per entity;
    Unassigned income shows only under All entities). Property detail pages show allocated income
    with taxes paid and net; the dashboard shows a "Payments needing
    attention" card (past due + due within 60 days).
  - /taxes ("Property Taxes"; the module renamed from "Taxes"
    everywhere in UI text 2026-08-20, routes and tables unchanged):
    year selector; entity filter select
    plus a "by entity" rollup table (statements covered X of Y, due,
    paid, outstanding per entity, amber/red highlights) so "is
    everything this entity owns covered and paid" reads at a glance;
    picking an entity scopes the tiles, missing-statement warnings, and
    statement list to that entity's parcels (statement -> parcel ->
    property -> entity; unmatched statements show under All entities
    only); summary tiles (parcels,
    statements on file X of Y, total due/paid/outstanding); parcels with
    NO statement on file surfaced at the top; unmatched statements with a
    resolve control; statement cards with computed status chips, inline
    payment recording, expandable details (payments, attached document,
    edit/delete); batch payment (select unpaid statements, one date and
    check number, individual tax_payments rows).
  - /taxes/upload: PDFs and phone photos (JPEG/PNG/WebP), multiple per
    session, each extracted via /api/extract kind=tax. Parcel numbers are
    normalized (case, punctuation, leading zeros) and matched against
    parcels; the review card preselects the match or offers exactly two
    no-match options: create the missing parcel (number, county, property;
    boundary later) or save as unmatched. Due/delinquent dates prefill
    from county defaults with a "remember for this county" checkbox.
    Nothing saves without review; the source file attaches to the
    statement.
  - Dashboard property-tax card once any current-year statement exists:
    X of Y parcels covered and total unpaid, amber within 60 days of the
    nearest delinquent date, red once past it.
  - /import/county (Import from County Records; linked from the import
    page, and from map/properties empty states): pick a county from
    active registry entries, then search one of three ways. The
    featured mode is "All parcels for an owner" (entity mode): county
    records write the same person or company many different ways
    (THORNTON STUART, THORNTON S R ETUX, THE ALBEMARLE CORPORATION...),
    so this mode searches broad and groups locally. The server picks
    the seed name's most distinctive token (longest surviving token
    after normalization), queries the county for every owner containing
    it (1,000-feature cap with pagination; on overflow it falls back to
    narrower two-token patterns, and if still too common returns a
    clear "add another word" error instead of truncating), and returns
    each owner verbatim plus its normalized form. The client clusters
    the results with token-set similarity (word order ignored,
    single-letter tokens match initials, one-letter typos tolerated in
    long tokens; lib/ownerNames.ts, deterministic, no AI) into owner
    group cards: proposed entity name (most complete variant), parcel
    and acre totals, an inline SVG mini sketch of the group's parcels,
    and a collapsed variant list with per-variant counts and stripped
    noise markers (ETUX, ESTATE, JR) shown as metadata. Corrections are
    one tap each: split a variant out ("Not this owner"), merge groups,
    or exclude individual parcels via checkboxes or map taps. Checked
    groups flow into the same assign-and-import panel below. IMPORTING
    IS A LOOP: a successful import stays on the cached results (no
    county re-query), marks that batch's parcels with an Imported badge
    (unselectable, out of select-all and group toggles; a fully
    imported group's card shows the badge), resets selection, duplicate
    choices, and the assign panel for the next batch, and shows a
    success toast ("Property X created with 6 parcels, 412.7 acres")
    with a View on map link. A "Done, view on map" button appears after
    the first import (zooms to the property when the session touched
    one, otherwise opens the map). Parcels imported this session join
    the duplicate pool for later searches; pre-session parcels keep the
    normal duplicate flagging. On the search map, parcels already in
    the user's records (imported this session or matching an existing
    parcel by normalized number) fill dark pine with a mint outline and
    a small legend, so what remains to import reads at a glance;
    selection still paints kelly on top while resolving duplicates. The
    search map also labels each parcel with its number and has two
    corner toggles (Boundaries, Parcel numbers) to strip the overlay
    down to bare satellite imagery; polygon clicks keep working with
    boundaries hidden. Newly created properties and entities
    join the pickers client-side. The "Held by entity" picker SUGGESTS,
    NEVER AUTO-CREATES: default No entity (an existing property keeps
    its current entity; it is never cleared from here), a known owner
    (confirmed aliases) preselects that existing entity (user choice
    always wins), and "Create new entity..." opens an explicit inline
    form (name, type, notes) prefilled with a cleaned title-case owner
    name via displayOwnerName() in lib/ownerNames.ts (noise stripped,
    trailing THE moved to front, acronyms kept: ALBEMARLE CORPORATION
    THE ETAL prefills as The Albemarle Corporation; unit-tested).
    Importing with an entity selected records the imported groups'
    variants as entity_aliases of that entity; importing with No entity
    records nothing. The entity and property choices stay in sync:
    picking an entity narrows the existing-property dropdown to that
    entity's properties (switching to New property when it has none),
    and picking a property defaults the entity picker to that
    property's owner (a known-entity group suggestion narrows the same
    way). The classic owner-name and parcel-number searches are
    unchanged: results as a synced list + selectable satellite map (row
    click zooms the polygon, polygon click toggles the row), select-all
    with running parcel and acre totals. Parcel-number search is
    FORMAT-TOLERANT (counties format the same number differently:
    Morgan stores 02 04 18 0 000 007.000 where tax statements print
    0204180000007000): the where clause ORs the number as typed, with
    punctuation stripped, and with a wildcard between every character
    so any separator convention matches (buildWhere, unit-tested in
    lib/gisServer.test.ts). All modes share: assign to an
    existing or new property (merge-outline option via
    set_property_boundary_from_parcels, default on), duplicate parcel
    numbers flagged with skip-or-update-geometry per parcel (normalized
    comparison), owner-as-recorded stored in parcel notes verbatim,
    deeded acres and source attribution stored, then lands on the map
    zoomed to the import. All ArcGIS queries go through server-side
    proxy routes (/api/gis/search plus admin layer-info and test):
    CORS-free, where-clause built from registry mappings, outSR=4326,
    resultOffset pagination, f=geojson with Esri JSON +
    @terraformer/arcgis fallback, 200-feature cap in the classic modes
    with a narrow-your-search notice, 15s timeout with a friendly
    error. ACRES HANDLING (counties publish acres attributes
    inconsistently; Colbert returns 0.0 or null on many parcels): the
    proxy nulls any acres attribute that is missing or <= 0 (junk 0
    never displays or saves; deeded_acres stores NULL, never 0) and
    computes computed_acres for every feature with @turf/area
    (geodesic, 1 decimal). The UI prefers real deeded acres and falls
    back to the estimate with an "est." suffix and "Estimated from
    parcel boundary" hint; mixed totals note "incl. estimates";
    post-import the PostGIS generated column stays the source of truth
    (turf agrees within a fraction of a percent). Features the county
    returns without geometry are kept, flagged "no boundary returned",
    and cannot be selected for import. A spatial reference guard
    (lib/geo/spatialRef.ts, unit-tested) detects servers that ignore
    outSR=4326 and return Web Mercator, reprojects to WGS84 before any
    display or save, and console-warns naming the service.
  - The GIS registry admin area (platform admins only; lives in the
    Settings page's Admin section since 2026-08-20, /admin/gis
    redirects there): registry list with status chips and re-verify,
    add-service
    flow (paste layer URL, auto-read fields with guessed mappings,
    dropdown mapping, one-record test query, save as active/untested),
    edit, deactivate, delete.
  - FARM DATA IS DATA FIRST: the Farm Data nav item lands on
    /farm-activity; with no connections yet it redirects to /farms so
    the share-code entry stays front and center. The activity page
    carries a connection-health strip (status dot, label, last synced,
    a gear "Manage connections" link), loud error banners when a
    connection is not active, and a Tenant prices card (per-crop price
    with PROJECTED/FINAL badge) when the scope is shared.
  - /farms ("Farm connections", the management area): enter a farmer's
    one-time share code to
    connect; connections list with status chips (active / error with the
    plain-language last_error / Ended by farmer), last synced time,
    Refresh now, links to field mapping and farm activity, Disconnect.
  - /farms/[id]/mapping: every remote field with its farm-side name,
    farm, and acres; a dropdown maps it to a local field, a whole
    property, or Ignore. Suggested matches show a one-click Confirm
    match; "Check for new shared fields" re-syncs.
  - /farm-activity: filterable (year, connection, property) table grouped
    by property: field, crop with varieties, planted acres, planting
    date, Growing/Harvested chip, yield per acre (or "Not shared" when
    the farmer keeps yields private). Totals line for plantings and
    acres.
  - Map: a "By entity" toggle (appears when more than one entity exists)
    recolors property outlines by holding entity with a small legend
    (subtle distinct colors from lib/entities.ts ENTITY_COLORS, chosen
    to read over satellite and avoid kelly = fields; "No entity" stays
    white), and the property click panel shows the holding entity. A
    Crops toggle (appears once farm data exists) recolors mapped
    fields by current-year crop with a legend (corn yellow, cotton white,
    soybeans kelly, wheat amber, canola light green, other purple; chosen
    to read over satellite imagery). The field/property click panel gains
    a Farm activity section: crop, varieties, planted date, harvest
    status, yield when shared.
  - Dashboard: harvest progress card during harvest (acres harvested of
    acres planted with a progress bar, linking to /farm-activity).
  - /leases/[id]: the Tenant Data panel (described under lease price
    methods above) shows per-crop planted acres, yields (PROJECTED or
    ACTUAL), and prices (PROJECTED or FINAL) from connected farm data
    for the leased land, with Use buttons that fill the assumption
    rows amber; the user still reviews and saves.

## Conventions

- Brand: kelly green #39b54a primary, dark green #14532d accents/dark
  surfaces. Tailwind theme colors kelly-50/100/500/600/700 and
  pine-700/800/900. Logo files in public/brand/ are used as-is, never
  recolored.
- No em dashes anywhere in UI text or generated documents.
- The fields land type is ALWAYS "Ag Fields" / "ag field" in UI text;
  database identifiers stay fields. Pastures are a separate land type.
- Numbers with commas; acres to 1 decimal (lib/format.ts formatAcres);
  dollars with commas and 2 decimals (formatDollars).
- Every future AI extraction must be shown for user review before saving.
- PROJECT_SUMMARY.md is regenerated at the end of every phase.

## Build phases

- Phase 1 (DONE): foundation + GIS core, described above.
- Phase 2 (DONE): timber stands, roads, and fixed assets with detail
  pages, photos, and document attachments, described above.
- Phase 3 (DONE): tenants, agricultural and hunting leases with AI term
  extraction, expected/actual payment tracking, timber sale contracts
  with settlements, and income views, described above.
- Phase 4 (DONE): property taxes (statement uploads with AI extraction
  and parcel matching, all-parcels completeness check, payments including
  batch, expense rollups into net income views), described above.
- Phase 5 (DONE): county GIS parcel import (platform-admin service
  registry, server-side ArcGIS proxy, search/preview/select/import flow
  with merged property outlines and deeded acres), described above.
- Phase 6 (DONE): read-only partner API integration with the Turnrow farm
  software. Farmer creates a one-time share code in the farm software
  (grain-tracker repo, /settings/shares) choosing whether to include
  yields; the landowner redeems it under Farm Data. Explicit field
  mapping (no geometry crosses the API), 6-hour cron sync + manual
  refresh, Crops map layer, Farm activity page, dashboard harvest card,
  crop share yield prefill from actuals. Described above.
- Post-Phase 6 (DONE): owner entity matching in the county import
  (migration 0007). Entity search mode groups all of an owner's parcels
  across name variants, user-correctable grouping, confirmed groupings
  remembered as owner entities + aliases. Described above.
- Post-Phase 6b (DONE): five more Alabama counties in the GIS registry
  (migration 0008: Morgan, Lauderdale, Limestone, Madison, Franklin, all
  live-verified) and the entity level above properties (migration 0009:
  entities unified with owner matching, properties.entity_id,
  restructuring tools for moving children between properties, entity
  views across properties/income/taxes/dashboard/map). Described above.
- Post-Phase 6c (DONE, 2026-08-17): lease price methods (migration 0012:
  tenant average, RMA benchmark, custom recipes); map drawing polish
  (timber stand per-type colors + legend, multi-area save-form
  persistence, two-level draw cancel); parametric pivot coverage
  circles (panel editor + Add menu entry); the Tenant Data panel with
  strict crop matching, multi-crop assumption years, no-silent-
  overwrite fills, provenance tags, and the cents-per-lb fill
  boundary; income projections computed straight from lease
  assumptions (no Generate step needed, projection note, deletable
  expected payments). Described above.
- Post-Phase 6d (DONE, 2026-08-17, migration 0013): real-world pivot
  shapes (composite parametric model: extension zones, skip sectors,
  cutout holes with plantable-vs-watered acres, towable positions,
  custom-shape escape hatch, and the irrigation_lateral asset type);
  timber stand details inline in the boundary save dialog; planted
  pine recolored deep teal; draggable crosshair placement. Described
  above.
- Post-Phase 6e (DONE, 2026-08-17, migration 0014): "Ag Fields" rename
  everywhere in UI; pastures as a minimal land type; rich summary
  pages for property/parcel/ag field/pasture/timber stand/road/asset
  with static map thumbnails and View-full-page links from the map;
  AI rent upload (checks and settlements to reviewed payment rows,
  timber settlement routing, assumption cross-checks);
  irrigated/dryland acres end to end (PostGIS derivation + practice-
  split tenant data and assumptions; ACTUAL yields stay blended until
  the farm-side /production payload carries a practice breakout); Farm
  Data page restructured data-first with connections tucked into a
  management area. Described above.
- Post-Phase 6f (DONE, 2026-08-17, migration 0015): pivot editor
  simplified to circle/sector + manual add/subtract polygons (advanced
  zone/towable/custom-shape tools and the lateral type removed after a
  DB check found zero usage; one existing cutout carried over
  unchanged); wetlands as a minimal open-wetland land type in steel
  blue; the header brand lockup (small-caps Landowner wordmark, not a
  nav item); parcels layer defaulting off with per-browser persisted
  layer toggles. Described above.
- Post-Phase 6g (DONE, 2026-08-17, migration 0016): the map Print
  button (WYSIWYG framed Letter PDFs with per-layer/label control,
  legend, scale bar, north indicator, brand lockup, attribution,
  client-side via jsPDF at print resolution) and the utility easements
  layer (then line+width corridors; became polygons in 0017).
  Described above.
- Post-Phase 6h (DONE, 2026-08-20, migrations 0017 + 0018): utility
  easements became polygon boundaries drawn like every land type
  (line-to-polygon buffer conversion, 50 ft default for missing
  widths); one Settings page (Members + platform-admin GIS registry +
  Sign out) collapsing three nav items; the map became the landing
  page and first nav item; logo-only working banner; Taxes renamed
  Property Taxes; timber sale contracts and logger settlements with
  AI extraction (Southeast product classes, $/ton and $/MBF with log
  scales, harvest types, delivered-net flag, stand allocation
  by-acres/manual/none with per-settlement overrides, contract upload
  with stand-link suggestions, settlement upload from PDF/photo/
  Excel/CSV with deterministic per-load collapse and non-blocking
  rate mismatch flags, unmatched-sale suggestion, last-thinning
  offer, allocated income on stand pages, rent-upload timber routing
  into the same review); and print item exclusions (tap-to-toggle
  ghosting, property chips, Choose items drawer, per-session).
  Described above.
