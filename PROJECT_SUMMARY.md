# Turnrow Landowner: Project Summary

Last updated: 2026-08-21 (documents overhaul: pattern titles with
inline rename and a one-time title review, a document page per file
with in-place editing, rescan, replace file with kept versions, and
follow-on actions, a calm one-list Documents page with a group rail,
and the Farm Data summary band by entity and by tenant with drill-in,
migration 0028; 2026-08-20 night: AI-first document intake replacing
the upload pickers, FSA farm numbers editable on the property page with
156EZ farms linking to properties by number and splitting pro rata by
ag field acres, model request size caps; earlier that evening: documents attach to several
properties, Unfiled documents, AI property matching with the owner's
property list, 156EZ multi-farm packets, resumable uploads and scan by
storage path, migrations 0023 to 0026; earlier the same day: document vault with a typed taxonomy, AI
classification and per-type scans, and boundary plotting from deeds
and plats, migration 0020; government payments (FSA farms, base acres,
PLC / ARC-CO projections, income share), migration 0021; the Ask data
assistant on a read-only RLS seam, migration 0022; Help Center with a
"?" drawer, how-to chat, and Contact support)

## DEPLOY CHECKLIST (this release)

00. Run 0029_land_index_aliases.sql in Supabase BEFORE this deploy goes
   live (2026-08-21, later the same day; NOT YET RUN at the time of
   writing): land_sections (which BLM sections each property and parcel
   touches, built by POST /api/land-index), property_aliases (the
   historical tract names deeds use), and the boundary_bbox RPC. The
   intake flow calls /api/land-index on open and queries land_sections
   and property_aliases; without the migration the queries fail quietly
   and matching falls back to the live BLM path.

0. Run 0028_document_pages.sql in Supabase BEFORE this deploy goes
   live (2026-08-21, NOT YET RUN at the time of writing): it adds
   documents.notes / title_reviewed / extraction_history / updated_at,
   document_properties.evidence, the document_versions table (org
   RLS), and sets every empty title to the cleaned file name. The
   document page (/documents/[id]) and /documents/titles read those
   columns and fail without it. After the deploy, open
   /documents/titles once to review the backfilled titles.

