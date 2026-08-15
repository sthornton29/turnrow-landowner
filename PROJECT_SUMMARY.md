# Turnrow Landowner: Project Summary

Last updated: 2026-08-15 (end of Phase 1)

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

## Database schema (migration supabase/migrations/0001_phase1_schema.sql)

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
  (entity_type check constraint currently 'property' | 'parcel' | 'field';
  later phases extend it with asset, lease, timber_sale, tax_statement).
  Files live in the private "documents" storage bucket under
  <organization_id>/<entity_type>/..., with storage RLS keyed on the first
  path segment.

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
  - /dashboard: stat tiles (total acres, properties, fields, field acres),
    static satellite thumbnail (Mapbox Static Images API) linking to the
    map, quick links.
  - /map: full-screen Mapbox satellite map. Layers: properties (white
    outline), parcels (dashed light line, gold in import preview), fields
    (kelly green fill/line), labels from computed label points. Layer
    toggles, click-to-select with detail panel (right card on desktop,
    bottom sheet on mobile), edit details inline, draw new boundaries
    (mapbox-gl-draw), edit existing vertices, delete. CSS-based fullscreen
    toggle (not the native Fullscreen API, so iOS modals stay visible).
    Acres recompute server-side on every boundary save.
  - /import: upload GeoJSON/JSON, KML, KMZ, zipped shapefiles. Parsed
    client-side; preview map; per-feature review (include, type, name
    prefilled from attributes, property assignment, approximate acres)
    before anything is saved. Features that fail to parse are skipped and
    reported. Properties in a batch are saved first so parcels/fields in the
    same batch can reference them.
  - /properties, /properties/[id], /parcels, /fields: non-map browsing with
    acres totals and inline editing of names/county/notes. Property detail
    lists its parcels and fields; delete property cascades.
  - /settings/members: member list, invite by email (owners only), revoke
    pending invites.

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
- Phase 2: timber stands and roads layers; fixed asset layer with detail
  pages and document attachments (documents table + bucket already exist).
- Phase 3: ag and hunting leases with AI term extraction and income
  projection; timber sale contracts.
- Phase 4: property taxes module (statement uploads, all-parcels
  completeness check, payment tracking).
- Phase 5: county GIS parcel import from ArcGIS REST services.
- Phase 6: read-only partner API integration with Turnrow farm software
  (plantings, yields, harvest status on landowner fields).
