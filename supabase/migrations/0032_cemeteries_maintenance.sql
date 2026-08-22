-- ============================================================================
-- Turnrow Landowner: Migration 0032
-- Two new mappable layers.
--
-- cemeteries: a land-use category beside ag fields, pasture/grassland,
-- wetlands, and timber. Family cemeteries are small polygons or a
-- single marker inside farmland, so the geometry accepts polygons AND
-- points (the assets pattern); acres compute for polygons only.
--
-- maintenance_issues: problems that need attention (washes, sinkholes,
-- broken terraces, road washouts, other with a free-text label). Their
-- own layer, shown or hidden independently of land use. A point, a
-- line (a broken terrace), or an area per issue; severity and an
-- open/resolved status make the map a lightweight to-do list.
--
-- "Pasture" is relabeled "Pasture/Grassland" in the UI; the stored
-- type value 'pasture' and the pastures table are unchanged.
-- Run after 0031.
-- ============================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------- cemeteries
create table public.cemeteries (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  property_id      uuid not null,
  name             text not null,
  notes            text,
  geom             geometry(Geometry, 4326)
                     check (geom is null or st_geometrytype(geom) in
                       ('ST_Point', 'ST_MultiPoint', 'ST_Polygon', 'ST_MultiPolygon')),
  acres            numeric generated always as
                     (case when geom is not null and st_dimension(geom) = 2
                           then st_area(geom::geography) / 4046.8564224 end) stored,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (property_id, organization_id)
    references public.properties (id, organization_id) on delete cascade
);

alter table public.cemeteries enable row level security;
create policy cemeteries_all on public.cemeteries for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());

create trigger set_updated_at before update on public.cemeteries
  for each row execute function private.set_updated_at();

create index cemeteries_org_idx  on public.cemeteries (organization_id);
create index cemeteries_prop_idx on public.cemeteries (property_id);
create index cemeteries_geom_gix on public.cemeteries using gist (geom);

create view public.cemeteries_geo with (security_invoker = true) as
select id, organization_id, property_id, name, notes, acres,
       st_asgeojson(geom)::json as geom_geojson, created_at, updated_at
from public.cemeteries;
grant select on public.cemeteries_geo to authenticated;

-- ---------------------------------------------------------------- maintenance issues
create table public.maintenance_issues (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  property_id      uuid,                      -- set from the geometry when known
  field_id         uuid,                      -- the ag field it sits in, when known
  issue_type       text not null check (issue_type in
                     ('wash', 'sinkhole', 'broken_terrace', 'road_washout', 'other')),
  label            text,                      -- free text, required in the UI for 'other'
  notes            text,
  severity         text check (severity in ('low', 'medium', 'high')),
  status           text not null default 'open' check (status in ('open', 'resolved')),
  resolved_at      timestamptz,
  geom             geometry(Geometry, 4326)
                     check (geom is null or st_geometrytype(geom) in
                       ('ST_Point', 'ST_MultiPoint', 'ST_LineString', 'ST_MultiLineString',
                        'ST_Polygon', 'ST_MultiPolygon')),
  acres            numeric generated always as
                     (case when geom is not null and st_dimension(geom) = 2
                           then st_area(geom::geography) / 4046.8564224 end) stored,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (property_id, organization_id)
    references public.properties (id, organization_id) on delete set null (property_id),
  foreign key (field_id, organization_id)
    references public.fields (id, organization_id) on delete set null (field_id)
);

alter table public.maintenance_issues enable row level security;
create policy maintenance_issues_all on public.maintenance_issues for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());

create trigger set_updated_at before update on public.maintenance_issues
  for each row execute function private.set_updated_at();

create index maintenance_issues_org_idx    on public.maintenance_issues (organization_id, status);
create index maintenance_issues_prop_idx   on public.maintenance_issues (property_id);
create index maintenance_issues_geom_gix   on public.maintenance_issues using gist (geom);

create view public.maintenance_issues_geo with (security_invoker = true) as
select id, organization_id, property_id, field_id, issue_type, label, notes, severity,
       status, resolved_at, acres, st_asgeojson(geom)::json as geom_geojson,
       created_by, created_at, updated_at
from public.maintenance_issues;
grant select on public.maintenance_issues_geo to authenticated;

-- Documents can attach to both.
alter table public.documents drop constraint documents_entity_type_check;
alter table public.documents add constraint documents_entity_type_check
  check (entity_type in ('property', 'parcel', 'field', 'pasture', 'wetland',
                         'easement', 'cemetery', 'maintenance_issue',
                         'timber_stand', 'road', 'asset', 'entity',
                         'tenant', 'lease', 'timber_sale', 'tax_statement',
                         'organization'));

-- ---------------------------------------------------------------- set_geometry
-- Same function as 0019 plus the two new types. Cemeteries and
-- maintenance issues keep whatever GeoJSON arrives (point, line, or
-- polygon; the table CHECK guards the types); acres come back for
-- polygons, null otherwise. SECURITY INVOKER: RLS applies.
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
  elsif p_entity_type in ('asset', 'cemetery', 'maintenance_issue') then
    if g is not null and st_isempty(g) then
      raise exception 'Empty geometry';
    end if;
    if g is not null and st_dimension(g) = 2 then
      g := st_multi(st_collectionextract(st_makevalid(g), 3));
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
  elsif p_entity_type = 'cemetery' then
    update public.cemeteries set geom = g where id = p_entity_id
      returning acres into result;
  elsif p_entity_type = 'maintenance_issue' then
    update public.maintenance_issues set geom = g where id = p_entity_id
      returning acres into result;
  end if;

  if not found then
    raise exception 'Row not found';
  end if;
  return result;
end;
$$;
