-- ============================================================================
-- Turnrow Landowner: Migration 0029
-- Land index and property aliases for document matching.
--
-- land_sections: which BLM PLSS sections each property (and parcel)
-- touches, with the overlap, built once from the property boundaries
-- (POST /api/land-index) and refreshed when a boundary changes. A deed's
-- "Section 31, T4S R7W" then matches by table lookup, instantly and
-- without a live BLM call, for every section the owner's land is in.
--
-- property_aliases: the historical names a family calls its tracts
-- ("View Celeste", "the Martin homeplace") that deeds use and the
-- property record does not. Learned one tap at a time after an upload
-- and fed to the reader's matching context.
-- Run after 0028.
-- ============================================================================

set search_path = public, extensions;

create table public.land_sections (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  entity_type      text not null check (entity_type in ('property', 'parcel')),
  entity_id        uuid not null,
  property_id      uuid not null,
  section_key      text not null,          -- plss_cache.key (STATE|T|R|SEC|MERIDIAN)
  state            text not null,
  township         text not null,          -- "4S"
  range            text not null,          -- "7W"
  section          int  not null,
  meridian         text not null,          -- BLM code, "16"
  overlap_acres    numeric(12, 1) not null,
  pct_of_section   numeric(6, 1) not null, -- overlap / section area
  pct_of_boundary  numeric(6, 1),          -- overlap / property or parcel area
  indexed_at       timestamptz not null default now(),
  unique (entity_type, entity_id, section_key),
  foreign key (property_id, organization_id)
    references public.properties (id, organization_id) on delete cascade
);

alter table public.land_sections enable row level security;
create policy land_sections_all on public.land_sections
  for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());

create index land_sections_org_key_idx on public.land_sections (organization_id, section_key);
create index land_sections_property_idx on public.land_sections (property_id);

create table public.property_aliases (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  property_id      uuid not null,
  alias            text not null,
  source_document_id uuid references public.documents (id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (property_id, alias),
  foreign key (property_id, organization_id)
    references public.properties (id, organization_id) on delete cascade
);

alter table public.property_aliases enable row level security;
create policy property_aliases_all on public.property_aliases
  for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());

create index property_aliases_property_idx on public.property_aliases (property_id);

-- Sections intersecting a boundary's bounding box, for the index
-- builder: returns the bbox so the server can ask the BLM layer for the
-- sections in it. SECURITY INVOKER, RLS applies.
create or replace function public.boundary_bbox(p_entity_type text, p_entity_id uuid)
returns table (xmin double precision, ymin double precision, xmax double precision, ymax double precision)
language sql
security invoker
set search_path = public, extensions
as $$
  select st_xmin(b), st_ymin(b), st_xmax(b), st_ymax(b)
  from (
    select case when p_entity_type = 'property'
                then (select boundary from public.properties where id = p_entity_id)
                else (select boundary from public.parcels where id = p_entity_id)
           end as b
  ) s
  where b is not null;
$$;

revoke all on function public.boundary_bbox(text, uuid) from public;
grant execute on function public.boundary_bbox(text, uuid) to authenticated;
