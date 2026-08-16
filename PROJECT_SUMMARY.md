# Turnrow Landowner: Project Summary

Last updated: 2026-08-16 (entity level, five new Alabama counties, FSA
numbers on properties)

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
- @turf/area for geodesic pre-import acre estimates in the GIS proxy
- Vitest (dev only) for unit tests: npm test runs lib/ownerNames.test.ts
  (owner-name normalization and clustering) and lib/geo/spatialRef.test.ts
  (Web Mercator detection and reprojection)

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
  asset_type (well, irrigation_pivot, underground_pipe, riser, shop, shed,
  barn, grain_bin, house, fence, pond_dam, other), name (only required
  field), geometry accepting Point/Line/Polygon, year_installed, condition
  (excellent/good/fair/poor), estimated_value, notes, details jsonb
  (type-specific fields validated in the app against lib/assetTypes.ts,
  which drives the dynamic forms and panels), parent_asset_id
  (self-reference: pivot/riser/pipe links to its supply well; composite FK
  keeps it in-tenant), is_active (deactivate instead of delete to keep
  history).
- Views timber_stands_geo / roads_geo / assets_geo mirror the Phase 1 *_geo
  pattern. public.set_geometry(entity_type, id, geojson) generalizes
  set_boundary to all six entity types (polygon/line/any validation per
  type); the app writes all geometry through it.

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
  bonus estimate; crop share crop/acres/yield/price/shared expenses).
- timber_sales: sale_name, buyer_name (free text) + optional
  buyer_tenant_id, sale_type (lump_sum | pay_as_cut), status, contract
  date, harvest_deadline, performance_deposit, sale_acres, lump_sum_price,
  stumpage_rates jsonb ($/ton by product: pine sawtimber, pine chip-n-saw,
  pine pulpwood, hardwood sawtimber, hardwood pulpwood, custom),
  payment_schedule jsonb (split lump sums: label, due_date, amount).
- timber_sale_stands: join to Phase 2 timber_stands.
- timber_settlements: pay-as-cut entries (date, lines jsonb of
  tons/price/amount by product, stored total_amount, check number). Count
  directly as received timber income; not duplicated into payments.
- expected_payments: generated rows (year, label, due_date,
  expected_amount) referencing exactly one of lease_id / timber_sale_id.
  Generated by the app (lib/leaseLogic.ts) from terms + schedule +
  assumptions; regeneration deletes/recreates ONLY rows with no payments
  attached. Status (upcoming / due soon 30d / past due / paid / partial) is
  computed, not stored.
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
  remote_field_id, crop_year, crop): planted_acres, planting_date,
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
- app/(app)/: authenticated shell. Header: white bg, horizontal green logo
  on desktop, T mark on mobile; bottom tab bar on mobile (Home, Map,
  Properties, Import).
  - /dashboard: stat tiles (total acres, properties, field acres, timber
    acres, wells, pivots, grain bins, buildings), static satellite
    thumbnail (Mapbox Static Images API) linking to the map, quick links.
    When the org holds land in more than one entity, an entity chip row
    (?entity= query param) scopes the stat tiles to one entity or "No
    entity"; alert cards and the map thumbnail stay org-wide.
  - /map: full-screen Mapbox satellite map. Property name labels always
    render (text-allow-overlap, zoom-scaled size, heavy halo) so they
    are never crowded out by basemap or parcel/road labels. Six
    toggleable layers:
    properties (white outline), parcels (dashed light line), fields (kelly
    green), timber stands (dark green fill, light mint dashed outline),
    roads (white line over dark green casing, labels along the line), and
    assets (dark green circle markers with a per-type letter, dashed light
    blue lines for pipe/fence, faint outline for footprints). Click
    priority assets > roads > fields > timber > parcels > properties, with
    the same detail panel pattern (right card desktop, bottom sheet
    mobile). The Add menu offers: Boundary (polygon draw; save as field,
    parcel, property, or timber stand), Road/pipe/fence (line draw), and
    Asset pin (crosshair placement mode: pan to line up, Place here, or My
    location via GPS; moving a pin reuses the same mode). All three save
    dialogs preselect the property whose boundary contains the drawn
    geometry (same lib/geo/propertyMatch.ts logic as the file import)
    with a "Suggested from location" chip that clears if the user picks
    a different property. Geometry edits
    use mapbox-gl-draw vertex editing; acres/miles recompute server-side
    on every save. CSS-based fullscreen toggle (not the native Fullscreen
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
  - /settings/members: member list, invite by email (owners only), revoke
    pending invites.
  - Leases section (one nav item, three tabs): /leases (list with status
    and acres), /tenants and /tenants/[id] (contact info, insurance badge,
    documents, their leases), /timber-sales.
  - /leases/new and /timber-sales/new: "Upload document and extract terms"
    is the primary path (PDF -> /api/extract -> claude-sonnet-4-6 with a
    forced tool call whose schema mirrors the form). The review form shows
    every extracted value; fields the model flagged as unsure are
    highlighted amber; extracted tenant names fuzzy-match existing tenants
    (suggested match) or offer to create one. Nothing saves until
    confirmed; extraction failures fall back to the manual form. The
    source PDF is attached to the record on save. Manual entry always
    available.
  - /leases/[id]: terms editor, linked land with editable contract acres,
    per-year projection assumptions (flex bonus, crop share inputs),
    expected-vs-received payments table with status chips and inline
    payment recording, insurance warning for hunting leases, documents.
  - /timber-sales/[id]: linked stands, lump-sum schedule with the same
    payments engine, or pay-as-cut settlements entry (tons by product at
    contract rates, computed amounts, running totals by product),
    documents.
  - /income: year selector, bar chart by year (expected gray, received
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
  - /taxes (Tax Statement Status): year selector; entity filter select
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
  - /admin/gis (platform admins only; Admin nav item appears only for
    them): registry list with status chips and re-verify, add-service
    flow (paste layer URL, auto-read fields with guessed mappings,
    dropdown mapping, one-record test query, save as active/untested),
    edit, deactivate, delete.
  - /farms (Farm Data nav item): enter a farmer's one-time share code to
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
  - /leases/[id]: crop share assumption rows show a one-click "Use
    actual" button when connected farm data has a harvested yield for
    that year on the leased land (weighted average over the dominant
    crop), clearly labeled as coming from farm data; the user still
    reviews and saves.

## Conventions

- Brand: kelly green #39b54a primary, dark green #14532d accents/dark
  surfaces. Tailwind theme colors kelly-50/100/500/600/700 and
  pine-700/800/900. Logo files in public/brand/ are used as-is, never
  recolored.
- No em dashes anywhere in UI text or generated documents.
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
