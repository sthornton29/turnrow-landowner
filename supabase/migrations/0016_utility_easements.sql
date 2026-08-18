-- ============================================================================
-- Turnrow Landowner: Migration 0016
-- Utility easements (powerline / pipeline / other): line geometry with
-- generated length like roads, plus holder, width, and the recorded
-- deed reference. property_id is NULLABLE (easements often cross
-- property lines) and property deletion DETACHES rather than deletes
-- (set null), a deliberate departure from roads' cascade. Corridor
-- acres (length x width) is derived in the app, never stored.
-- Run after 0015.
-- ============================================================================

set search_path = public, extensions;

create table public.utility_easements (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  property_id      uuid,
  name             text not null,
  easement_type    text not null check (easement_type in
                     ('powerline', 'pipeline', 'other')),
  holder           text,            -- the utility / company
  width_ft         numeric,         -- corridor width when known
  recorded_ref     text,            -- deed book/page or instrument number
  notes            text,
  geom             geometry(MultiLineString, 4326),
  length_feet      numeric generated always as
                     (st_length(geom::geography) * 3.280839895) stored,
  miles            numeric generated always as
                     (st_length(geom::geography) / 1609.344) stored,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  foreign key (property_id, organization_id)
    references public.properties (id, organization_id)
    on delete set null (property_id)
);

alter table public.utility_easements enable row level security;
create policy utility_easements_all on public.utility_easements
  for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());

create trigger set_updated_at before update on public.utility_easements
  for each row execute function private.set_updated_at();

create index utility_easements_org_idx  on public.utility_easements (organization_id);
create index utility_easements_prop_idx on public.utility_easements (property_id);
create index utility_easements_geom_gix on public.utility_easements using gist (geom);

create view public.utility_easements_geo with (security_invoker = true) as
select id, organization_id, property_id, name, easement_type, holder,
       width_ft, recorded_ref, notes, length_feet, miles,
       st_asgeojson(geom)::json as geom_geojson, created_at, updated_at
from public.utility_easements;
grant select on public.utility_easements_geo to authenticated;

-- Easement deeds are exactly the documents landowners lose.
alter table public.documents drop constraint documents_entity_type_check;
alter table public.documents add constraint documents_entity_type_check
  check (entity_type in ('property', 'parcel', 'field', 'pasture', 'wetland',
                         'utility_easement',
                         'timber_stand', 'road', 'asset', 'entity',
                         'tenant', 'lease', 'timber_sale', 'tax_statement'));

-- set_geometry learns utility easements (line rules).
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
  elsif p_entity_type in ('road', 'utility_easement') then
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
  elsif p_entity_type = 'utility_easement' then
    update public.utility_easements set geom = g where id = p_entity_id
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
