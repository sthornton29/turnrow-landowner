-- ============================================================================
-- Turnrow Landowner: Migration 0049
-- PROPERTY TAX REPORT, stage 1: the reference data and history the report
-- needs (docs/research/2026-11-09/research-property-tax.md, section 7).
--
--   * tax_current_use_values: ADOR current use values per acre by land type
--     and soil rating, per tax year. Platform reference (read by everyone,
--     written by platform admins), like county_gis_services.
--   * tax_millage_rates: total mills per county tax district per tax year,
--     with components and whether the rate was verified against real bills.
--     Seeded with Lawrence 01/04/06 and Colbert 01, each verified to the
--     penny against the county records (assessed x mills + $0.10 per timber
--     acre + fire fee), and Morgan's rural rate from the ADOR PDF
--     (unverified).
--   * parcel_valuations: a yearly copy of each parcel's county record. The
--     record on parcels.attributes is overwritten by every refresh, so
--     value history was being lost. A trigger saves a copy keyed by the
--     record's own year (TaxYearDue / RecordYear / CurrentYear, else the
--     fetch year) whenever attributes change; field names differ by county,
--     so the raw record is kept and lib/countyRecord.ts reads it.
--   * parcels.current_use_status (enrolled | not_enrolled | unknown) and
--     parcels.is_homestead: owner-confirmed facts that turn the report's
--     guesses into checks.
-- Run after 0048.
-- ============================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------- tax_current_use_values
create table public.tax_current_use_values (
  id             uuid primary key default gen_random_uuid(),
  state          text not null,
  tax_year       integer not null,
  land_type      text not null check (land_type in ('crop_pasture', 'timber')),
  rating         text not null check (rating in ('good', 'average', 'poor', 'nonproductive')),
  value_per_acre numeric(10, 2) not null check (value_per_acre >= 0),
  source_url     text,
  created_at     timestamptz not null default now(),
  unique (state, tax_year, land_type, rating)
);

alter table public.tax_current_use_values enable row level security;
create policy tax_current_use_values_read on public.tax_current_use_values
  for select to authenticated using (true);
create policy tax_current_use_values_insert on public.tax_current_use_values
  for insert to authenticated with check (private.is_platform_admin());
create policy tax_current_use_values_update on public.tax_current_use_values
  for update to authenticated using (private.is_platform_admin()) with check (private.is_platform_admin());
create policy tax_current_use_values_delete on public.tax_current_use_values
  for delete to authenticated using (private.is_platform_admin());

insert into public.tax_current_use_values (state, tax_year, land_type, rating, value_per_acre, source_url)
select 'AL', y, t, r, v, u from (values
  (2023, 'crop_pasture', 'good', 532), (2023, 'crop_pasture', 'average', 443), (2023, 'crop_pasture', 'poor', 310), (2023, 'crop_pasture', 'nonproductive', 110),
  (2024, 'crop_pasture', 'good', 532), (2024, 'crop_pasture', 'average', 443), (2024, 'crop_pasture', 'poor', 310), (2024, 'crop_pasture', 'nonproductive', 110),
  (2025, 'crop_pasture', 'good', 532), (2025, 'crop_pasture', 'average', 443), (2025, 'crop_pasture', 'poor', 310), (2025, 'crop_pasture', 'nonproductive', 110),
  (2023, 'timber', 'good', 805), (2023, 'timber', 'average', 613), (2023, 'timber', 'poor', 437), (2023, 'timber', 'nonproductive', 350),
  (2024, 'timber', 'good', 816), (2024, 'timber', 'average', 622), (2024, 'timber', 'poor', 443), (2024, 'timber', 'nonproductive', 355),
  (2025, 'timber', 'good', 827), (2025, 'timber', 'average', 630), (2025, 'timber', 'poor', 449), (2025, 'timber', 'nonproductive', 360)
) as x(y, t, r, v)
cross join lateral (select case x.y
  when 2025 then 'https://revenue.alabama.gov/wp-content/uploads/2025/01/CU-2025rev.pdf'
  when 2024 then 'https://revenue.alabama.gov/wp-content/uploads/2024/09/CU_Directive-2024.pdf'
  else 'https://REVENUE.ALABAMA.GOV/wp-content/uploads/2024/01/CU_Directive-2023.pdf' end as u) src;

-- ---------------------------------------------------------------- tax_millage_rates
create table public.tax_millage_rates (
  id            uuid primary key default gen_random_uuid(),
  state         text not null,
  county        text not null,
  district      text not null,          -- the county record's TaxDist code; '*' = county rural default
  tax_year      integer not null,
  total_mills   numeric(7, 3) not null check (total_mills >= 0),
  components    jsonb not null default '{}'::jsonb,
  timber_per_acre numeric(6, 2) not null default 0.10,
  dwelling_fee  numeric(8, 2),          -- fire fee per dwelling or commercial building
  verified      boolean not null default false,   -- tied out against real bills
  note          text,
  source_url    text,
  created_at    timestamptz not null default now(),
  unique (state, county, district, tax_year)
);

alter table public.tax_millage_rates enable row level security;
create policy tax_millage_rates_read on public.tax_millage_rates
  for select to authenticated using (true);
