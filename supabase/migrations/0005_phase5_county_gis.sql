-- ============================================================================
-- Turnrow Landowner: Migration 0005, Phase 5
-- County GIS parcel import: platform admin flag, global service registry,
-- parcel provenance columns, merged property outline helper.
-- Run after 0004.
-- ============================================================================

set search_path = public, extensions;

-- ============================================================================
-- 1. Platform admin flag (separate from org roles). Set yours with:
--    update public.profiles set is_platform_admin = true
--    where email = 'stuart@turnrow.farm';
--    (Profile updates by users are column-restricted to full_name, so this
--    flag can only be changed here in the SQL editor.)
-- ============================================================================

alter table public.profiles
  add column is_platform_admin boolean not null default false;

create or replace function private.is_platform_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select is_platform_admin from public.profiles where id = (select auth.uid())),
    false
  );
$$;

grant execute on function private.is_platform_admin() to authenticated;

-- ============================================================================
-- 2. GLOBAL service registry (no organization_id: every org reads the same
--    curated list; only platform admins write it)
-- ============================================================================

create table public.county_gis_services (
  id                 uuid primary key default gen_random_uuid(),
  state              text not null,           -- e.g. AL
  county             text not null,           -- e.g. Lawrence
  display_name       text not null,           -- e.g. Lawrence County, Alabama
  service_url        text not null,           -- ArcGIS REST service URL (without layer id)
  layer_id           integer not null default 0,
  parcel_field       text not null,           -- attribute holding the parcel number
  owner_field        text not null,           -- attribute holding the owner name
  acres_field        text,                    -- deeded/assessed acres attribute
  situs_field        text,                    -- address/situs attribute
  status             text not null default 'untested'
                       check (status in ('active', 'broken', 'untested')),
  last_verified_at   timestamptz,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (service_url, layer_id)
);

create trigger set_updated_at before update on public.county_gis_services
  for each row execute function private.set_updated_at();

create index county_gis_services_state_idx on public.county_gis_services (state, county);

alter table public.county_gis_services enable row level security;

create policy county_gis_services_read on public.county_gis_services
  for select to authenticated
  using (true);
create policy county_gis_services_insert on public.county_gis_services
  for insert to authenticated
  with check (private.is_platform_admin());
create policy county_gis_services_update on public.county_gis_services
  for update to authenticated
  using (private.is_platform_admin())
  with check (private.is_platform_admin());
create policy county_gis_services_delete on public.county_gis_services
  for delete to authenticated
  using (private.is_platform_admin());

-- ============================================================================
-- 3. Parcel provenance: deeded acres as supplied by the county service
--    (shown beside computed GIS acres) and a source attribution note.
-- ============================================================================

alter table public.parcels add column deeded_acres numeric(12, 2);
alter table public.parcels add column source text;

-- Recreate the geo view with the new columns (appended, so create or
-- replace is allowed).
create or replace view public.parcels_geo with (security_invoker = true) as
select id, organization_id, property_id, parcel_number, county, notes, acres,
       st_asgeojson(boundary)::json as boundary_geojson, created_at, updated_at,
       deeded_acres, source
from public.parcels;

-- ============================================================================
-- 4. Merged property outline: set a property's boundary to the union of
--    its parcels' boundaries. SECURITY INVOKER, so RLS guarantees the
--    caller can only touch their own rows. Returns the recomputed acres.
-- ============================================================================

-- ============================================================================
-- 5. Seed: Lawrence and Colbert County, Alabama. Both endpoints were
--    live-verified during the Phase 5 build (2026-08-15): layer metadata
--    read, one-record test query, and an owner LIKE search with GeoJSON
--    output all succeeded, with geometry and deeded acres present.
-- ============================================================================

insert into public.county_gis_services
  (state, county, display_name, service_url, layer_id,
   parcel_field, owner_field, acres_field, situs_field,
   status, last_verified_at, notes)
values
  ('AL', 'Lawrence', 'Lawrence County, Alabama',
   'https://web6.kcsgis.com/kcsgis/rest/services/Lawrence/Lawrence_Public_ISV/MapServer', 49,
   'ParcelID_Long', 'Owner', 'DeededAcres', null,
   'active', now(),
   'KCS-hosted MapServer behind the county ISV parcel viewer. Live-verified 2026-08-15.'),
  ('AL', 'Colbert', 'Colbert County, Alabama',
   'https://al20portal.kcsgis.com/al20server/rest/services/Internal/Colbert_Public_ISV/MapServer', 43,
   'ParcelID_GISlink', 'Owner', 'DeededAcres', null,
   'active', now(),
   'KCS-hosted MapServer behind the county ISV parcel viewer. Live-verified 2026-08-15.')
on conflict (service_url, layer_id) do nothing;

-- ============================================================================
-- 6. Merged property outline helper
-- ============================================================================

create or replace function public.set_property_boundary_from_parcels(
  p_property_id uuid
)
returns numeric
language plpgsql
set search_path = public, extensions
as $$
declare
  merged geometry;
  new_acres numeric;
begin
  select st_multi(st_union(boundary)) into merged
  from public.parcels
  where property_id = p_property_id and boundary is not null;

  if merged is null then
    raise exception 'No parcel boundaries to merge for this property';
  end if;

  update public.properties set boundary = merged where id = p_property_id
    returning acres into new_acres;
  if not found then
    raise exception 'Property not found';
  end if;
  return new_acres;
end;
$$;
