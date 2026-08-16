-- ============================================================================
-- Turnrow Landowner: Migration 0007
-- Owner entities: remember confirmed groupings of county owner-name variants
-- so future entity searches pre-group automatically. Run after 0006.
-- ============================================================================

set search_path = public, extensions;

create table public.owner_entities (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  display_name     text not null,          -- most complete variant, user-editable
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (id, organization_id)             -- composite-FK target, same pattern as properties
);

create trigger set_updated_at before update on public.owner_entities
  for each row execute function private.set_updated_at();

create index owner_entities_org_idx on public.owner_entities (organization_id);

alter table public.owner_entities enable row level security;
create policy owner_entities_all on public.owner_entities for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());

create table public.owner_aliases (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  owner_entity_id   uuid not null,
  alias             text not null,          -- owner name verbatim as the county printed it
  normalized_alias  text not null,          -- lib/ownerNames.ts normalizeOwnerName() output
  source_county     text,
  source_state      text,
  created_at        timestamptz not null default now(),
  foreign key (owner_entity_id, organization_id)
    references public.owner_entities (id, organization_id) on delete cascade,
  unique (organization_id, normalized_alias)
);

create index owner_aliases_entity_idx on public.owner_aliases (owner_entity_id);

alter table public.owner_aliases enable row level security;
create policy owner_aliases_all on public.owner_aliases for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());
