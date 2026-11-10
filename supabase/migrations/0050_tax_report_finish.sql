-- ============================================================================
-- Turnrow Landowner: Migration 0050
-- PROPERTY TAX REPORT, finishing work.
--
--   * ADOR Directive CU-2027 (dated Oct 1, 2026; values for property
--     eligible as of Oct 1, 2026, collection beginning Oct 1, 2027), read
--     from the scanned PDF: row crop and pasture unchanged at 532 / 443 /
--     310 / 110; timber 848 / 646 / 460 / 368. No CU-2026 directive is
--     posted, so 2026 uses the 2025 table.
--   * Morgan rural millage verified: the Morgan 2025 bills give (150.86 -
--     5 timber ac x $0.10) / 4,020 assessed = 37.40 mills and 70.30 /
--     1,880 = 37.39 mills.
--   * tax_valuation_notices: the date a county's valuation notice arrived
--     (optionally for one parcel). It starts the 30-day Board of
--     Equalization protest clock the report counts down.
--   * tax_statement_lines gains the values a bill prints beyond the one
--     total: market value, current use value, land and improvement value,
--     assessment ratio, tax district, millage, timber acres. Filled by new
--     uploads and by the "Re-read bills" review (values_read_at). The
--     extraction used to put market value in some years and current use
--     value in others into appraised_value; these columns keep them apart.
-- Run after 0049.
-- ============================================================================

set search_path = public, extensions;

insert into public.tax_current_use_values (state, tax_year, land_type, rating, value_per_acre, source_url)
select 'AL', 2027, t, r, v, 'https://www.revenue.alabama.gov/wp-content/uploads/2026/11/Directive-2027-Current-Use-Valuation-Procedures.pdf'
from (values
  ('crop_pasture', 'good', 532), ('crop_pasture', 'average', 443), ('crop_pasture', 'poor', 310), ('crop_pasture', 'nonproductive', 110),
  ('timber', 'good', 848), ('timber', 'average', 646), ('timber', 'poor', 460), ('timber', 'nonproductive', 368)
) as x(t, r, v)
on conflict (state, tax_year, land_type, rating) do nothing;

update public.tax_millage_rates
set verified = true,
    note = 'Rural outside the cities, 6.5 state + 13.8 county + 17.1 school (ADOR 2025 millage PDF). Verified on the Morgan 2025 bills: (150.86 - $0.50 timber tax) / 4,020 assessed = 37.40 mills; 70.30 / 1,880 = 37.39.'
where state = 'AL' and county = 'Morgan' and district = '*' and tax_year = 2025;

-- ---------------------------------------------------------------- tax_valuation_notices
create table public.tax_valuation_notices (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  state            text not null default 'AL',
  county           text not null,
  tax_year         integer not null,
  notice_date      date not null,
  parcel_id        uuid,
  notes            text,
  created_at       timestamptz not null default now(),
  foreign key (parcel_id, organization_id)
    references public.parcels (id, organization_id) on delete cascade
);

alter table public.tax_valuation_notices enable row level security;
create policy tax_valuation_notices_all on public.tax_valuation_notices for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());
-- County-wide notices are org-level; a parcel notice follows the parcel.
create policy tax_valuation_notices_entity_scope on public.tax_valuation_notices
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or parcel_id is null
         or parcel_id = any((select private.user_accessible_parcel_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or parcel_id is null
              or parcel_id = any((select private.user_accessible_parcel_ids())::uuid[]));
create index tax_valuation_notices_org_idx on public.tax_valuation_notices (organization_id);

-- ---------------------------------------------------------------- statement line values
alter table public.tax_statement_lines
  add column if not exists market_value      numeric(14, 2),
  add column if not exists current_use_value numeric(14, 2),
  add column if not exists land_value        numeric(14, 2),
  add column if not exists improvement_value numeric(14, 2),
  add column if not exists assessment_ratio  numeric(5, 2),   -- percent: 10, 20
  add column if not exists tax_district      text,
  add column if not exists millage           numeric(7, 3),
  add column if not exists timber_acres      numeric(12, 2),
  add column if not exists values_read_at    timestamptz;
