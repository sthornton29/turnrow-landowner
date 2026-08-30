-- ============================================================================
-- Turnrow Landowner: Migration 0036
-- EMERGENCY CONTACT NUMBER ON EASEMENTS.
--
-- Optional on every easement type; shown prominently (tap-to-call) on
-- pipeline and powerline easements, as a normal detail row otherwise.
-- The view is recreated with the column appended (create or replace
-- allows appended columns). Run after 0035.
-- ============================================================================

set search_path = public, extensions;

alter table public.easements add column emergency_phone text;

create or replace view public.easements_geo with (security_invoker = true) as
select id, organization_id, property_id, name, easement_type, relationship,
       holder, recorded_ref, expiration_date, width_ft, elevation_ft,
       program, restrictions, notes, acres, length_feet, miles,
       st_asgeojson(boundary)::json as boundary_geojson,
       st_asgeojson(geom)::json as geom_geojson,
       created_at, updated_at,
       emergency_phone
from public.easements;
grant select on public.easements_geo to authenticated;
