-- ============================================================================
-- Turnrow Landowner: Migration 0019
-- Utility easements become EASEMENTS: the full set a landowner meets
-- (utility corridors, access and road rights of way, railroads,
-- drainage, TVA/Corps flowage, conservation, cemetery access, temporary
-- construction, solar/wind, other). Each easement is EITHER a polygon
-- (boundary, generated acres) OR a line (geom, generated length), never
-- both. New shared fields: relationship (burdens this property, the
-- default, or benefits it: an access easement the owner HOLDS over a
-- neighbor, whose geometry may lie outside the property), expiration
-- date (null = permanent), width_ft (informational on lines, no
-- auto-buffer), elevation_ft (flowage contour), program and
-- restrictions (conservation detail). Existing rows keep their type and
-- polygon and gain relationship = burdens. Severed mineral rights are
-- NOT an easement and are deliberately absent (future encumbrances).
-- Run after 0018.
-- ============================================================================

set search_path = public, extensions;

-- 1. Rename the table and its attachments.
alter table public.utility_easements rename to easements;
alter policy utility_easements_all on public.easements rename to easements_all;
alter index utility_easements_org_idx rename to easements_org_idx;
alter index utility_easements_prop_idx rename to easements_prop_idx;
alter index utility_easements_boundary_gix rename to easements_boundary_gix;
drop view public.utility_easements_geo;

-- 2. The full type list.
alter table public.easements drop constraint utility_easements_easement_type_check;
alter table public.easements add constraint easements_easement_type_check
  check (easement_type in (
    'powerline', 'pipeline', 'waterline_sewer', 'telecom_fiber',
    'access_row', 'public_road_row', 'railroad',
    'drainage', 'flowage',
    'conservation',
    'cemetery_access', 'construction_temp', 'solar_wind', 'other'));

-- 3. Shared fields.
alter table public.easements
  add column relationship text not null default 'burdens_this_property'
    check (relationship in ('burdens_this_property', 'benefits_this_property')),
  add column expiration_date date,
  add column width_ft numeric,
  add column elevation_ft numeric,
  add column program text,
  add column restrictions text;

-- 4. Line geometry beside the polygon (same generated length as roads).
alter table public.easements
  add column geom geometry(MultiLineString, 4326),
  add column length_feet numeric generated always as
    (st_length(geom::geography) * 3.280839895) stored,
  add column miles numeric generated always as
    (st_length(geom::geography) / 1609.344) stored,
  add constraint easements_one_shape check (boundary is null or geom is null);
create index easements_geom_gix on public.easements using gist (geom);

-- 5. Geo view with both shapes; the app reads whichever is set.
create view public.easements_geo with (security_invoker = true) as
select id, organization_id, property_id, name, easement_type, relationship,
       holder, recorded_ref, expiration_date, width_ft, elevation_ft,
       program, restrictions, notes, acres, length_feet, miles,
       st_asgeojson(boundary)::json as boundary_geojson,
       st_asgeojson(geom)::json as geom_geojson,
       created_at, updated_at
from public.easements;
grant select on public.easements_geo to authenticated;

-- 6. Documents follow the rename (storage paths already written under
--    <org>/utility_easement/ stay valid; storage RLS keys on the org).
update public.documents set entity_type = 'easement'
  where entity_type = 'utility_easement';
alter table public.documents drop constraint documents_entity_type_check;
alter table public.documents add constraint documents_entity_type_check
  check (entity_type in ('property', 'parcel', 'field', 'pasture', 'wetland',
                         'easement',
                         'timber_stand', 'road', 'asset', 'entity',
                         'tenant', 'lease', 'timber_sale', 'tax_statement'));

-- 7. set_geometry: 'easement' takes a polygon OR a line. Polygons win
--    when the GeoJSON holds any; otherwise lines. The other column is
--    nulled so the one-shape check always holds.
create or replace function public.set_geometry(
  p_entity_type text,
  p_entity_id   uuid,
  p_geojson     jsonb
)
returns numeric
language plpgsql
set search_path = public, extensions
as $$
declare
  g geometry;
  gl geometry;
  result numeric;
begin
  if p_geojson is not null then
    g := st_setsrid(st_geomfromgeojson(p_geojson::text), 4326);
  end if;

  if p_entity_type in ('property', 'parcel', 'field', 'pasture', 'wetland',
                       'timber_stand') then
    if g is not null then
      g := st_multi(st_collectionextract(st_makevalid(g), 3));
      if g is null or st_isempty(g) then
        raise exception 'Geometry contains no polygon';
      end if;
    end if;
  elsif p_entity_type = 'easement' then
    if g is not null then
      gl := st_multi(st_collectionextract(st_makevalid(g), 2));
      g  := st_multi(st_collectionextract(st_makevalid(g), 3));
      if (g is null or st_isempty(g)) and (gl is null or st_isempty(gl)) then
        raise exception 'Geometry contains no polygon or line';
      end if;
      if g is not null and not st_isempty(g) then
        gl := null;
      else
        g := null;
      end if;
    end if;
  elsif p_entity_type = 'road' then
    if g is not null then
      g := st_multi(st_collectionextract(st_makevalid(g), 2));
      if g is null or st_isempty(g) then
        raise exception 'Geometry contains no line';
      end if;
    end if;
  elsif p_entity_type = 'asset' then
    if g is not null and st_isempty(g) then
      raise exception 'Empty geometry';
    end if;
  else
    raise exception 'Unknown entity type %', p_entity_type;
  end if;

  if p_entity_type = 'property' then
    update public.properties set boundary = g where id = p_entity_id
      returning acres into result;
  elsif p_entity_type = 'parcel' then
    update public.parcels set boundary = g where id = p_entity_id
      returning acres into result;
  elsif p_entity_type = 'field' then
    update public.fields set boundary = g where id = p_entity_id
      returning acres into result;
  elsif p_entity_type = 'pasture' then
    update public.pastures set boundary = g where id = p_entity_id
      returning acres into result;
  elsif p_entity_type = 'wetland' then
    update public.wetlands set boundary = g where id = p_entity_id
      returning acres into result;
  elsif p_entity_type = 'timber_stand' then
    update public.timber_stands set boundary = g where id = p_entity_id
      returning acres into result;
  elsif p_entity_type = 'easement' then
    update public.easements set boundary = g, geom = gl where id = p_entity_id
      returning coalesce(acres, miles) into result;
  elsif p_entity_type = 'road' then
    update public.roads set geom = g where id = p_entity_id
      returning miles into result;
  elsif p_entity_type = 'asset' then
    update public.assets set geom = g where id = p_entity_id;
    result := null;
  end if;

  if not found then
    raise exception 'Row not found';
  end if;
  return result;
end;
$$;
