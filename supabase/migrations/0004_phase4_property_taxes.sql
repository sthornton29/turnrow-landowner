-- ============================================================================
-- Turnrow Landowner: Migration 0004, Phase 4
-- Property taxes: statements, payments, per-county date defaults.
-- Run after 0003.
-- ============================================================================

set search_path = public, extensions;

-- Composite-FK target needed by tax_statements (parcels never got this).
alter table public.parcels add unique (id, organization_id);

-- ============================================================================
-- 1. Per-county defaults for due / delinquent dates.
--    Alabama's calendar is the app-level fallback when no row exists:
--    due October 1 of the tax year, delinquent January 1 of the next year.
--    A delinquent month earlier than the due month means "next calendar
--    year" (the app applies that rule when computing actual dates).
-- ============================================================================

create table public.county_tax_defaults (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  county            text not null,
  state             text not null default '',
  due_month         integer not null default 10 check (due_month between 1 and 12),
  due_day           integer not null default 1  check (due_day between 1 and 31),
  delinquent_month  integer not null default 1  check (delinquent_month between 1 and 12),
  delinquent_day    integer not null default 1  check (delinquent_day between 1 and 31),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (organization_id, county, state)
);

-- ============================================================================
-- 2. TAX STATEMENTS
--    parcel_id stays null until the statement is matched to a parcel
--    (extraction proposes a match; the user confirms, creates the missing
--    parcel, or leaves it unmatched to resolve later). The printed parcel
--    number and owner name are kept verbatim even after matching.
--    Status (unpaid / partially paid / paid / delinquent styling) is
--    COMPUTED from tax_payments vs amount_due, never stored.
-- ============================================================================

create table public.tax_statements (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations (id) on delete cascade,
  parcel_id              uuid,
  tax_year               integer not null,
  county                 text,
  state                  text,
  authority_name         text,          -- taxing authority as printed
  parcel_number_printed  text,          -- as printed on the statement
  owner_name_printed     text,          -- as printed on the statement
  assessed_value         numeric(14, 2),
  amount_due             numeric(14, 2) not null default 0,
  due_date               date,
  delinquent_date        date,
  notes                  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  foreign key (parcel_id, organization_id)
    references public.parcels (id, organization_id) on delete set null,
  -- One statement per parcel per tax year. NULL parcel_id (unmatched) is
  -- exempt, so any number of unmatched statements can await resolution.
  unique (parcel_id, tax_year)
);

-- ============================================================================
-- 3. TAX PAYMENTS (partial payments supported; batch payments create one
--    row per statement sharing the same date and check number)
-- ============================================================================

create table public.tax_payments (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  tax_statement_id  uuid not null,
  paid_date         date not null,
  amount            numeric(14, 2) not null,
  method            text,            -- e.g. "check 1042"
  memo              text,
  created_at        timestamptz not null default now(),
  foreign key (tax_statement_id, organization_id)
    references public.tax_statements (id, organization_id) on delete cascade
);

-- tax_statements needs a composite unique for that FK.
alter table public.tax_statements add unique (id, organization_id);

-- Statement PDFs / photos attach through the existing documents table.
alter table public.documents drop constraint documents_entity_type_check;
alter table public.documents add constraint documents_entity_type_check
  check (entity_type in ('property', 'parcel', 'field', 'timber_stand',
                         'road', 'asset', 'tenant', 'lease', 'timber_sale',
                         'tax_statement'));

-- ============================================================================
-- 4. updated_at triggers + indexes
-- ============================================================================

create trigger set_updated_at before update on public.county_tax_defaults
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.tax_statements
  for each row execute function private.set_updated_at();

create index county_tax_defaults_org_idx on public.county_tax_defaults (organization_id);
create index tax_statements_org_idx      on public.tax_statements (organization_id);
create index tax_statements_parcel_idx   on public.tax_statements (parcel_id);
create index tax_statements_year_idx     on public.tax_statements (tax_year);
create index tax_payments_org_idx        on public.tax_payments (organization_id);
create index tax_payments_statement_idx  on public.tax_payments (tax_statement_id);

-- ============================================================================
-- 5. ROW LEVEL SECURITY (same pattern as prior phases)
-- ============================================================================

alter table public.county_tax_defaults enable row level security;
alter table public.tax_statements      enable row level security;
alter table public.tax_payments        enable row level security;

create policy county_tax_defaults_all on public.county_tax_defaults
  for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());
create policy tax_statements_all on public.tax_statements
  for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());
create policy tax_payments_all on public.tax_payments
  for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());