1. Run migrations 0020_document_vault.sql, 0021_gov_payments.sql,
   0022_assistant.sql, 0023_document_properties.sql,
   0024_unfiled_documents.sql, 0025_storage_limits.sql, and
   0026_storage_bucket_unlimited.sql, and
   0027_match_boundaries.sql (the match_boundaries overlap RPC behind the
   intake's spatial matching; SECURITY INVOKER, RLS applies) in Supabase, in that order, BEFORE
   the deploy goes live (the Documents page reads documents.doc_type and
   the government payments pages read the fsa_* tables; a deploy without
   the migrations breaks those pages). All seven were run on 2026-08-20.
   STORAGE LIMIT LESSON (2026-08-20): the documents bucket now carries
   NO file_size_limit (0026 cleared the 200 MB cap 0025 had set, since a
   bucket cap always wins over the project-wide limit). The project-wide
   limit lives in the dashboard under Storage > Settings > Upload file
   size limit (Pro plan); saving it once left Storage still enforcing
   the 50 MB Free default (probed: 52,428,800 bytes accepted, one byte
   more returned 413) until the value was re-saved. When an upload says
   "Maximum size exceeded", probe the real limit with a tus creation
   request (POST /storage/v1/upload/resumable with Upload-Length) rather
   than trusting the dashboard.
2. Set the new Vercel env vars: NASS_API_KEY (USDA Quick Stats),
   RESEND_API_KEY, SUPPORT_EMAIL, and optionally SUPPORT_FROM. Contact
   support returns a clear 503 until the Resend vars exist; NASS price
   refresh returns 503 until NASS_API_KEY exists; everything else
   works without them.
3. `npm run help:build` runs automatically as the prebuild step and
   compiles docs/help into lib/helpContent.generated.ts (that generated
   file is ALSO committed, so a build that skips prebuild still has
   help content). The build FAILS if a nav route has no help topic or
   any topic contains an em dash.
4. Confirm the Vercel deploy is green, then test.

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
- Anthropic API (claude-sonnet-4-6) for AI document extraction and
  classification (/api/extract), the Ask data assistant
  (/api/data-assistant, streaming tool loop), and the help chat
  (/api/support-chat, streaming, no tools)
- Resend (plain fetch to api.resend.com, no SDK) for Contact support
  emails; BLM PLSS CadNSDI ArcGIS REST (gis.blm.gov) for section
  polygons, queried through the same server-side ArcGIS utilities as
  the county import (lib/gisServer.ts, now URL-generic with spatial
  query, timeout, and label options); USDA NASS Quick Stats and the FSA
  ARC-CO benchmark workbook for government payment inputs
- Help content pipeline: docs/help/*.md (front matter title, route,
  group, order, updated, keywords) compiled by scripts/build-help.mjs
  (`npm run help:build`, wired as `prebuild`) into
  lib/helpContent.generated.ts, a committed generated module (no
  runtime fetch), plus docs/help/_digest.md for the help chat prompt
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
  easement catalog (every type styled and categorized, legend
  presence, legacy-row migration), circle footprints (area, rim-drag
  round trip, details round trip, diameter sync, sq ft vs acres
  formatting), timber settlement spreadsheet collapse + MBF/Doyle
  handling, timber allocation math, document taxonomy completeness,
  metes-and-bounds traverse (DMS parsing, units, curves, closure and
  compass-rule force close, georeferencing), PLSS aliquot subdivision
  (parsing, quarter/half UV math, section cutting, exceptions), PLSS
  where builder and cache keys, plot preview helpers, NASS Quick Stats
  parsing and seed cotton blend, FSA benchmark workbook discovery and
  parsing, program config resolution, PLC and ARC-CO engines with
  worked examples, government payment projection and allocation,
  income government line, assistant SQL guard mirror, assistant tool
  schemas, help route matching and search and nav coverage)

## Environment variables (local .env.local and Vercel)

- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY
- NEXT_PUBLIC_MAPBOX_TOKEN
- ANTHROPIC_API_KEY (server-side only, no NEXT_PUBLIC_ prefix; used by
  /api/extract for AI document extraction and classification, by
  /api/data-assistant for the Ask assistant, and by /api/support-chat
  for the help chat, all claude-sonnet-4-6)
- NASS_API_KEY (government payments; free key from
  quickstats.nass.usda.gov; /api/gov/nass-monthly-prices returns 503
  without it)
- RESEND_API_KEY, SUPPORT_EMAIL (the address support messages go to),
  SUPPORT_FROM (optional; a Resend-verified sender, defaults to
  "Turnrow Landowner <support@turnrow.farm>"); /api/support-contact
  returns a clear 503 while RESEND_API_KEY or SUPPORT_EMAIL is unset
- FARM_API_BASE_URL (Phase 6; base URL of the farm software's partner API,
  e.g. https://<farm-domain>/api/partner/v1, no trailing slash)
- FARM_API_ENCRYPTION_KEY (Phase 6; 64 hex chars, AES-256-GCM key that
  encrypts farm API tokens at rest in farm_connections)
- CRON_SECRET (Phase 6; shared secret Vercel sends when invoking the
  /api/farm/sync cron; the route rejects anything else)
- SUPABASE_SERVICE_ROLE_KEY (Phase 6; used ONLY by the cron sync, which
  runs with no signed-in user and scopes every query itself, and by the
  GLOBAL public-data cache writers: RMA prices, the PLSS section cache,
  the FSA benchmark cache. NEVER in the assistant path.)

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
  property; edited on the property page through the FSA FARM NUMBERS
  card (components/properties/FsaNumbersCard.tsx: chips with add and
  remove, saved immediately) and comma-separated in the map panel /
  RowEditor via the shared EditField "list" flag; shown as chips in
  the list line and the click panel). These numbers are the key that
  lets a scanned FSA-156EZ land its farms on the right land (see
  lib/gov/fsaImport.ts below).
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
- easements (migration 0019; born as utility_easements in 0016 as
  lines, polygons in 0017, renamed and expanded in 0019 with data
  kept): every recorded right someone else holds over the land, or
  that the owner holds over a neighbor. ALWAYS labeled "easement" in
  UI text (never "utility easement"; a pipeline easement is the
  company's corridor, never the farm's own underground irrigation
  pipe asset). Columns: organization_id, property_id NULLABLE
  (easements cross property lines; property deletion DETACHES via set
  null), name, easement_type check over 14 types in five style
  categories (lib/easements.ts is the single source of truth, unit
  tested against the SQL list): utility = powerline, pipeline,
  waterline_sewer, telecom_fiber; access/transport = access_row
  (private ingress/egress), public_road_row, railroad; water =
  drainage, flowage (TVA/Corps reservoir flooding rights); conservation
  (land trust or NRCS WRE/ALE style, often large polygons); neutral =
  cemetery_access, construction_temp, solar_wind, other.
  relationship = burdens_this_property (default; migrated rows got it)
  | benefits_this_property (an access easement the owner HOLDS over a
  neighbor; geometry outside the owner's boundary is expected).
  holder, recorded_ref, expiration_date (null = permanent/indefinite;
  temporary construction and term easements set it), width_ft
  (informational on LINE easements, never auto-buffered; draw the
  polygon for the strip), elevation_ft (flowage contour), program and
  restrictions (conservation holder/program detail and restrictions
  notes), notes. GEOMETRY IS LINE OR POLYGON PER EASEMENT: boundary
  MultiPolygon with the generated acres column, OR geom
  MultiLineString with generated length_feet/miles (the roads
  formula), with a check that both are never set; set_geometry's
  'easement' branch takes either GeoJSON (polygons win when present,
  the other column is nulled) and returns acres or miles. easements_geo
  exposes boundary_geojson and geom_geojson; the app reads whichever
  is set. documents entity_type 'utility_easement' rows were rewritten
  to 'easement' (storage paths already written under
  <org>/utility_easement/ stay valid; storage RLS keys on the org
  segment). SEVERED MINERAL RIGHTS ARE NOT AN EASEMENT and are
  deliberately absent: a future "encumbrances" area will hold mineral
  severances, liens, and the like. Map styling is BY CATEGORY, not per
  type (14 colors would be noise), built once in
  components/map/easementLayers.ts and shared by the live map and the
  print renderer: utility keeps the pre-0019 red/orange treatments
  (powerline red long-dash, pipeline safety-orange dot-dash, waterline
  and telecom fine dots); access/transport brown #92400e / tan #b45309
  with distinct dashes and railroad a tie pattern (a second wide
  short-dash line over the rail line); water blue #2563eb dashed, with
  flowage polygons a stronger translucent fill; conservation
  magenta-violet #a21caf as a canvas HATCH over a faint fill (checked
  against mixed-timber deep violet #7c3aed: a hue step apart AND hatch
  vs solid, so they never read the same); cemetery/construction/solar/
  other gray variants. Line easements draw wider than polygon outlines
  and carry a wide invisible hit layer. The live legend and the PDF
  legend list only categories present in view (plus a Railroad row
  when one exists); the click panel, /easements/[id], and RowEditor
  show the exact type and every field (length for lines, acres for
  polygons). Drawn via the pick-first flow (Add > Draw > Easement >
  Line or Area) with the save form already set to Easement: type
  select, relationship toggle with a "drawn outside your boundary is
  expected" hint for benefits, holder, recorded ref, expiration, width
  (lines only), flowage elevation (flowage only), program and
  restrictions (conservation only), notes, property optional.
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
  PARCEL NUMBER CANONICAL FORM (2026-08-21, lib/parcelNumber.ts, unit
  tested): one equivalence shared by the tax statement matcher
  (lib/tax.ts normalizeParcelNumber), the document matcher
  (parcelKey), lease land, and the county import. Segments split on
  any punctuation or space; TRAILING ZERO-ONLY SEGMENTS are dropped
  (".000" and the "-0" sub-parcel suffix Alabama tax statements print
  carry no identity), so "07-09-31-0-000-003.000-0" on a 2025 statement
  equals the stored "07 09 31 0 000 003.000"; a non-zero suffix
  (003.001) stays distinct. parcelKey keeps leading zeros so a
  run-together printing still matches; canonicalParcel drops them for
  unpadded shorthand. Unmatched statements relink from the Taxes
  page's "Match to parcel" select.
  DESCRIPTION MATCHING, SECOND PASS (2026-08-21, migration 0029; the
  fix for a Lawrence County deed that the intake failed to place):
  lib/spatialEvidence.ts is the ONE spatial tier, shared by /api/extract
  (inside the intake pass) and POST /api/spatial-match (the confirm
  screen's Retry and the document page's "Check the description again";
  no model call). collectReferences merges EVERY reference: the AI's
  plss_reference and the new plss_references array, the mb_anchor, and
  a deterministic regex pass over the verbatim legal description
  (lib/legalRefs.ts extractPlssReferences, statedAcresOf,
  countyStateOf; unit tested, including "Sections 29 and 32, T4S R7W"),
  deduped by section/T/R, up to 6 tracts, county and state defaulted
  from the description text or the hints. Each tract resolves through
  resolvePlssReference (12 s each); a section already in the caller's
  LAND INDEX skips the live county lookup (knownSection). The tracts
  are unioned into one MultiPolygon for match_boundaries. The evidence
  carries reason (no_reference | county_mismatch | lookup_failed |
  overlap_failed | null), whole_section, stated_acres, references,
  tract_count, and is PERSISTED in documents.extracted (spatial,
  plss_references, stated_acres) so the document page shows it.
  PARCEL FIT (lib/documentMatch.ts spatialSuggestions, tested in
  documentMatchFit.test.ts): a whole-section tract with a stated
  acreage whose one parcel inside the section (>= 90% within) sits
  within PARCEL_FIT_TOLERANCE 15% of it is THAT parcel: score 85,
  reason "parcel 07 09 31 0 000 003.000 (118.1 acres) on Shop Area fits
  the 120 acres described in Sec 31, T4S R7W, Huntsville PM", parcelId
  on the suggestion, offered as the specific record. Otherwise a whole
  section is a search window: only the largest share is strong (80)
  and pre-checked; the neighbors in the section are listed at 60
  unchecked. Quarter-chain tracts keep pre-checking every overlap.
  LAND INDEX (POST /api/land-index, called fire-and-forget when the
  intake opens): for every property whose boundary or parcels changed
  since it was indexed, fetch the BLM sections in its bbox
  (boundary_bbox RPC, section layer by envelope), cache them in
  plss_cache (service role), intersect each with match_boundaries on
  the session client, and store land_sections rows (entity_type
  property | parcel, section_key, T/R/section/meridian, overlap acres,
  pct of section, pct of boundary). Idempotent; 100 s budget; failures
  reported per property. PROPERTY ALIASES (property_aliases): fed to
  the AI context ("also called ..."), matched by verifyMatches on a
  name claim or with no claim at all (an alias on the page scores 55),
  learned one tap at a time from the SavedPanel ("Remember 'View
  Celeste' means Shop Area", from property_hints.place_names, generic
  words skipped) and managed on the property page ("Also called").
  Verified by hand on the DLM deed: the text-only path places it on
  Shop Area, parcel 07-09-31-0-000-003.000, in 1.5 s.
  SPATIAL PROPERTY MATCHING (migration 0027): the intake tool also
  returns a structured plss_reference (county, state, meridian hint,
  township number + N/S, range number + E/W, section, aliquot text,
  exceptions) and an mb_anchor for metes and bounds. After the AI pass
  the route resolves it server-side through lib/plssResolve.ts (the
  same engine as the plot screen: meridian pinned from the deed's
  county via lib/plssMeridians, BLM CadNSDI section layer with the
  plss_cache, aliquot subdivision or the whole section when the text is
  not an aliquot, and the TIGERweb county gate; a county mismatch
  returns no polygon with the note "resolved to X County, the deed says
  Y"; time-boxed to about 12 s; never throws) and intersects the
  described polygon with the caller's boundaries through the
  match_boundaries RPC on the SESSION client (overlap acres, percent of
  the described area, percent of the boundary; RLS applies). Failures
  attach notes only and the name/number signals stand. Scoring
  (lib/documentMatch.ts spatialSuggestions, unit tested in
  documentMatchSpatial.test.ts): an overlap is shown ONLY when the
  intersection actually computed; >= 50% of the described area scores
  80, 5% to 50% scores 60, parcels map to their property without double
  counting; the why line reads "describes land in Sec 12, T4S R8W,
  Huntsville PM, overlapping River Place (94% of described area)".
  verifyMatches now returns preselect + conflict: every overlapping
  property (>= 5%) is pre-checked alongside confident signals, but when
  a parcel/FSA number names one property and the description overlaps
  only another, both are listed with their evidence and NOTHING is
  pre-checked (conflict). The confirm screen shows an "Evidence from
  the description" block (reference label, county check result,
  described acres, each overlap line, a small static map chip of the
  described tract when the URL fits) in green, amber on conflict, red
  when the county gate failed.
  LARGE DOCUMENTS AND 156EZ PACKETS (migrations 0025 + 0026): the
  documents bucket has no size cap of its own (the dashboard's
  project-wide Storage limit is the single control, see the deploy
  checklist); uploads over 6 MB use Supabase's RESUMABLE protocol
  (tus-js-client, exactly 6 MB chunks, retries, resume of an
  interrupted upload; uploadToStorage in components/documents/
  classify.ts) and smaller files the plain upload; a storage-limit
  failure shows a fix-it message and files over 30 MB get a
  non-blocking heads-up. SCANS GO BY STORAGE PATH: ScanDocumentButton
  posts only storage_path/file_name/content_type and /api/extract
  downloads the file itself under the caller's session (RLS applies),
  so a 60 MB packet never passes through Vercel's 4.5 MB request body
  limit; the route allows 300 s (maxDuration) for long packets.
  /api/extract accepts PDFs up to 100 MB and splits long ones with
  pdf-lib (app/api/extract/pdfChunks.ts): classification and intake
  read the first 20 pages, single-record scans the first 90
  (pages_scanned/total_pages recorded and an unsure note when
  truncated), and FSA-156EZ reads EVERY 90-page chunk (two at a time)
  and merges farms by farm number (mergeFsaExtractions in
  lib/gov/fsaImport.ts, unit tested). MODEL REQUEST SIZE CAP: the
  Anthropic API rejects requests over 32 MB AFTER base64 (x1.33), so
  every PDF slice sent to the model stays under MODEL_PDF_MAX_BYTES =
  18 MB raw: firstPages halves its page count until the slice fits
  (a scanned packet runs several MB per page) and splitPdf re-splits
  oversized chunks; a 413 from the API reads as a plain "too large in
  one piece, split the PDF or enter by hand" message. The intake
  flow uploads the file to storage FIRST (<org>/intake/<uuid>-<name>,
  resumable over 6 MB) and the server reads it by path, the same
  no-request-body rule as scans; an abandoned intake removes its
  object. The 156EZ extraction is now
  { farms: [...] } (one entry per distinct farm; legacy single-farm
  extractions still read); the review shows one card per farm with its
  base acres grid, and confirming offers to create or update every farm
  at once. AI-FIRST INTAKE (the one upload path, components/documents/intake/
  IntakeFlow.tsx): drop the file, confirm what the AI found, save. ONE
  forced-tool pass (/api/extract kind=intake, record_document_intake)
  returns the proposed doc_type with confidence, a specialized_kind when
  the file is really a lease / timber contract / timber settlement /
  tax statement / rent payment, property_hints, matched_properties
  (each citing its SIGNAL parcel|fsa|name|alias|county and the printed
  value), matched_entity, and fields (the union of every per-type
  schema, so EXTRACTED_FIELDS renders them unchanged). The call carries
  the org's matching context: property names with county/state,
  parcel numbers, FSA farm numbers, acres, and entity names with
  confirmed entity_aliases. The intake reads the first 20 pages; a
  156EZ packet longer than that gets the full chunked farm scan inside
  the same request. DETERMINISTIC VERIFICATION (lib/documentMatch.ts
  verifyMatches, unit tested in documentMatchVerify.test.ts): a parcel
  claim must match parcelKey() of a parcel on that property, an FSA
  claim a digits-only farm number on it, a name claim must appear on
  the page, an alias claim must match (normalizeOwnerName /
  ownerSimilarity) the entity that holds the property or one of its
  aliases, county counts only when the property is the only one in
  that county; anything that fails is DOWNGRADED (never shown as a
  match), so no guess wears real confidence, and no match = the
  property picker starts empty. The confirm screen (always shown; file
  preview beside on desktop, above on mobile) has the type dropdown
  preselected with a confidence hint, the properties multi-select with
  verified matches pre-checked and their why lines, the entity line
  when verified, the type's fields in the shared amber editor
  (components/documents/ExtractedFieldsEditor.tsx, also used by
  re-scans), a title, and an optional specific record; nothing saves
  until Save writes the document, type, links, and reviewed fields
  together. SavedPanel then offers Plot boundary (when applicable),
  Create or update N FSA farms (156EZ), Open, Upload another.
  CONTEXT-AWARE ENTRY: EntityDocuments opens the same flow with the
  page's record as the default attachment (plus its property link);
  when a verified match points elsewhere a non-blocking note ("this
  deed appears to describe River Place") offers Switch or Attach to
  both; when the AI agrees or finds nothing the context wins silently.
  HANDOFF: a recognized specialized_kind shows a banner whose one tap
  parks the File in IndexedDB (lib/fileHandoff.ts, one-time key, 10
  minute TTL) and opens /leases/new, /timber-sales/new, /taxes/upload,
  or /income (rent upload, also timber settlements) with ?handoff=key;
  those clients pick the file up and run their existing extraction;
  nothing is saved by the handoff. MANUAL PATH: a quiet "Enter details
  manually instead" link on the upload and confirm screens switches to
  the plain form (file kept; with proposals present it asks whether to
  keep them as starting values); manual and AI never render side by
  side. FAILURES (unreadable file, error, 429) drop into the manual
  form with the file attached and a plain message; no retry loop.
  Asset pages keep a quick Add photos button (gallery, no reading).
  DELETE: Documents page rows and property pages offer Delete; a
  document linked to several properties viewed through one of them
  asks Remove (from this property only) or Delete everywhere;
  otherwise confirm and delete the file and row. The older classify
  kind and the per-type scan kinds remain for re-scanning saved rows.
  UNFILED DOCUMENTS (migration 0024): documents.entity_type gains
  'organization' (entity_id = the organization id); with nothing
  checked the document saves as Unfiled; /documents shows an amber
  Unfiled section at the top, an Unfiled option in the property
  filter, and Edit properties re-points the primary attachment to the
  first property chosen (or back to Unfiled).
  MULTI-PROPERTY DOCUMENTS (migration 0023): document_properties
  (org RLS, composite FK to properties, unique per document+property,
  backfilled from every property-attached document) lists EVERY
  property a document applies to; documents.entity_type/entity_id stay
  the PRIMARY attachment (the page's record, a chosen specific record,
  else the first property); rows show linked properties as chips with
  Edit properties; property filters follow the links.

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

Government payments (migration 0021; engine in lib/gov/, ported from
the farm software per docs/GOV_PAYMENTS_PATHWAYS.md with payment
limits, Barchart futures, and SCO dropped):

- Per-org (org RLS + composite FKs): fsa_farms (farm_number, state,
  county, farmland_acres, cropland_acres, dcp_cropland_acres, notes,
  source_document_id; unique org + farm_number + state + county),
  fsa_farm_properties (farm -> property with allocation_pct 0..100,
  default 100; a split farm carries several rows), fsa_base_acres
  (commodity slug in corn, soybeans, wheat, seed_cotton, grain_sorghum,
  oats, barley, peanuts, canola, sesame; base_acres, plc_yield,
  tract_numbers text[]; unique farm + commodity), fsa_elections (farm x
  commodity x program_year: plc | arc_co | arc_ic; the app defaults to
  PLC when no row exists).
- GLOBAL admin-curated (select to all authenticated, writes gated on
  private.is_platform_admin(), edited in Settings > Admin: government
  payment program parameters): covered_commodities (seeded with the
  OBBBA 2025-2031 statutory reference prices, national loan rates,
  units, marketing-year start months: corn 4.10/2.42 MY9, soybeans
  10.00/6.82 MY9, wheat 6.35/3.72 MY6, seed cotton 0.42/0.25 MY8,
  grain sorghum 4.40/2.42 MY9, oats 2.65/2.20 MY6, barley 5.45/2.75
  MY6, peanuts 0.315/0.195 MY8, canola 0.2015/0.1009 MY7, sesame
  0.2015/0.1009 MY9; lint/cottonseed shares and month weights
  nullable), program_year_config (crop_year column kept so the ported
  resolver is verbatim; seeded 2025, 2026, 2027 with arc_guarantee
  0.90, arc cap 0.12, ERP olympic factor 0.88, ERP cap 1.15, payment
  factor 0.85, ARC-IC factor 0.65, sequestration 0.054; exact year ->
  most recent earlier -> earliest -> era defaults, non-exact flagged
  isFallback), arc_plc_price_data (commodity x program_year:
  effective_reference_price, mya_price_estimate, mya_price_final,
  wasde_midpoint, benchmark_price, source, note; seeded FSA-published
  ERPs corn 4.42, soybeans 10.71, wheat 6.35 and national benchmark
  prices 5.03 / 12.17 / 6.98 for 2025 and 2026), mya_monthly_prices
  (confirmed NASS months, source usda | manual with an audit note).
- GLOBAL server-refreshed (select only; service role writes, write-
  then-swap): fsa_benchmark_cache (unique data_year, state_code,
  county, commodity, practice) and fsa_benchmark_fetches (the 24 h
  per year x state guard against fsa.usda.gov).
- Math (lib/gov/govPayments.ts, pure, unit-tested with worked examples
  in the test names): PLC rate = max(0, ERP - max(MYA, loan rate)),
  gross = rate x PLC yield x base acres, net = gross x 0.85 x (1 -
  0.054) (corn ERP 4.42, MYA 4.10, yield 150, base 100 => 0.32 rate,
  4,800.00 gross, 3,859.68 net); ARC-CO guarantee = 0.90 x benchmark
  price x benchmark county yield, shortfall vs actual revenue, rate
  capped at 0.12 x benchmark revenue, same netting; flat fallback when
  no benchmark row (labeled "flat est." with the reason); ERP = min(1.15
  x statutory, max(statutory, 0.88 x Olympic average of the 5 lagged
  MYAs)) with an FSA-published ERP winning; MYA precedence final >
  manual > WASDE midpoint > NASS blend estimate (published months only,
  marketing-weighted, no futures); seed cotton blended monthly from
  lint cents/lb and cottonseed $/ton (0.43 / 0.57). PAYMENT-YEAR
  ATTRIBUTION: program year N pays October N+1; the +1 lives only in
  revenueCropYearFor / programYearFor / expectedArcPlcDate.
  lib/gov/govProjection.ts projectFarms (election default PLC, drivers
  and notes per row) + allocateToProperties by allocation_pct
  (unlinked farms roll to UNLINKED_FARM); lib/gov/govData.ts
  loadGovInputs / projectOrg / projectForPaymentYear are the ONE engine
  the page, the summary cards, the income line, and the assistant all
  call. No producer payment limits anywhere (the tenant's world).
- lib/gov/fsaImport.ts createOrUpdateFarmFromExtraction(supabase,
  orgId, extracted, { sourceDocumentId, propertyId }) turns a reviewed
  FSA-156EZ scan into a farm + base acre rows (fuzzy commodity
  matching via lib/crops.ts canonicalCrop; unmatched commodities are
  reported, never guessed); createOrUpdateFarmsFromExtraction handles
  a whole packet. PROPERTY LINKING BY FSA NUMBER: the farm links to
  every property whose fsa_numbers contain the farm number (digits
  compared); when several properties share one farm number the
  allocation_pct splits PRO RATA by each property's ag field acres
  (sum of fields.acres per property; rounding drift lands on the last
  property so the shares total 100; equal shares only when no field
  acres exist to weigh by). Only when no property carries the number
  does the farm link to the page the 156EZ was uploaded from. The
  result carries linkedProperties and the confirm message says
  "linked to River Place" or names farms still unlinked with a nudge
  to add the number on the property page or link on Government
  Payments. Called from the intake SavedPanel and the scan review with
  an explicit confirm; manual entry on /gov-payments works without a
  scan.
- Routes (session required): GET /api/gov/nass-monthly-prices
  (commodity + year; 24 h in-process promise cache; POST lets a
  platform admin save confirmed months), POST /api/gov/fsa-benchmark
  (cache-first lookup, fetch guard, data_year reported when an older
  file is served, not_found shape), POST /api/gov/mya-estimate (the
  blend for display; persists mya_price_estimate only for platform
  admins and never over a manual or final value).
- GOVERNMENT PAYMENT TREATMENT ON SHARE AND FLEX LEASES (explicit, not
  a defaulted percent; jsonb only, no migration): LeaseTerms carries
  gov_payment_treatment (landowner_share | tenant_retains, REQUIRED by
  the lease form on crop share and flex), gov_payment_share_pct
  (prefilled from landowner_share_pct when the landowner share is
  chosen, editable), gov_payment_received_via (fsa_direct |
  tenant_remits, required with landowner_share), and
  gov_payment_clause (verbatim from extraction). govPaymentTreatment()
  in lib/leaseLogic.ts resolves older leases in-app: a nonzero share
  reads as landowner_share (received via unknown, flagged "confirm"),
  otherwise tenant_retains, both flagged not yet chosen until saved;
  the lease form preselects that default with a note. EXPECTED ROWS:
  generateLeasePayments(lease, acres, assumptions, govShareByProgramYear)
  adds "Government payment share (program year Y)" rows due Y+1-10-01
  ONLY for landowner_share + tenant_remits (the lease page loads the
  amounts through govShareByYearForLease on the income engine); FSA
  direct and tenant retains never generate rows, so the rent-upload
  matcher never expects FSA money in a tenant check (RentUpload shows
  "FSA pays the government share directly; not expected in tenant
  checks" on such leases). lib/income.ts types generated gov rows as
  IncomeType "government" by their label (never blocking the rent
  projection for that year), skips the projection for a lease-year
  that has a generated gov row, and counts payments recorded against a
  gov row as received government income; govShareRows carries
  treatment/receivedVia/generated. The lease AI extraction proposes
  gov_payment_clause/treatment/share/received_via (amber, reviewed).
  Lease detail pages and /gov-payments show the treatment per lease in
  a plain sentence; the informational "generates about $X/yr to your
  tenant" line shows only when every share lease leaves the payments
  with the tenant; the Income page labels FSA-direct shares "paid by
  FSA directly".
- Leases: LeaseTerms.gov_payment_share_pct (jsonb only, default 0) on
  crop share and flex terms, edited on the lease form.

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
  Properties, Timber, Assets, Leases, Property Taxes, Income, Gov
  Payments, Documents, Ask, Farm Data, Import, then the "?" help
  button and a gear icon for /settings. Bottom tab bar on mobile (Map,
  Home, Properties, Leases, Income) with the "?" and the gear in the
  top bar. ONE SETTINGS PAGE (/settings): Members section (list,
  invites, roles; owner-only invite form), Admin section (the
  platform-admin county GIS registry rendered inline via
  AdminGisClient embedded mode, platform admins only), an Admin
  "government payment program parameters" section
  (components/gov/AdminProgramParams.tsx editing covered_commodities,
  program_year_config, and arc_plc_price_data rows, platform admins
  only), and Sign out. /settings/members and /admin/gis redirect there.
  - /documents (DOCUMENT VAULT, redesigned 2026-08-21: ONE organizing
    system at a time): a single recent-first list of DocumentCards
    (components/documents/DocumentCard.tsx: group icon from
    DocTypeIcon.tsx, title, DocTypeChip, first two property chips
    plus "+N", the non-property attachment label, an amber Unfiled
    chip, date); the WHOLE card is one link to /documents/[id] and the
    only other control is a pencil (outside the link) for inline
    rename (Enter saves via renameDocument, Escape cancels). Search at
    the top (title, file name, search_text, attached-to label,
    property names, extracted highlights) with one compact select
    beside it (Unfiled, then Properties and Entities optgroups; value
    p:<id> / e:<id> / unfiled). TYPE NAVIGATION replaces the old
    always-on group headers: a slim left rail on desktop (All plus the
    seven taxonomy groups with counts; the selected group expands its
    types with counts) and horizontally scrolling chip rows on mobile
    (groups, then the selected group's types). Counts reflect the
    search and property filter but not the type filter. GROUP BY
    segmented control None | Type | Property (default None; Property
    lists a document under every property it links to, plus "Not on a
    property" and Unfiled); headers render only when chosen. Filters
    live in the URL (q, filter, group, type, groupBy; router.replace,
    Suspense-wrapped) so Back from a document page restores the view.
    Upload is the single primary button (IntakeFlow modal); amber
    links beside it only when non-zero: "Review N titles"
    (/documents/titles, title_reviewed = false) and "Type N untyped"
    (/documents/retype). Per-filter empty states ("No warranty deed
    documents yet. Upload one and Turnrow will read it.", "Nothing
    filed to River Place yet.", "Nothing matches 'x'."). Rows carry NO
    extracted-field clutter and no Open / Scan / Plot / Delete / type
    change / edit properties; all of that lives on the document page.
  - DOCUMENT TITLES (2026-08-21): documents.title is what every list,
    chip, search result, and entity-page section shows
    (lib/documentTitle.ts displayTitle; the cleaned file name is the
    display floor). proposeTitle(docType, extracted, fileName,
    { uploadedAt, propertyName }) is the ONE pattern generator, unit
    tested: "Warranty Deed - <grantor> to <grantee> (<year>)", "Survey
    Plat - <property or surveyor>, <acres> acres (<year>)", "FSA-156EZ
    - Farm <n> (<year>)" (several: "Farms 1, 2"), "Title Insurance -
    <property or insurer> ($<amount>, <year>)", determinations "<Type>
    - Tract <n> (<year>)", generic "<Type> - <parties> (<year>)";
    missing pieces drop cleanly and nothing extracted gives "<Type> -
    <cleaned file name>". The intake tool's title field carries the
    same pattern (TITLE_PATTERN_HINT in vaultTools.ts) so the AI's
    proposal matches; the confirm screen's Title stays editable; Save
    uses the user's title, else the AI's, else proposeTitle. New
    uploads save title_reviewed = true. Migration 0028 set every
    empty title to the cleaned file name; /documents/titles
    (TitlesReviewClient.tsx) is the ONE-TIME REVIEW of rows with
    title_reviewed = false: DocTypeChip, current title, an input
    prefilled with proposeTitle (first linked property's name as the
    property), file name small; Enter saves (renameDocument) and
    focuses the next row, Escape restores the proposal, "Use proposed
    for all", "Apply N" (sequential with progress), per-row Keep
    current; "All titles reviewed" when empty.
  - /documents/[id] (THE DOCUMENT PAGE, 2026-08-21, the summary
    template family: app/(app)/documents/[id]/page.tsx server load of
    the row, document_properties with evidence, document_versions,
    properties, the uploader profile, an fsa_farms row by
    source_document_id, and the primary non-property attachment's
    label and href; DocumentPageClient.tsx). SummaryHeader with
    breadcrumb Documents / title, type badge, key figure = the first
    extractedHighlight, and FOLLOW-ON ACTIONS as buttons: Plot
    boundary (canPlotBoundary), View FSA farm (156EZ), View easement
    (linked_easement_id), View boundary (/map?focus=<produced
    boundary>). Layout: components/documents/DocumentPreview.tsx left
    (sticky on desktop, above on mobile): PDFs rendered page by page
    with pdfjs-dist 4 (dynamic import, worker via new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url), Prev /
    Next and "n of m"), images inline, other types a file card; a
    render failure falls back to an Open link. Info panel, every
    field editable IN PLACE: title (pencil, Enter / Escape,
    renameDocument); doc_type (DocTypeSelect; after saving a change
    the page offers "Rescan as <type>?", which POSTs /api/extract by
    storage path with the new scanKind and opens DocumentReview);
    attached properties as chips with their evidence line
    (document_properties.evidence, written by the intake from the
    verified why lines; setDocumentProperties only inserts and
    deletes so evidence survives edits) and Edit via
    PropertyMultiSelect, plus the primary non-property record as a
    link; extracted fields (ScanDocumentButton: Extracted / Edit /
    Rescan through the standard amber review; every reviewed save
    appends { at, kind } to documents.extraction_history via
    recordExtraction); notes (documents.notes, Save). Utility row:
    Download (signed URL), Replace file (replaceDocumentFile in
    classify.ts: uploads the new object, parks the old file as a
    document_versions row, re-points storage_path / file_name /
    content_type / size_bytes; the record, links, fields, and notes
    stay; "Previous versions" lists them with Download), Delete
    (confirm; deleteDocumentEverywhere removes the current file and
    every version's file, then the row; links cascade). Footer:
    uploaded by (profiles.full_name or email) and when, original file
    name, size, extraction dates. EntityDocuments (every entity page)
    and DocumentLinks (read-only lists such as a stand's sale
    contracts) now LINK here (title, chip, property chips, date) and
    no longer open the raw file or carry per-row controls; asset
    photo galleries keep Add photos and photo delete, and the plot
    page's breadcrumb links back here. /documents/retype rows link
    here too.
  - PLOT TARGET DEFAULTS (2026-08-21 fix): the preview's Replace /
    New parcel target starts on the document's OWN property (or its
    parcel's property), else follows the nearest boundary found at
    resolve time until the user picks one; it never defaults to the
    first property alphabetically (that sent a Courtland deed's
    preview to Albemarle-Trinity near Trinity and stretched the map
    miles east). The preview warns when the chosen target sits more
    than 2 miles from the plotted tract (naming the nearest boundary)
    and when the description's "containing N acres" differs from the
    plot by more than 25% (a creek- or road-bounded portion of a
    section plots as the whole section; draw by hand or import the
    parcel from county records).
  - /documents/[id]/plot (PLOT BOUNDARY FROM THIS DOCUMENT, the
    flagship, on deeds, plats, and legal descriptions): a three-step
    mobile-first stepper (app/(app)/documents/[id]/plot/PlotClient.tsx,
    components/documents/plot/PlotMap.tsx). An HONEST LIMITATIONS panel
    heads the page: plot quality follows description quality; closure
    error is shown, never hidden; aliquot parts assume regular
    sections and government lots are approximations; the county GIS
    import remains the fast path when records and GIS agree. Step 1
    Extract: /api/extract kind=legal_description reads the document
    and classifies it (aliquot | metes_bounds | mixed | unknown; the
    raw result is stored under extracted.legal_description_extraction
    so reopening does not re-spend; a prior deed/survey scan's legal
    description text seeds it) into an amber review: kind toggle,
    verbatim source text, and either a tracts list (aliquot text,
    section, township + N/S, range + E/W, meridian HU/SS/TA/unknown,
    exceptions) or the CALLS GRID (bearing text with a live azimuth
    from parseBearing or a red "Unreadable bearing", distance, unit,
    curve fields, reorder/remove). Step 2a ALIQUOT: each tract queries
    POST /api/plss (state, township, range, section, meridian
    optional), which serves plss_cache first and otherwise the
    live-verified (2026-08-20) BLM National PLSS CadNSDI MapServer on
    gis.blm.gov (layer 1 townships, layer 2 sections; the section layer
    carries no township columns, so the where clause matches the
    PLSSID string STATE + MERIDIAN CODE + TTT + FRAC + DIR + RRR + FRAC
    + DIR + DUP, e.g. AL160040S0080W0 = Alabama, Huntsville meridian,
    T4S R8W; Alabama meridian codes 16 Huntsville, 25 St. Stephens, 29
    Tallahassee), then writes the cache with the service role; several
    candidates (meridian unstated) render as pick buttons with a mini
    map; lib/geo/aliquot.ts parses the chain ("NW1/4 of SE1/4", halves,
    spelled-out quarters, NWSE shorthand, "and" lists, less/save-and-
    except clauses, lots) and cuts the section by bilinear
    interpolation inside its four corners (quarter/half recursion from
    largest to smallest), unions tracts, differences aliquot
    exceptions, and notes lot approximations and exceptions that must
    be cut by hand. Step 2b METES AND BOUNDS: lib/geo/traverse.ts runs
    live (bearings in DMS and decimal in every common notation,
    azimuths, due directions; feet, chains, poles/rods, links, varas,
    meters, yards; curves by chord bearing + length or tangent
    radius + arc/delta with direction), with the CLOSURE card
    prominent (distance and 1:N ratio, color-coded: closed / good at or
    above 1:5000 / fair to 1:1000 / poor), area and perimeter, and a
    "Force close (compass rule)" checkbox clearly labeled as adjusting
    the drawn courses (Bowditch distribution, adjusted flag); then
    GEOREFERENCE on a satellite map: pick a reference property or
    parcel (the POB starts at its centroid), tap or drag the point of
    beginning, quick-pick the nearest boundary vertices ("Use NW
    corner"), and a rotation slider with typed value (-15 to +15
    degrees in 0.1 steps) for basis-of-bearing differences, the shape
    overlaid live through toGeoJSON (local tangent plane, the pivot
    meter constants). Step 3 PREVIEW AND SAVE: the plotted polygon
    (kelly) over the target's existing boundary (white), acres tiles
    plotted vs current vs deeded (parcels.deeded_acres), and an
    explicit Save-as choice: new property (name, county, state), new
    parcel (property + parcel number), replace an existing property
    or parcel boundary (confirm dialog states the old acres). Save
    inserts when needed, writes the MultiPolygon through set_geometry,
    and updates the document (produced_boundary_type/_id plus
    extracted.legal_description_plot: kind, closure, rotation, pob,
    plotted acres, target, saved_at) with a link to /map?focus=.
  - /gov-payments (GOVERNMENT PAYMENTS): a payment-year vs program-year
    toggle with the framing "2025 program year, paid October 2026",
    year chips, entity chips (like /income), headline tiles (projected
    on your land, your share under leases, prices in use with the MYA
    source state and a "Refresh from USDA NASS" action), then a table
    by entity > property > FSA farm > commodity: base acres, PLC yield,
    election (inline select writing fsa_elections), projected net
    payment, a Drivers disclosure per row (effective price, ERP,
    rate, benchmark revenue, guarantee, cap, flat flag, notes, and an
    FSA county benchmark lookup button), farm management on the same
    page (add/edit/delete farms, link properties with allocation %,
    base acres editor), and a plain-language METHODOLOGY panel (the
    formulas, sources and as-of dates, fallback notices, and the
    estimate disclaimer: FSA determines actual payments after the
    marketing year closes). GovPaymentsCard (server component) on
    /properties/[id] and /entities/[id] shows base acres per commodity
    and the projected payment for the current payment year when a farm
    is linked. INCOME: lib/income.ts gains IncomeType "government":
    govShareRows(inputs, paymentYear) allocates each lease's land
    (lease_lands -> property -> fsa_farm_properties, by leased acres
    over property acres) and applies gov_payment_share_pct; a nonzero
    share enters the Government payments row of both /income tables
    (projected, payment-year attributed); at 0% totals are untouched
    and informationalGovPayments renders "base acres on this land
    generate approximately $X/yr to your tenant" on /gov-payments and
    the summaries.
  - /ask (ASK ABOUT YOUR LAND, the data assistant): a mobile-first chat
    (components/assistant/AssistantChat.tsx; starter questions such as
    "How many acres do I own in Lawrence County?" and "Which parcels
    have unpaid 2025 taxes?"; a dashboard AskEntryCard with a one-line
    question box; ?q= deep link) streaming from POST
    /api/data-assistant (NDJSON lines: {t} text, {s} status such as
    "Looking at income for 2025" shown as chips, {d} done, {e} error;
    session required, org required, 30/h per user, claude-sonnet-4-6,
    system prompt cached, max 6 tool rounds, maxDuration 60). TWO TOOL
    TIERS (lib/assistantTools.ts): CURATED tools that run the SAME
    engines the pages use on the session client (list_properties,
    land_summary, income_summary, taxes_status, timber_sales_summary,
    farm_activity, easements_summary, gov_payments_summary via
    lib/gov/govData, each returning a plain-language sources list the
    model must cite: "across your 3 properties in Lawrence County"),
    and run_sql for the long tail: guardSql in lib/assistantSql.ts
    (unit-tested mirror) then supabase.rpc("assistant_query", {q}).
    ISOLATION GUARANTEE (migration 0022): assistant_query(q) is
    SECURITY INVOKER, so model-written SQL runs as the signed-in user
    under the same RLS policies as every page; the function strips one
    trailing semicolon and rejects any other semicolon or comment,
    requires SELECT or WITH, rejects write and admin keywords as whole
    words (insert, update, delete, merge, truncate, drop, alter,
    create, grant, revoke, copy, call, do, execute, refresh, lock, set,
    reset, comment, security, vacuum, analyze, cluster, reindex,
    listen, notify, into, pg_sleep, pg_read_*, pg_ls_dir, dblink, lo_*,
    FOR UPDATE/SHARE, which also catches data-modifying CTEs), sets
    `transaction_read_only = on` and a 5 s statement_timeout, wraps
    the query as `select * from (q) s limit 200`, and is granted only
    to authenticated. No service-role client exists anywhere in the
    assistant path; tenant isolation is the database's RLS, never
    prompt language, and that is the acceptance test.
  - /help and the "?" drawer (HELP CENTER): 26 topics in docs/help
    (getting-started, map, drawing, assets, printing, properties,
    entities, easements, import-county, import-files, timber,
    timber-scan, timber-sales, leases, lease-price-methods, taxes,
    income, documents, plot-boundary, gov-payments, farms,
    farm-activity, assets-page, settings, ask, help, plus
    _limitations.md listing what the app does not do, which heads the
    chat digest) compiled by scripts/build-help.mjs. /help groups
    topics like the nav with search (title > keywords > body ranking)
    and a topic view rendered by lib/helpMarkdown.tsx (safe subset),
    ?topic= deep links. The "?" button in the header opens
    components/help/HelpDrawer.tsx (right panel on desktop, bottom
    sheet on phones; Escape closes; lib/helpBus.ts openHelp({route,
    tab}) from anywhere) with four tabs: This page (lib/help.ts
    topicForRoute: longest route-prefix match, lowest order wins,
    related topics listed), All topics (search), How-to chat, and
    Contact support. HOW-TO CHAT (/api/support-chat): session
    required, 20/h, claude-sonnet-4-6 streaming text/plain, system
    prompt = rules + the compiled digest + the current page's topic,
    NO tools and NO user data; it says so ("I know how the app works;
    for questions about your own land and numbers use Ask") and points
    to Contact support when the app cannot do something. CONTACT
    SUPPORT (/api/support-contact): session required, 5/h, the server
    gathers user email, org, role, page, build (VERCEL_GIT_COMMIT_SHA
    short), and browser, accepts an optional screenshot (data URL
    under 2 MB, attached), sends through Resend with reply_to the
    user, and returns 503 with a clear message when unconfigured. The
    data assistant (knows your data) and the help chat (knows the
    app) stay deliberately separate surfaces.
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
    easements (see the table entry: category-styled translucent fills
    and dashed outlines, conservation hatch, railroad ties, line
    easements on the same layers, category legend), and
    assets (dark green circle markers with a per-type letter, dashed light
    blue lines for pipe/fence, light blue fill + outline for drawn and
    circle footprints with the letter marker at the centroid, light
    blue pivot coverage shapes). PRINT BUTTON (top right): a print setup
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
    matching the map styles (timber types, crops, easement categories
    with hatch and railroad-tie swatches),
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
    mobile). The Add menu offers three entries: DRAW, ASSET, and
    Irrigation pivot. PICK FIRST, THEN DRAW: Draw opens a type picker
    (components/map/DrawTypePicker.tsx, a two-column grid with color
    swatches, bottom sheet on phones): Property boundary, Parcel, Ag
    field, Timber stand, Pasture, Wetland, Road, Easement (then a
    second tap: Line or Area), Fence, Underground pipe. Picking fixes
    the type for the session: the right tool loads (polygon vs line),
    the mapbox-gl-draw draft layers are recolored to that type's map
    color (components/map/drawColors.ts captures the theme's original
    paint values and restores them when the session ends), and the
    save form (NewBoundaryDialog with fixedType, or NewLineDialog with
    fixedKind) opens already set to the type with its inline fields
    visible from the start (timber stand type/species/year/notes,
    easement fields). Changing type = finish or cancel and start a
    new session. Multi-area sessions, the persistent (css-hidden) form
    state, Discard shape vs session Cancel, and Escape all carry over
    unchanged; the file import's per-feature type assignment is
    untouched. ASSET opens a placement picker
    (components/map/AssetPlacePicker.tsx): asset type select plus Pin
    (crosshair placement: pan to line up, DRAG the crosshair itself
    anywhere on the map, or My location via GPS; Place here confirms
    wherever it sits; moving a pin reuses the same mode), Draw
    outline (polygon footprint drawn in the asset look; shops, barns,
    ponds), or Circle (center by crosshair, then a parametric
    mini-editor: draggable white center handle, blue rim handle, a
    typed Diameter input, live sq ft / acres; Save asks name +
    property suggested from the center). Grain bins lead with Circle
    ("Suggested", preselected); every other type starts on Pin with
    Circle available last. CIRCLE FOOTPRINTS are parametric like
    pivots (lib/geo/circle.ts, unit tested): details carry
    footprint_shape = 'circle', center_lon/lat (mapManaged on every
    asset type), and diameter_ft; the polygon is derived and
    regenerated, never vertex-edited (the click panel's Edit circle
    reopens the editor; Circle footprint starts one for any non-pivot
    asset, using its pin as the center). For grain bins diameter_ft IS
    the bin's spec field, synced TWO WAYS: dragging or typing in the
    editor writes diameter_ft, and typing diameter_ft on the asset
    page regenerates the circle polygon through set_geometry
    (circleUpdateForDetails). Outline-drawn and circle assets render
    as their shape (light blue fill and outline) with the type letter
    marker at the centroid for low-zoom recognition (rowsToFC pushes a
    point feature for every polygon asset, the pivot P trick
    generalized); pins are unchanged; the click panel shows the
    footprint as square feet under half an acre, else acres, with the
    circle's diameter. Irrigation pivot (crosshair places the center,
    then the parametric coverage editor opens directly; Save asks for
    name + property, suggested from the center's location, and inserts
    the pivot with its parameters and derived polygon in one step);
    pivot coverage circles are their own thing and unchanged. Every save
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
  - /farm-activity (FARM DATA, summary band added 2026-08-21): filters
    (year, entity incl. "No entity" = none, connection, property) in
    the URL, a connection-health strip, and three levels. SUMMARY
    (no entity / connection / property filter): "By entity" and "By
    tenant" card grids from lib/farmRollup.ts (pure, unit tested in
    farmRollup.test.ts: rollups(input) -> byEntity with a "No entity"
    bucket for properties without entity_id and byTenant named
    operation_name || label with unmappedAcres; each Rollup carries
    plantedAcres, harvestedAcres, plantings, cropMix sorted desc,
    yieldByCrop (acres-weighted ACTUAL production / harvested acres
    when any row has production, else PROJECTED from
    farm_projected_yields weighted by planted acres, else null),
    prices for crops in the mix labeled by tenant, sharedYields /
    sharedPrices, propertyCount, connectionIds; propertyRollups(input,
    { entityId | connectionId }) and scopedRollup for the drill-in).
    A card: name, acres in crops, crop-mix stacked bar (cropColor)
    plus text, harvest progress bar "x of y acres harvested", yield
    chips (actual / projected) or quiet "Yields not shared", price
    chips with PROJECTED / FINAL badge or "Prices not shared"; the
    whole card links to ?entity=<id> or ?connection=<id>. With at
    most one entity bucket and one connection the two sections
    collapse to ONE card ("Farmed by <tenant>" subtitle). DRILL-IN
    level 1 (entity or connection filter): breadcrumb Farm Data /
    name, the scoped card, then Properties rows (acres, crop mix,
    harvest, yield and price chips) each linking with &property=;
    level 2 (property too): three-level breadcrumb, the property's
    card, the field table for that property. The existing field-level
    table (grouped by property: field, crop with varieties, planted
    acres, planting date, Growing / Harvested chip, yield per acre or
    "Not shared") stays beneath every level, scoped by the same
    filters, and the totals line matches the cards by construction
    (same rows summed). Tenant prices card only at the summary level
    with more than one connection. Unmapped plantings count on the
    tenant card only. Scope-off values never render as zero.
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
- Easements are "easements" in UI text (never "utility easements");
  the map styles them by category, panels and pages show the exact
  type. Severed mineral rights are not an easement (future
  encumbrances area).
- Drawing is pick-first: the user chooses what they are drawing, then
  the tool, draft color, and save form follow. Parametric shapes
  (pivot coverage, circle footprints) are edited through their editor,
  never by vertices.
- Numbers with commas; acres to 1 decimal (lib/format.ts formatAcres);
  dollars with commas and 2 decimals (formatDollars).
- Every future AI extraction must be shown for user review before saving.
  AI document CLASSIFICATION is a suggestion chip the user accepts or
  overrides; a document never gets a type other than 'other' without
  that confirmation.
- The assistant path (/api/data-assistant, lib/assistantTools.ts,
  lib/assistantSql.ts, assistant_query) NEVER uses the service-role
  client; RLS on the session client is the tenant isolation guarantee.
  Public-data caches (RMA, PLSS, FSA benchmark) are the only
  service-role writers besides the farm sync cron.
- Government payment figures are estimates keyed to the program year
  and attributed to the payment year (October of the following year);
  the +1 lives in one place (lib/gov/govPayments.ts). No producer
  payment limits.
- Help content: every nav route needs a topic in docs/help and no
  topic may contain an em dash; scripts/build-help.mjs fails the build
  otherwise. Run `npm run help:build` after editing docs/help (prebuild
  does it automatically) and commit the generated module.
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
- Post-Phase 6i (DONE, 2026-08-20, migration 0019): utility easements
  became EASEMENTS (table renamed, data kept): 14 types in five style
  categories, relationship (burdens/benefits this property),
  expiration date, informational width, flowage elevation,
  conservation program/restrictions, line OR polygon geometry with
  computed length or acres, category styling shared between the live
  map and the PDF (conservation hatch checked against mixed timber,
  railroad ties, flowage fill), category legends; PICK-FIRST DRAWING
  (Add > Draw > type picker, easement line/area sub-pick, draft drawn
  in the type's color, save form preset with inline fields, session
  type fixed); and ASSET PLACEMENT as Pin, Draw outline, or Circle
  (parametric center + diameter in details, grain bin diameter_ft
  synced two ways with the asset form, letter markers at footprint
  centroids, footprint sq ft / acres in the panel). Unit tests for
  the easement catalog and migration and for circle geometry/sync.
  Described above.
- Post-Phase 6j (DONE, 2026-08-20, migrations 0020 + 0021 + 0022):
  DOCUMENT VAULT (27-type taxonomy in seven groups, a Documents nav
  page with filters, search, and upload, AI classification as a
  confirm-or-override chip, per-type scans with amber review stored
  on the document, a bulk re-type backfill, and PLOT BOUNDARY FROM A
  DOCUMENT: PLSS aliquot resolution against the live-verified BLM
  CadNSDI service with a global section cache and bilinear quarter
  subdivision, and a metes-and-bounds traverse plotter with closure
  error, compass-rule force close, and map georeferencing by pinned
  point of beginning plus rotation, both ending in a plotted-vs-
  current-vs-deeded preview and an explicit new-or-replace save);
  GOVERNMENT PAYMENTS (FSA farms, property links with allocation,
  base acres and elections, global OBBBA program parameters and price
  data seeded and admin-editable, NASS MYA blends and the FSA
  benchmark workbook cache, PLC and ARC-CO engines ported from the
  farm software, payment-year attribution, a Government Payments page
  with methodology, property and entity cards, and the
  gov_payment_share_pct lease term feeding a Government payments
  income line); the ASK data assistant (curated tools over the same
  engines plus a read-only SECURITY INVOKER SQL seam with whole-word
  write rejection, read-only transaction, timeout, and row cap; RLS
  is the isolation guarantee; per-user hourly limits); and the HELP
  CENTER (26 how-to topics compiled at build time, /help, the "?"
  drawer with the current page's topic, search, a no-data how-to
  chat, and Contact support through Resend). Unit tests for the
  taxonomy, traverse, aliquot, PLSS where builder, NASS parsing, FSA
  workbook parsing, program config, PLC/ARC-CO engines, projection,
  income government line, SQL guard, tool schemas, and help routing.
  Described above.

- Post-Phase 6m (DONE, 2026-08-21, migration 0028): DOCUMENTS
  OVERHAUL (pattern titles from one tested generator shared by the
  AI prompt, the intake, and a one-time title review; inline rename;
  a document page per file with in-place editing, rescan with a new
  type, evidence-preserving property edits, notes, replace file with
  kept versions, delete, follow-on actions, and a pdf.js page
  preview; the Documents page rebuilt as one calm list with search, a
  group rail or chip rows, and an optional Group by) and the FARM
  DATA SUMMARY BAND (rollups by entity and by tenant with crop mix,
  harvest progress, weighted yields, and price chips; drill-in to
  properties and fields with breadcrumbs and URL-synced filters).
  Unit tests for the title generator and the rollup engine. Described
  above.