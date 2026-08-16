-- ============================================================================
-- Turnrow Landowner: Migration 0011
-- Timber Scan cache: one stored scan result per (property, CDL year).
-- The scan pipeline (CropScape CDL raster -> proposed stand polygons) is
-- expensive and CropScape can be slow, so results cache here; the
-- Rescan button overwrites. Run after 0010.
-- ============================================================================

set search_path = public, extensions;

create table public.timber_scans (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  property_id      uuid not null,
  cdl_year         integer not null,
  result           jsonb not null,   -- proposals + summary, shape owned by /api/timber-scan
  created_at       timestamptz not null default now(),
  foreign key (property_id, organization_id)
    references public.properties (id, organization_id) on delete cascade,
  unique (property_id, cdl_year)
);

create index timber_scans_org_idx on public.timber_scans (organization_id);

alter table public.timber_scans enable row level security;
create policy timber_scans_all on public.timber_scans for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());
