-- ============================================================================
-- Turnrow Landowner: Migration 0009
-- Entity level above properties (families hold land in LLCs, corporations,
-- trusts, and their own names), UNIFIED with the owner matching feature:
-- owner_entities from 0007 becomes the entities table so a confirmed
-- county-records grouping and a title-holding entity are the same row.
-- Run after 0008.
-- ============================================================================

set search_path = public, extensions;

-- ============================================================================
-- 1. owner_entities becomes the real entities table (data preserved;
--    RLS policy, unique (id, organization_id), and indexes follow the
--    rename and are renamed for clarity).
-- ============================================================================

alter table public.owner_entities rename to entities;
alter table public.entities rename column display_name to name;
alter table public.entities add column entity_type text not null default 'other'
  check (entity_type in ('individual', 'llc', 'corporation', 'partnership',
                         'trust', 'estate', 'other'));
alter table public.entities add column notes text;
alter policy owner_entities_all on public.entities rename to entities_all;
alter index owner_entities_org_idx rename to entities_org_idx;

-- Best-guess type for rows migrated from county groupings; editable in
-- the UI, so a wrong guess costs one tap.
update public.entities set entity_type = case
  when name ~* '\mLLC\M' then 'llc'
  when name ~* '\m(CORP|CORPORATION|INC)\M' then 'corporation'
  when name ~* '\m(LP|FLP|PARTNERSHIP)\M' then 'partnership'
  when name ~* '\mTRUST\M' then 'trust'
  when name ~* '\m(ESTATE|EST)\M' then 'estate'
  else 'individual' end;

-- ============================================================================
-- 2. Aliases follow the rename (the composite FK already points at the
--    renamed table). owner_entity_id becomes entity_id.
-- ============================================================================

alter table public.owner_aliases rename to entity_aliases;
alter table public.entity_aliases rename column owner_entity_id to entity_id;
alter policy owner_aliases_all on public.entity_aliases rename to entity_aliases_all;
alter index owner_aliases_entity_idx rename to entity_aliases_entity_idx;

-- ============================================================================
-- 3. Properties optionally belong to an entity. Nullable on purpose: a
--    landowner with land in their own name is never forced to create an
--    entity. Deleting an entity detaches its properties: the column-list
--    form of SET NULL clears only entity_id, never organization_id.
-- ============================================================================

alter table public.properties add column entity_id uuid;
alter table public.properties add constraint properties_entity_fk
  foreign key (entity_id, organization_id)
  references public.entities (id, organization_id)
  on delete set null (entity_id);
create index properties_entity_idx on public.properties (entity_id);

-- properties_geo gains entity_id (appended, so replace is allowed).
create or replace view public.properties_geo with (security_invoker = true) as
select id, organization_id, name, county, state, notes, acres,
       st_asgeojson(boundary)::json as boundary_geojson, created_at, updated_at,
       entity_id
from public.properties;

-- ============================================================================
-- 4. Entity documents (operating agreements, formation docs).
-- ============================================================================

alter table public.documents drop constraint documents_entity_type_check;
alter table public.documents add constraint documents_entity_type_check
  check (entity_type in ('property', 'parcel', 'field', 'timber_stand',
                         'road', 'asset', 'tenant', 'lease', 'timber_sale',
                         'tax_statement', 'entity'));
