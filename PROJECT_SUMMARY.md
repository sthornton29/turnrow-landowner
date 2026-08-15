# Turnrow Landowner: Project Summary

Last updated: 2026-08-15 (end of Phase 3)

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

## Environment variables (local .env.local and Vercel)

- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY
- NEXT_PUBLIC_MAPBOX_TOKEN
- ANTHROPIC_API_KEY (server-side only, no NEXT_PUBLIC_ prefix; used by
  /api/extract for AI document extraction with claude-sonnet-4-6)

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
  unique (id, organization_id) as a composite-FK target
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
  - /map: full-screen Mapbox satellite map. Six toggleable layers:
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
    location via GPS; moving a pin reuses the same mode). Geometry edits
    use mapbox-gl-draw vertex editing; acres/miles recompute server-side
    on every save. CSS-based fullscreen toggle (not the native Fullscreen
    API, so iOS modals stay visible). /map?focus=asset:<id> zooms to and
    selects an entity (used by list pages).
  - /import: upload GeoJSON/JSON, KML, KMZ, zipped shapefiles. Polygons
    can be assigned as property/parcel/field/timber stand, lines as
    road/pipe/fence, points as assets (with type). Preview map, per-feature
    review before saving, failures skipped and reported. Properties in a
    batch save first so other rows can reference them.
  - /properties, /properties/[id], /parcels, /fields: non-map browsing with
    acres totals and inline editing. Property detail lists its parcels,
    fields, timber stands, roads, and assets; delete property cascades.
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
  - /income: year selector, expected-vs-received bar chart by year, tables
    by income type (agricultural/hunting/timber) and by property (lump
    sums allocated across linked properties by leased acres; timber by
    linked stand acres; unallocable income shown as Unassigned). Property
    detail pages show their allocated income; the dashboard shows a
    "Payments needing attention" card (past due + due within 60 days).

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
- Phase 4: property taxes module (statement uploads, all-parcels
  completeness check, payment tracking).
- Phase 5: county GIS parcel import from ArcGIS REST services.
- Phase 6: read-only partner API integration with Turnrow farm software
  (plantings, yields, harvest status on landowner fields).
