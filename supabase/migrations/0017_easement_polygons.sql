-- ============================================================================
-- Turnrow Landowner: Migration 0017
-- Utility easements move from the line+width model to POLYGON boundaries
-- drawn like every land type (ag fields, pastures, wetlands). Acres come
-- from the polygon via the same generated st_area column, so corridor
-- acreage can never drift from the shape. Existing centerlines convert
-- by buffering to half their recorded width (a true geography buffer,
-- so the strip is real ground feet); easements with no recorded width
-- convert at a 50 ft default, get a note appended saying so, and are
-- listed in NOTICEs when this migration runs. The line-specific columns
-- (geom, width_ft, length_feet, miles) are dropped after converting.
-- Run after 0016.
-- ============================================================================

set search_path = public, extensions;

-- 1. Polygon boundary + generated acres (same formula as every land type).
alter table public.utility_easements
  add column boundary geometry(MultiPolygon, 4326),
  add column acres numeric generated always as
    (st_area(boundary::geography) / 4046.8564224) stored;

-- 2. List the easements converting at the default width (watch the
--    NOTICE output of this migration; each also gets a visible note).
do $$
declare
  r record;
begin
  for r in
    select id, name from public.utility_easements
    where geom is not null and width_ft is null
  loop
    raise notice
      'Easement "%" (%) had no recorded width; converted at the default 50 ft. Redraw its boundary to correct.',
      r.name, r.id;
  end loop;
end $$;

-- 3. Convert: buffer each centerline by half its width in meters
--    (width_ft / 2 * 0.3048). Geography buffer, cast back to geometry.
update public.utility_easements
set boundary = st_multi(
      st_buffer(geom::geography, coalesce(width_ft, 50) / 2.0 * 0.3048)::geometry
    ),
    notes = case
      when width_ft is null then
        trim(coalesce(notes || E'\n', '') ||
          'Boundary estimated from the drawn centerline at a default 50 ft width; redraw to correct.')
      else notes
    end
where geom is not null;

-- 4. Drop the line model (the geo view depends on these columns, so it
--    goes first; the generated length_feet/miles columns depend on
--    geom, so they drop BEFORE it; the old gist index drops with its
--    column).
drop view public.utility_easements_geo;
alter table public.utility_easements
  drop column length_feet,
  drop column miles,
  drop column geom,
  drop column width_ft;

create index utility_easements_boundary_gix
  on public.utility_easements using gist (boundary);

-- 5. Recreate the geo view on the polygon shape.
create view public.utility_easements_geo with (security_invoker = true) as
select id, organization_id, property_id, name, easement_type, holder,
       recorded_ref, notes, acres,
       st_asgeojson(boundary)::json as boundary_geojson, created_at, updated_at
from public.utility_easements;
grant select on public.utility_easements_geo to authenticated;

-- 6. set_geometry: utility_easement joins the polygon branch and
--    returns acres like the other land types.
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
  result numeric;
begin
  if p_geojson is not null then
    g := st_setsrid(st_geomfromgeojson(p_geojson::text), 4326);
  end if;

  if p_entity_type in ('property', 'parcel', 'field', 'pasture', 'wetland',
                       'timber_stand', 'utility_easement') then
    if g is not null then
      g := st_multi(st_collectionextract(st_makevalid(g), 3));
      if g is null or st_isempty(g) then
        raise exception 'Geometry contains no polygon';
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
  elsif p_entity_type = 'utility_easement' then
    update public.utility_easements set boundary = g where id = p_entity_id
      returning acres into result;
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
