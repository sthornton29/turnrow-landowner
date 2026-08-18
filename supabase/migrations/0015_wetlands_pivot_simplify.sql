-- ============================================================================
-- Turnrow Landowner: Migration 0015
-- 1. Wetlands: a land type mirroring pastures. For OPEN wetlands
--    (marsh, sloughs, duck holes, WRP/easement ground); forested
--    bottomland remains a timber stand (hardwood + wetland note).
-- 2. Pivot model simplified: extension zones, skip sectors, towable
--    positions, custom-shape flag, and the irrigation_lateral type are
--    removed (a pre-migration check found NO assets using any of them;
--    one pivot's cutout polygon carries over under the new key).
--    Coverage is now base circle/sector + add_polygons (unioned) +
--    cut_polygons (differenced).
-- Run after 0014.
-- ============================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------- wetlands

create table public.wetlands (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  property_id      uuid not null,
  name             text not null,
  notes            text,
  boundary         geometry(MultiPolygon, 4326),
  acres            numeric generated always as
                     (st_area(boundary::geography) / 4046.8564224) stored,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  foreign key (property_id, organization_id)
    references public.properties (id, organization_id) on delete cascade
);

alter table public.wetlands enable row level security;
create policy wetlands_all on public.wetlands for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());

create trigger set_updated_at before update on public.wetlands
  for each row execute function private.set_updated_at();

create index wetlands_org_idx  on public.wetlands (organization_id);
create index wetlands_prop_idx on public.wetlands (property_id);
create index wetlands_boundary_gix on public.wetlands using gist (boundary);

create view public.wetlands_geo with (security_invoker = true) as
select id, organization_id, property_id, name, notes, acres,
       st_asgeojson(boundary)::json as boundary_geojson, created_at, updated_at
from public.wetlands;
grant select on public.wetlands_geo to authenticated;

alter table public.documents drop constraint documents_entity_type_check;
alter table public.documents add constraint documents_entity_type_check
  check (entity_type in ('property', 'parcel', 'field', 'pasture', 'wetland',
                         'timber_stand', 'road', 'asset', 'entity',
                         'tenant', 'lease', 'timber_sale', 'tax_statement'));

-- set_geometry learns wetlands (polygon rules).
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
                       'timber_stand') then
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

-- ------------------------------------------- pivot model simplification

-- irrigation_lateral had zero rows; the type goes away.
alter table public.assets drop constraint assets_asset_type_check;
alter table public.assets add constraint assets_asset_type_check
  check (asset_type in
    ('well', 'irrigation_pivot', 'underground_pipe', 'riser', 'shop',
     'shed', 'barn', 'grain_bin', 'house', 'fence', 'pond_dam', 'other'));

-- Stored pivot details: drop the removed keys, carry cutouts over as
-- cut_polygons. Derived geometry is unchanged.
update public.assets
set details = (details - 'extensions' - 'skips' - 'positions'
                       - 'custom_shape' - 'cutouts')
  || jsonb_build_object(
       'cut_polygons', coalesce(details->'cutouts', '[]'::jsonb),
       'add_polygons', coalesce(details->'add_polygons', '[]'::jsonb))
where asset_type = 'irrigation_pivot' and details is not null;
