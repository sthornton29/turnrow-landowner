-- 0040: farm sync state surfacing + tenant-data drift flags.
--
-- Part 1: farm_connections gains scopes_checked_at (the moment the live
-- handshake last answered; the stored scopes column is a pure display
-- cache refreshed from that answer on EVERY sync run, so a scope granted
-- or revoked farm-side shows on the card after the next sync) and
-- sync_detail (per-area outcome of the last sync run: prices / yields
-- fetch state ok | scope_off | error with a message, written by
-- lib/farmSync.ts and rendered as a dev-visible details block on the
-- connection card, so a swallowed failure is never invisible again).
--
-- Part 2: lease_assumption_drift, one row per committed tenant-sourced
-- assumption value that now differs from the synced cache. Recomputed
-- after every sync (lib/assumptionDriftSync.ts) and reconciled by every
-- assumption save/accept; read by the lease list, lease page, income
-- page, and the /leases/updates review screen. Accepting a row is always
-- an explicit user act; nothing here ever writes an assumption.
--
-- Idempotent: safe to re-run.

set search_path = public, extensions;

alter table public.farm_connections
  add column if not exists scopes_checked_at timestamptz;
alter table public.farm_connections
  add column if not exists sync_detail jsonb not null default '{}';

create table if not exists public.lease_assumption_drift (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  lease_id           uuid not null,
  year               integer not null,
  -- The saved assumption entry's crop, verbatim (matching goes through
  -- lib/crops.ts, so "Beans" here can pair with a "Soybeans" cache row).
  crop               text not null,
  practice           text not null default 'blended'
                       check (practice in ('irrigated', 'dryland', 'blended')),
  field              text not null
                       check (field in ('acres', 'expected_yield', 'expected_price')),
  committed_value    numeric not null,
  -- What the Use helper would fill today (prices already in dollars).
  tenant_value       numeric not null,
  tenant_kind        text not null
                       check (tenant_kind in ('tenant_projected', 'tenant_final', 'tenant_actual')),
  tenant_as_of       text,
  -- Drives the strongest chip wording ("Final price available").
  is_final_price     boolean not null default false,
  farm_connection_id uuid references public.farm_connections (id) on delete cascade,
  detected_at        timestamptz not null default now(),
  foreign key (lease_id, organization_id)
    references public.leases (id, organization_id) on delete cascade,
  -- Plain constraint (no coalesce expression) so upsert(onConflict) works.
  unique (lease_id, year, crop, practice, field)
);

create index if not exists lease_assumption_drift_org_idx
  on public.lease_assumption_drift (organization_id);
create index if not exists lease_assumption_drift_lease_idx
  on public.lease_assumption_drift (lease_id);

alter table public.lease_assumption_drift enable row level security;

drop policy if exists lease_assumption_drift_all on public.lease_assumption_drift;
create policy lease_assumption_drift_all on public.lease_assumption_drift
  for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());

-- Entity scope, restrictive, the 0034 lease-chain shape (same as
-- lease_year_assumptions_entity_scope): a user-role member sees drift
-- only for leases on land they can access.
drop policy if exists lease_assumption_drift_entity_scope on public.lease_assumption_drift;
create policy lease_assumption_drift_entity_scope on public.lease_assumption_drift
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or lease_id = any((select private.user_accessible_lease_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or lease_id = any((select private.user_accessible_lease_ids())::uuid[]));
