-- ============================================================================
-- Turnrow Landowner: Migration 0044
-- Ops actions (2026-11-09; turnrow-farm docs/OPS_ACTIONS.md): the write
-- half of the ops API. An Assignment in Turnrow Farm previews a fix
-- through POST /api/ops/actions/preview, a person confirms it there, and
-- Farm calls POST /api/ops/actions/apply with the preview's fingerprint
-- and an idempotency key (the proposal id). Every apply writes one row
-- here, whatever its outcome: applied, stale (the records moved since
-- the preview), refused (the app's rules said no) or failed.
--
-- Only applied rows are replayed by key, so the uniqueness is partial:
-- a stale or failed key may be tried again.
--
-- Written only by the service role (the ops routes). Admins of the
-- organization may read it; nobody writes it from the app. Not
-- entity-scoped: it is an audit log of the ops routes, like
-- assistant_usage, and only admins read it.
-- Run after 0043.
-- ============================================================================

set search_path = public, extensions;

create table public.ops_action_log (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  key              text not null check (length(key) between 1 and 200),
  action           text not null,
  params           jsonb not null default '{}',
  fingerprint      text,
  approved_by      text,
  outcome          text not null check (outcome in ('applied', 'stale', 'refused', 'failed')),
  result           jsonb,
  error            text,
  created_at       timestamptz not null default now()
);

create unique index ops_action_log_applied_key_idx
  on public.ops_action_log (organization_id, key) where outcome = 'applied';
create index ops_action_log_org_idx on public.ops_action_log (organization_id, created_at desc);

alter table public.ops_action_log enable row level security;
create policy ops_action_log_admin_read on public.ops_action_log for select to authenticated
  using (organization_id = private.user_org_id() and (select private.user_is_admin()));

comment on table public.ops_action_log is 'One row per ops action apply call from Turnrow Farm (turnrow-farm docs/OPS_ACTIONS.md): key (the proposal id; unique among applied rows), action, params, fingerprint, approved_by, outcome (applied, stale, refused, failed), result or error. Written by the service role only.';
