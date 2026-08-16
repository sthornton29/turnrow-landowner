-- ============================================================================
-- Turnrow Landowner: Migration 0010
-- FSA farm numbers on properties: optional, and a property can have
-- several (Farm Service Agency farm/tract numbers rarely line up one to
-- one with how a landowner organizes properties). Stored as a text
-- array; entered comma-separated in the app. Run after 0009.
-- ============================================================================

set search_path = public, extensions;

alter table public.properties add column fsa_numbers text[];

-- properties_geo gains fsa_numbers (appended, so replace is allowed).
create or replace view public.properties_geo with (security_invoker = true) as
select id, organization_id, name, county, state, notes, acres,
       st_asgeojson(boundary)::json as boundary_geojson, created_at, updated_at,
       entity_id, fsa_numbers
from public.properties;
