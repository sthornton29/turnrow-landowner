-- ============================================================================
-- Turnrow Landowner: Migration 0014
-- 1. Pastures: a land type mirroring fields (present but not emphasized;
--    no grazing management features yet).
-- 2. Irrigated/dryland acres per ag field, derived in PostGIS from the
--    irrigation coverage polygons (pivot plantable shapes + laterals)
--    and recomputed by trigger on geometry changes, never on read.
-- 3. farm_field_data gains the tenant's planted-by-practice acre columns
--    (the partner /plantings payload carries irrigated/dryland acres).
-- Run after 0013.
-- ============================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------- pastures

create table public.pastures (
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

alter table public.pastures enable row level security;
create policy pastures_all on public.pastures for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());

create trigger set_updated_at before update on public.pastures
  for each row execute function private.set_updated_at();

create index pastures_org_idx  on public.pastures (organization_id);
create index pastures_prop_idx on public.pastures (property_id);
create index pastures_boundary_gix on public.pastures using gist (boundary);

create view public.pastures_geo with (security_invoker = true) as
select id, organization_id, property_id, name, notes, acres,
       st_asgeojson(boundary)::json as boundary_geojson, created_at, updated_at
from public.pastures;
grant select on public.pastures_geo to authenticated;

alter table public.documents drop constraint documents_entity_type_check;
alter table public.documents add constraint documents_entity_type_check
  check (entity_type in ('property', 'parcel', 'field', 'pasture',
                         'timber_stand', 'road', 'asset', 'entity',
                         'tenant', 'lease', 'timber_sale', 'tax_statement'));

-- set_geometry learns pastures (polygon rules, same as fields).
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

  if p_entity_type in ('property', 'parcel', 'field', 'pasture', 'timber_stand') then
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

-- --------------------------------------------- irrigated / dryland acres

-- Stored per ag field, derived: area of the field boundary intersected
-- with the UNION of active irrigation coverage polygons (pivot plantable
-- shapes after cutouts, and laterals). Union means several pivots
-- overlapping one field count once. Dryland = acres - irrigated,
-- computed in the app.
alter table public.fields add column irrigated_acres numeric;

drop view public.fields_geo;
create view public.fields_geo with (security_invoker = true) as
select id, organization_id, property_id, name, notes, acres, irrigated_acres,
       st_asgeojson(boundary)::json as boundary_geojson, created_at, updated_at
from public.fields;
grant select on public.fields_geo to authenticated;

create or replace function public.recompute_field_irrigation(
  p_organization_id uuid,
  p_field_id uuid default null
)
returns void
language plpgsql
set search_path = public, extensions
as $$
begin
  update public.fields f
  set irrigated_acres = case
    when f.boundary is null then null
    else coalesce((
      select st_area(st_intersection(f.boundary, cov.geom)::geography) / 4046.8564224
      from (
        select st_union(st_makevalid(a.geom)) as geom
        from public.assets a
        where a.organization_id = f.organization_id
          and a.asset_type in ('irrigation_pivot', 'irrigation_lateral')
          and a.is_active
          and a.geom is not null
          and st_dimension(a.geom) = 2
      ) cov
      where cov.geom is not null
    ), 0)
  end
  where f.organization_id = p_organization_id
    and (p_field_id is null or f.id = p_field_id);
end;
$$;

-- Row-level triggers with restricted column lists so the recompute
-- (which only writes irrigated_acres) can never re-fire itself.
create or replace function private.assets_irrigation_changed()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if tg_op = 'DELETE' then
    if old.asset_type in ('irrigation_pivot', 'irrigation_lateral') then
      perform public.recompute_field_irrigation(old.organization_id);
    end if;
    return old;
  end if;
  if new.asset_type in ('irrigation_pivot', 'irrigation_lateral')
     or (tg_op = 'UPDATE'
         and old.asset_type in ('irrigation_pivot', 'irrigation_lateral')) then
    perform public.recompute_field_irrigation(new.organization_id);
  end if;
  return new;
end;
$$;

create trigger assets_irrigation_recompute
  after insert or delete or update of geom, is_active, asset_type
  on public.assets
  for each row execute function private.assets_irrigation_changed();

create or replace function private.field_boundary_changed()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  perform public.recompute_field_irrigation(new.organization_id, new.id);
  return new;
end;
$$;

create trigger fields_irrigation_recompute
  after insert or update of boundary
  on public.fields
  for each row execute function private.field_boundary_changed();

-- Backfill every org once.
select public.recompute_field_irrigation(id) from public.organizations;

-- ------------------------------- tenant planted acres by practice

-- The partner /plantings payload carries irrigated_acres/dryland_acres;
-- store them so the Tenant Data panel can show practice-split rows.
alter table public.farm_field_data add column irrigated_acres numeric;
alter table public.farm_field_data add column dryland_acres numeric;
