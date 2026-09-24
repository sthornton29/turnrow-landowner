-- ============================================================================
-- Turnrow Landowner: Migration 0043
-- Pollinator habitat: a new land-use category beside ag fields,
-- pasture/grassland, wetlands, timber, and cemeteries. A planted or
-- managed area of wildflowers and native grasses for bees, butterflies,
-- and other pollinators (CRP CP-42, EQIP, a monarch waystation, a
-- field border, or a corner taken out of production). Polygon-only,
-- the wetlands pattern; acres compute from the boundary.
--
-- Beyond name and notes it keeps three things a landowner is asked
-- about: the program it was planted under, the year it went in, and
-- the seed mix. Photos and documents attach through the documents
-- table like any other land type.
-- Run after 0042.
-- ============================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------- pollinator_habitats
create table public.pollinator_habitats (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  property_id      uuid not null,
  name             text not null,
  notes            text,
  program          text,                      -- CRP CP-42, EQIP, Monarch waystation, none
  year_established integer,
  seed_mix         text,
  boundary         geometry(MultiPolygon, 4326),
  acres            numeric generated always as
                     (st_area(boundary::geography) / 4046.8564224) stored,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (property_id, organization_id)
    references public.properties (id, organization_id) on delete cascade
);

alter table public.pollinator_habitats enable row level security;
create policy pollinator_habitats_all on public.pollinator_habitats for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());

-- Entity scoping (0034 pattern): user-role members see only the
-- habitats on properties their entities reach.
create policy pollinator_habitats_entity_scope on public.pollinator_habitats
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or property_id = any((select private.user_accessible_property_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or property_id = any((select private.user_accessible_property_ids())::uuid[]));

create trigger set_updated_at before update on public.pollinator_habitats
  for each row execute function private.set_updated_at();

create index pollinator_habitats_org_idx  on public.pollinator_habitats (organization_id);
create index pollinator_habitats_prop_idx on public.pollinator_habitats (property_id);
create index pollinator_habitats_boundary_gix on public.pollinator_habitats using gist (boundary);

create view public.pollinator_habitats_geo with (security_invoker = true) as
select id, organization_id, property_id, name, notes, program, year_established, seed_mix,
       acres, st_asgeojson(boundary)::json as boundary_geojson, created_at, updated_at
from public.pollinator_habitats;
grant select on public.pollinator_habitats_geo to authenticated;

-- Documents and photos can attach to a habitat.
alter table public.documents drop constraint documents_entity_type_check;
alter table public.documents add constraint documents_entity_type_check
  check (entity_type in ('property', 'parcel', 'field', 'pasture', 'wetland',
                         'pollinator_habitat',
                         'easement', 'cemetery', 'maintenance_issue',
                         'timber_stand', 'road', 'asset', 'entity',
                         'tenant', 'lease', 'timber_sale', 'tax_statement',
                         'organization'));

-- ---------------------------------------------------------------- can_access_attachment
-- Same function as 0034 plus the habitat branch (reachable through its
-- property, like pastures and wetlands).
create or replace function private.can_access_attachment(etype text, eid uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select case etype
    when 'property' then eid = any(private.user_accessible_property_ids())
    when 'parcel'   then eid = any(private.user_accessible_parcel_ids())
    when 'field'    then eid = any(private.user_accessible_field_ids())
    when 'timber_stand' then eid = any(private.user_accessible_stand_ids())
    when 'entity'   then eid = any(private.user_entity_ids())
    when 'lease'    then eid = any(private.user_accessible_lease_ids())
    when 'timber_sale' then eid = any(private.user_accessible_timber_sale_ids())
    when 'tax_statement' then eid = any(private.user_accessible_tax_statement_ids())
    when 'pasture' then exists (select 1 from public.pastures x where x.id = eid
      and x.property_id = any(private.user_accessible_property_ids()))
    when 'wetland' then exists (select 1 from public.wetlands x where x.id = eid
      and x.property_id = any(private.user_accessible_property_ids()))
    when 'pollinator_habitat' then exists (select 1 from public.pollinator_habitats x
      where x.id = eid
      and x.property_id = any(private.user_accessible_property_ids()))
    when 'road' then exists (select 1 from public.roads x where x.id = eid
      and x.property_id = any(private.user_accessible_property_ids()))
    when 'cemetery' then exists (select 1 from public.cemeteries x where x.id = eid
      and x.property_id = any(private.user_accessible_property_ids()))
    when 'asset' then exists (select 1 from public.assets x where x.id = eid
      and x.property_id = any(private.user_accessible_property_ids()))
    when 'easement' then exists (select 1 from public.easements x where x.id = eid
      and x.property_id = any(private.user_accessible_property_ids()))
    when 'maintenance_issue' then exists (select 1 from public.maintenance_issues x
      where x.id = eid
      and x.property_id = any(private.user_accessible_property_ids()))
    -- tenant documents and org-level Unfiled documents are admin-only
    else false
  end;
$$;

-- ---------------------------------------------------------------- set_geometry
-- Same function as 0032 plus pollinator habitats (polygon rules).
-- SECURITY INVOKER: RLS applies.
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
                       'pollinator_habitat', 'timber_stand') then
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
  elsif p_entity_type = 'pollinator_habitat' then
    update public.pollinator_habitats set boundary = g where id = p_entity_id
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
