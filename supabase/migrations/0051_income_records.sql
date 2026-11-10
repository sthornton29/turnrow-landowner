-- ============================================================================
-- Turnrow Landowner: Migration 0051
-- INCOME RECORDS: income received that does not come through a lease
-- payment or a timber settlement. Two uses:
--   * history: rent, solar, tower, and building income from the old books
--     (CenterPoint 2005-2020, Xero 2020-2024, QuickBooks Online), loaded
--     once with import_key set so a reload never doubles a row;
--   * going forward: income with no lease in Turnrow (a solar option
--     payment, a tower check, a one-off receipt).
-- Each record counts as RECEIVED income in its year (lib/income.ts). A
-- record may name a property (income routes there), only an entity
-- (shown under the entity as "not tied to a property"), or neither.
-- basis says how firm the figure is: received (cash in), accrued (an
-- invoice or settlement owed), calculated (a settlement worked out but
-- not confirmed paid). needs_review marks rows a person should check.
-- Run after 0050.
-- ============================================================================

set search_path = public, extensions;

create table public.income_records (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  year             integer not null check (year between 1900 and 2200),
  received_date    date,               -- exact date when known
  period           text,               -- as the source states it: "2008 (10 receipts)", "Jan-Jul 2025"
  payer            text,
  payee_name       text,               -- as the books name the payee, when it differs from the entity
  entity_id        uuid,
  property_id      uuid,
  income_type      text not null check (income_type in (
                     'farmland_cash_rent', 'share_rent', 'hunting', 'timber',
                     'solar', 'tower', 'commercial_rent', 'government', 'other')),
  amount           numeric(14, 2) not null,
  basis            text not null default 'received' check (basis in ('received', 'accrued', 'calculated')),
  confidence       text check (confidence in ('high', 'medium', 'low')),
  needs_review     boolean not null default false,
  source           text,               -- file and cell or page
  notes            text,
  import_key       text,               -- set by a bulk load; unique per org
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, import_key),
  foreign key (entity_id, organization_id)
    references public.entities (id, organization_id) on delete set null (entity_id),
  foreign key (property_id, organization_id)
    references public.properties (id, organization_id) on delete set null (property_id)
);

alter table public.income_records enable row level security;
create policy income_records_all on public.income_records for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());
-- A record follows its property; one with only an entity follows the
-- entity; one with neither is admin-only.
create policy income_records_entity_scope on public.income_records
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or property_id = any((select private.user_accessible_property_ids())::uuid[])
         or (property_id is null and entity_id = any((select private.user_entity_ids())::uuid[])))
  with check ((select private.user_is_admin())
              or property_id = any((select private.user_accessible_property_ids())::uuid[])
              or (property_id is null and entity_id = any((select private.user_entity_ids())::uuid[])));

create trigger set_updated_at before update on public.income_records
  for each row execute function private.set_updated_at();
create index income_records_org_idx  on public.income_records (organization_id);
create index income_records_year_idx on public.income_records (organization_id, year);
create index income_records_prop_idx on public.income_records (property_id);
