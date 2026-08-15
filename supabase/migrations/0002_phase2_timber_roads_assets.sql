-- ============================================================================
-- Turnrow Landowner: Migration 0002, Phase 2
-- Timber stands, roads, and fixed assets.
-- Run the whole file in the Supabase SQL editor after 0001.
-- ============================================================================

set search_path = public, extensions;

-- ============================================================================
-- 1. TIMBER STANDS
-- ============================================================================

create table public.timber_stands (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  property_id        uuid not null,
  name               text not null,   -- stand name or number
  stand_type         text check (stand_type in
                       ('planted_pine', 'natural_pine', 'hardwood', 'mixed', 'other')),
  species            text,            -- primary species
  year_established   integer,         -- origin year
  site_index         integer,
  last_thinning_year integer,
  last_burn_year     integer,         -- last prescribed burn
  notes              text,
  boundary           geometry(MultiPolygon, 4326),
  acres              numeric generated always as
                       (st_area(boundary::geography) / 4046.8564224) stored,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  foreign key (property_id, organization_id)
    references public.properties (id, organization_id) on delete cascade
);

-- ============================================================================
-- 2. ROADS
-- ============================================================================

create table public.roads (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  property_id      uuid not null,
  name             text not null,
  road_type        text check (road_type in
                     ('gravel', 'dirt', 'paved', 'field_road', 'other')),
  notes            text,
  geom             geometry(MultiLineString, 4326),
  length_feet      numeric generated always as
                     (st_length(geom::geography) * 3.280839895) stored,
  miles            numeric generated always as
                     (st_length(geom::geography) / 1609.344) stored,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  foreign key (property_id, organization_id)
    references public.properties (id, organization_id) on delete cascade
);

-- ============================================================================
-- 3. FIXED ASSETS
--    One table with a type system. Shared columns live as real columns;
--    type-specific fields live in the details jsonb, validated by the app
--    against a per-type field definition (lib/assetTypes.ts) so forms are
--    structured, never free-form JSON.
-- ============================================================================

create table public.assets (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  property_id      uuid,            -- nullable, but normally set
  asset_type       text not null check (asset_type in
                     ('well', 'irrigation_pivot', 'underground_pipe', 'riser',
                      'shop', 'shed', 'barn', 'grain_bin', 'house', 'fence',
                      'pond_dam', 'other')),
  name             text not null,   -- only name is required; drop a pin, fill in later
  -- points (wells, risers, bins, buildings), lines (pipe, fences),
  -- or polygons (building footprints, pond surface)
  geom             geometry(Geometry, 4326)
                     check (geom is null or st_geometrytype(geom) in
                       ('ST_Point', 'ST_MultiPoint', 'ST_LineString',
                        'ST_MultiLineString', 'ST_Polygon', 'ST_MultiPolygon')),
  year_installed   integer,         -- installed/built/drilled/erected
  condition        text check (condition in ('excellent', 'good', 'fair', 'poor')),
  estimated_value  numeric(14, 2),  -- dollars
  notes            text,
  details          jsonb not null default '{}',
  -- relationships: a pivot points at its supply well, a riser at its well
  parent_asset_id  uuid,
  is_active        boolean not null default true,  -- keep history, don't delete
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (id, organization_id),    -- composite FK target (parent link below)
  foreign key (property_id, organization_id)
    references public.properties (id, organization_id) on delete cascade,
  foreign key (parent_asset_id, organization_id)
    references public.assets (id, organization_id) on delete set null
);

-- Documents (and photos, which are image documents) attach to the new
-- entities through the existing documents table.
alter table public.documents drop constraint documents_entity_type_check;
alter table public.documents add constraint documents_entity_type_check
  check (entity_type in ('property', 'parcel', 'field',
                         'timber_stand', 'road', 'asset'));

-- ============================================================================
-- 4. GeoJSON read views (same pattern as Phase 1)
-- ============================================================================

create view public.timber_stands_geo with (security_invoker = true) as
select id, organization_id, property_id, name, stand_type, species,
       year_established, site_index, last_thinning_year, last_burn_year,
       notes, acres, st_asgeojson(boundary)::json as boundary_geojson,
       created_at, updated_at
from public.timber_stands;

create view public.roads_geo with (security_invoker = true) as
select id, organization_id, property_id, name, road_type, notes,
       length_feet, miles, st_asgeojson(geom)::json as geom_geojson,
       created_at, updated_at
from public.roads;

create view public.assets_geo with (security_invoker = true) as
select id, organization_id, property_id, asset_type, name, year_installed,
       condition, estimated_value, notes, details, parent_asset_id, is_active,
       st_asgeojson(geom)::json as geom_geojson, created_at, updated_at
from public.assets;

grant select on public.timber_stands_geo, public.roads_geo, public.assets_geo
  to authenticated;

-- ============================================================================
-- 5. Generalized geometry writer (supersedes set_boundary, which still works
--    for the original three types). SECURITY INVOKER, so RLS applies.
--    Returns acres for polygons, miles for roads, null for assets.
-- ============================================================================

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

  if p_entity_type in ('property', 'parcel', 'field', 'timber_stand') then
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

-- ============================================================================
-- 6. updated_at triggers + indexes
-- ============================================================================

create trigger set_updated_at before update on public.timber_stands
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.roads
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.assets
  for each row execute function private.set_updated_at();

create index timber_stands_org_idx  on public.timber_stands (organization_id);
create index timber_stands_prop_idx on public.timber_stands (property_id);
create index roads_org_idx          on public.roads (organization_id);
create index roads_prop_idx         on public.roads (property_id);
create index assets_org_idx         on public.assets (organization_id);
create index assets_prop_idx        on public.assets (property_id);
create index assets_type_idx        on public.assets (asset_type);
create index assets_parent_idx     on public.assets (parent_asset_id);
create index timber_stands_boundary_gix on public.timber_stands using gist (boundary);
create index roads_geom_gix             on public.roads using gist (geom);
create index assets_geom_gix            on public.assets using gist (geom);

-- ============================================================================
-- 7. ROW LEVEL SECURITY (same pattern as Phase 1)
-- ============================================================================

alter table public.timber_stands enable row level security;
alter table public.roads         enable row level security;
alter table public.assets        enable row level security;

create policy timber_stands_all on public.timber_stands for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());
create policy roads_all on public.roads for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());
create policy assets_all on public.assets for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());