create policy tax_millage_rates_insert on public.tax_millage_rates
  for insert to authenticated with check (private.is_platform_admin());
create policy tax_millage_rates_update on public.tax_millage_rates
  for update to authenticated using (private.is_platform_admin()) with check (private.is_platform_admin());
create policy tax_millage_rates_delete on public.tax_millage_rates
  for delete to authenticated using (private.is_platform_admin());

insert into public.tax_millage_rates (state, county, district, tax_year, total_mills, components, dwelling_fee, verified, note, source_url) values
  ('AL', 'Lawrence', '01', 2025, 30.0, '{"state": 6.5, "county": 13.5, "school": 10.0}', 25, true,
   'Rural. Ties out to the penny on the 2026 Lawrence county records: assessed x 30 mills + $0.10 per timber acre + $25 per dwelling.',
   'https://www.revenue.alabama.gov/wp-content/uploads/2025/09/2025-Millage-Rates.pdf'),
  ('AL', 'Lawrence', '04', 2025, 37.0, '{}', 25, true,
   'Inside a town (municipal levy on top of the rural 30). Derived from the Lawrence county records; components not broken out.', null),
  ('AL', 'Lawrence', '06', 2025, 37.0, '{}', 25, true,
   'Inside a town. Derived from the Lawrence county records; components not broken out.', null),
  ('AL', 'Colbert', '01', 2025, 30.0, '{"state": 6.5, "county": 8.5, "school": 15.0}', 50, true,
   'Rural. Ties out on the Colbert county records (assessed x 30 mills + $0.10 per timber acre).',
   'https://www.revenue.alabama.gov/wp-content/uploads/2025/09/2025-Millage-Rates.pdf'),
  ('AL', 'Morgan', '*', 2025, 37.4, '{"state": 6.5, "county": 13.8, "school": 17.1}', null, false,
   'Rural outside the cities, read from the ADOR 2025 millage PDF. Not yet checked against a Morgan bill.',
   'https://www.revenue.alabama.gov/wp-content/uploads/2025/09/2025-Millage-Rates.pdf');

-- ---------------------------------------------------------------- parcel_valuations
create table public.parcel_valuations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  parcel_id        uuid not null,
  record_year      integer not null,
  attributes       jsonb not null,
  source           text,
  fetched_at       timestamptz not null default now(),
  unique (parcel_id, record_year),
  foreign key (parcel_id, organization_id)
    references public.parcels (id, organization_id) on delete cascade
);

alter table public.parcel_valuations enable row level security;
create policy parcel_valuations_all on public.parcel_valuations for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());
create policy parcel_valuations_entity_scope on public.parcel_valuations
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or parcel_id = any((select private.user_accessible_parcel_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or parcel_id = any((select private.user_accessible_parcel_ids())::uuid[]));

create index parcel_valuations_org_idx    on public.parcel_valuations (organization_id);
create index parcel_valuations_parcel_idx on public.parcel_valuations (parcel_id);

-- The record's own year, from whichever field the county uses.
create or replace function private.county_record_year(a jsonb, fetched timestamptz)
returns integer language sql immutable set search_path = ''
as $$
  select coalesce(
    case when (a->>'TaxYearDue') ~ '^\d{4}$' then (a->>'TaxYearDue')::int end,
    case when (a->>'RecordYear') ~ '^\d{4}$' then (a->>'RecordYear')::int end,
    case when (a->>'CurrentYear') ~ '^\d{4}$' then (a->>'CurrentYear')::int end,
    extract(year from coalesce(fetched, now()))::int);
$$;

-- Save (or refresh) this year's copy whenever a parcel's county record
-- changes. SECURITY DEFINER so it works whoever refreshes; it only ever
-- writes the parcel's own organization.
create or replace function private.snapshot_parcel_valuation()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.attributes is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.attributes is not distinct from old.attributes then
    return new;
  end if;
  insert into public.parcel_valuations (organization_id, parcel_id, record_year, attributes, source, fetched_at)
  values (new.organization_id, new.id,
          private.county_record_year(new.attributes, new.attributes_fetched_at),
          new.attributes, new.attributes_source, coalesce(new.attributes_fetched_at, now()))
  on conflict (parcel_id, record_year) do update
    set attributes = excluded.attributes, source = excluded.source, fetched_at = excluded.fetched_at;
  return new;
end;
$$;

create trigger parcels_snapshot_valuation
  after insert or update of attributes on public.parcels
  for each row execute function private.snapshot_parcel_valuation();

-- The records already on file become the first snapshot.
insert into public.parcel_valuations (organization_id, parcel_id, record_year, attributes, source, fetched_at)
select organization_id, id, private.county_record_year(attributes, attributes_fetched_at),
       attributes, attributes_source, coalesce(attributes_fetched_at, now())
from public.parcels
where attributes is not null
on conflict (parcel_id, record_year) do nothing;

-- ---------------------------------------------------------------- owner facts
alter table public.parcels
  add column if not exists current_use_status text not null default 'unknown'
    check (current_use_status in ('enrolled', 'not_enrolled', 'unknown')),
  add column if not exists is_homestead boolean not null default false;
