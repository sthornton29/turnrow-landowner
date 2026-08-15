-- ============================================================================
-- Turnrow Landowner: Migration 0006, Phase 6
-- Tenant farm data integration: connections to the Turnrow farm software's
-- partner API, explicit field mappings, and local per-year data snapshots.
-- Run after 0005.
-- ============================================================================

set search_path = public, extensions;

-- ============================================================================
-- 1. FARM CONNECTIONS
--    The partner API key is stored AES-256-GCM encrypted (app-level, secret
--    in the FARM_API_ENCRYPTION_KEY env var); ciphertext is harmless to the
--    browser and decryption happens only in server routes.
-- ============================================================================

create table public.farm_connections (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  label              text not null,
  api_key_encrypted  text not null,
  status             text not null default 'active'
                       check (status in ('active', 'error', 'revoked')),
  scopes             jsonb not null default '{}',   -- from the API handshake
  operation_name     text,
  landowner_name     text,                          -- as the farmer recorded it
  field_count        integer,
  last_synced_at     timestamptz,
  last_error         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (id, organization_id)
);

-- ============================================================================
-- 2. FIELD MAPPINGS (explicit, confirmed once; a remote field can map to a
--    local field OR to a whole property when no fields are drawn)
-- ============================================================================

create table public.field_mappings (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  farm_connection_id  uuid not null,
  remote_field_id     text not null,
  remote_name         text,
  remote_farm         text,
  remote_acres        numeric(12, 2),
  local_field_id      uuid,
  local_property_id   uuid,
  status              text not null default 'suggested'
                        check (status in ('suggested', 'confirmed', 'ignored')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  foreign key (farm_connection_id, organization_id)
    references public.farm_connections (id, organization_id) on delete cascade,
  foreign key (local_field_id, organization_id)
    references public.fields (id, organization_id) on delete set null,
  foreign key (local_property_id, organization_id)
    references public.properties (id, organization_id) on delete set null,
  unique (farm_connection_id, remote_field_id)
);

-- ============================================================================
-- 3. FARM DATA SNAPSHOTS (per connection, remote field, crop year, crop;
--    upserted on sync, never deleted, so prior years persist and the app
--    works fully offline from the farm API)
-- ============================================================================

create table public.farm_field_data (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  farm_connection_id  uuid not null,
  remote_field_id     text not null,
  crop_year           integer not null,
  crop                text not null default '',
  planted_acres       numeric(12, 2),
  planting_date       date,
  varieties           jsonb not null default '[]',
  harvested_acres     numeric(12, 2),
  production_units    numeric(14, 2),   -- null when yields are not shared
  production_unit     text,             -- 'bu' | 'lbs'
  yield_shared        boolean not null default false,
  payload             jsonb not null default '{}',
  synced_at           timestamptz not null default now(),
  foreign key (farm_connection_id, organization_id)
    references public.farm_connections (id, organization_id) on delete cascade,
  unique (farm_connection_id, remote_field_id, crop_year, crop)
);

-- ============================================================================
-- 4. updated_at triggers + indexes
-- ============================================================================

create trigger set_updated_at before update on public.farm_connections
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.field_mappings
  for each row execute function private.set_updated_at();

create index farm_connections_org_idx on public.farm_connections (organization_id);
create index field_mappings_org_idx on public.field_mappings (organization_id);
create index field_mappings_connection_idx on public.field_mappings (farm_connection_id);
create index field_mappings_local_field_idx on public.field_mappings (local_field_id);
create index farm_field_data_org_idx on public.farm_field_data (organization_id);
create index farm_field_data_connection_idx on public.farm_field_data (farm_connection_id);
create index farm_field_data_year_idx on public.farm_field_data (crop_year);

-- ============================================================================
-- 5. ROW LEVEL SECURITY (same pattern as prior phases)
-- ============================================================================

alter table public.farm_connections enable row level security;
alter table public.field_mappings   enable row level security;
alter table public.farm_field_data  enable row level security;

create policy farm_connections_all on public.farm_connections
  for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());
create policy field_mappings_all on public.field_mappings
  for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());
create policy farm_field_data_all on public.farm_field_data
  for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());
