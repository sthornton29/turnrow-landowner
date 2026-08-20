-- ============================================================================
-- Turnrow Landowner: Migration 0021
-- Government payments (ARC/PLC projections for base acres on the land).
-- Per-org tables: fsa_farms (FSA farm records, populated from 156EZ scans
-- or by hand), fsa_farm_properties (farm -> property links with an
-- allocation percent; one link at 100 is the default), fsa_base_acres
-- (commodity, base acres, PLC yield), fsa_elections (PLC | ARC-CO | ARC-IC
-- per farm x commodity x program year; the app defaults to PLC).
-- GLOBAL tables (public USDA data is not tenant-specific, exactly like
-- county_gis_services and rma_price_cache): covered_commodities and
-- program_year_config (platform-admin curated, seeded with the OBBBA
-- values from docs/GOV_PAYMENTS_PATHWAYS.md), arc_plc_price_data (MYA and
-- effective reference prices per commodity x program year; admin-curated,
-- the server refreshes estimates without touching manual/final values),
-- mya_monthly_prices (confirmed NASS months), fsa_benchmark_cache and
-- fsa_benchmark_fetches (server-refreshed caches of FSA's benchmark
-- workbook; no client write policies, the service role writes).
-- Payment limits are deliberately absent: the landowner app never models
-- producer limits. Run after 0020.
-- ============================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------- per org

create table public.fsa_farms (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  farm_number         text not null,
  state               text,
  county              text,
  farmland_acres      numeric,
  cropland_acres      numeric,
  dcp_cropland_acres  numeric,
  notes               text,
  source_document_id  uuid,            -- the 156EZ scan that created it (no FK)
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (organization_id, farm_number, state, county),
  unique (id, organization_id)
);
alter table public.fsa_farms enable row level security;
create policy fsa_farms_all on public.fsa_farms for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());
create trigger set_updated_at before update on public.fsa_farms
  for each row execute function private.set_updated_at();
create index fsa_farms_org_idx on public.fsa_farms (organization_id);

create table public.fsa_farm_properties (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  fsa_farm_id      uuid not null,
  property_id      uuid not null,
  allocation_pct   numeric not null default 100 check (allocation_pct >= 0 and allocation_pct <= 100),
  created_at       timestamptz not null default now(),
  unique (fsa_farm_id, property_id),
  foreign key (fsa_farm_id, organization_id)
    references public.fsa_farms (id, organization_id) on delete cascade,
  foreign key (property_id, organization_id)
    references public.properties (id, organization_id) on delete cascade
);
alter table public.fsa_farm_properties enable row level security;
create policy fsa_farm_properties_all on public.fsa_farm_properties for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());
create index fsa_farm_properties_farm_idx on public.fsa_farm_properties (fsa_farm_id);
create index fsa_farm_properties_prop_idx on public.fsa_farm_properties (property_id);

create table public.fsa_base_acres (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  fsa_farm_id      uuid not null,
  commodity        text not null check (commodity in
                     ('corn', 'soybeans', 'wheat', 'seed_cotton', 'grain_sorghum',
                      'oats', 'barley', 'peanuts', 'canola', 'sesame')),
  base_acres       numeric,
  plc_yield        numeric,
  tract_numbers    text[],
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (fsa_farm_id, commodity),
  foreign key (fsa_farm_id, organization_id)
    references public.fsa_farms (id, organization_id) on delete cascade
);
alter table public.fsa_base_acres enable row level security;
create policy fsa_base_acres_all on public.fsa_base_acres for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());
create trigger set_updated_at before update on public.fsa_base_acres
  for each row execute function private.set_updated_at();
create index fsa_base_acres_farm_idx on public.fsa_base_acres (fsa_farm_id);

create table public.fsa_elections (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  fsa_farm_id      uuid not null,
  commodity        text not null,
  program_year     int not null,
  election         text not null check (election in ('plc', 'arc_co', 'arc_ic')),
  created_at       timestamptz not null default now(),
  unique (fsa_farm_id, commodity, program_year),
  foreign key (fsa_farm_id, organization_id)
    references public.fsa_farms (id, organization_id) on delete cascade
);
alter table public.fsa_elections enable row level security;
create policy fsa_elections_all on public.fsa_elections for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());

-- ---------------------------------------------------------------- global

-- Statutory reference prices and loan rates (OBBBA 2025-2031) per
-- docs/GOV_PAYMENTS_PATHWAYS.md section 3.2. Platform-admin curated.
create table public.covered_commodities (
  slug                       text primary key,
  name                       text not null,
  unit                       text not null check (unit in ('bushel', 'pound')),
  statutory_reference_price  numeric not null,
  national_loan_rate         numeric not null,
  marketing_year_start_month int not null,
  lint_share                 numeric,
  cottonseed_share           numeric,
  mya_month_weights          jsonb,
  mya_basis_adj              numeric,
  updated_at                 timestamptz not null default now()
);
alter table public.covered_commodities enable row level security;
create policy covered_commodities_select on public.covered_commodities
  for select to authenticated using (true);
create policy covered_commodities_insert on public.covered_commodities
  for insert to authenticated with check (private.is_platform_admin());
create policy covered_commodities_update on public.covered_commodities
  for update to authenticated using (private.is_platform_admin()) with check (private.is_platform_admin());
create policy covered_commodities_delete on public.covered_commodities
  for delete to authenticated using (private.is_platform_admin());

insert into public.covered_commodities
  (slug, name, unit, statutory_reference_price, national_loan_rate, marketing_year_start_month) values
  ('corn',          'Corn',          'bushel', 4.10,   2.42,   9),
  ('soybeans',      'Soybeans',      'bushel', 10.00,  6.82,   9),
  ('wheat',         'Wheat',         'bushel', 6.35,   3.72,   6),
  ('seed_cotton',   'Seed cotton',   'pound',  0.42,   0.25,   8),
  ('grain_sorghum', 'Grain sorghum', 'bushel', 4.40,   2.42,   9),
  ('oats',          'Oats',          'bushel', 2.65,   2.20,   6),
  ('barley',        'Barley',        'bushel', 5.45,   2.75,   6),
  ('peanuts',       'Peanuts',       'pound',  0.315,  0.195,  8),
  ('canola',        'Canola',        'pound',  0.2015, 0.1009, 7),
  ('sesame',        'Sesame',        'pound',  0.2015, 0.1009, 9);

-- Per-program-year parameters (section 3.1). Column name crop_year keeps
-- the ported resolver verbatim; it means the program year.
create table public.program_year_config (
  crop_year              int primary key,
  arc_guarantee_pct      numeric not null default 0.90,
  arc_payment_cap_pct    numeric not null default 0.12,
  erp_olympic_factor     numeric not null default 0.88,
  erp_cap_pct            numeric not null default 1.15,
  payment_factor         numeric not null default 0.85,
  arc_ic_payment_factor  numeric not null default 0.65,
  sequestration_pct      numeric not null default 0.054,
  notes                  text,
  updated_at             timestamptz not null default now()
);
alter table public.program_year_config enable row level security;
create policy program_year_config_select on public.program_year_config
  for select to authenticated using (true);
create policy program_year_config_insert on public.program_year_config
  for insert to authenticated with check (private.is_platform_admin());
create policy program_year_config_update on public.program_year_config
  for update to authenticated using (private.is_platform_admin()) with check (private.is_platform_admin());
create policy program_year_config_delete on public.program_year_config
  for delete to authenticated using (private.is_platform_admin());
insert into public.program_year_config (crop_year, notes) values
  (2025, 'OBBBA parameters'), (2026, 'OBBBA parameters'), (2027, 'OBBBA parameters');

-- MYA and effective reference prices per commodity x program year
-- (section 1.3 precedence: final > manual > wasde midpoint > estimate).
-- Admin-curated; the mya-estimate route refreshes mya_price_estimate via
-- the service role and never overwrites source = 'manual' or a final.
-- benchmark_price holds the seeded national ARC benchmark price (the FSA
-- workbook's own price is preferred when it parses).
create table public.arc_plc_price_data (
  id                         uuid primary key default gen_random_uuid(),
  commodity                  text not null references public.covered_commodities (slug) on delete cascade,
  program_year               int not null,
  effective_reference_price  numeric,
  mya_price_estimate         numeric,
  mya_price_final            numeric,
  wasde_midpoint             numeric,
  benchmark_price            numeric,
  source                     text not null default 'estimate'
                               check (source in ('usda', 'manual', 'wasde', 'estimate')),
  note                       text,
  updated_at                 timestamptz not null default now(),
  unique (commodity, program_year)
);
alter table public.arc_plc_price_data enable row level security;
create policy arc_plc_price_data_select on public.arc_plc_price_data
  for select to authenticated using (true);
create policy arc_plc_price_data_insert on public.arc_plc_price_data
  for insert to authenticated with check (private.is_platform_admin());
create policy arc_plc_price_data_update on public.arc_plc_price_data
  for update to authenticated using (private.is_platform_admin()) with check (private.is_platform_admin());
create policy arc_plc_price_data_delete on public.arc_plc_price_data
  for delete to authenticated using (private.is_platform_admin());
-- FSA-published ERPs and national benchmark prices (2025 and 2026).
insert into public.arc_plc_price_data (commodity, program_year, effective_reference_price, benchmark_price, source, note) values
  ('corn',     2025, 4.42,  5.03,  'usda', 'FSA-published ERP and benchmark price'),
  ('soybeans', 2025, 10.71, 12.17, 'usda', 'FSA-published ERP and benchmark price'),
  ('wheat',    2025, 6.35,  6.98,  'usda', 'FSA-published ERP and benchmark price'),
  ('corn',     2026, 4.42,  5.03,  'usda', 'FSA-published ERP and benchmark price'),
  ('soybeans', 2026, 10.71, 12.17, 'usda', 'FSA-published ERP and benchmark price'),
  ('wheat',    2026, 6.35,  6.98,  'usda', 'FSA-published ERP and benchmark price');

-- Confirmed monthly prices (NASS, or manual). Admin-curated.
create table public.mya_monthly_prices (
  id              uuid primary key default gen_random_uuid(),
  commodity       text not null references public.covered_commodities (slug) on delete cascade,
  marketing_year  int not null,
  month           int not null check (month between 1 and 12),
  year            int not null,
  price           numeric not null,
  unit            text,
  source          text not null default 'usda' check (source in ('usda', 'manual')),
  note            text,
  updated_at      timestamptz not null default now(),
  unique (commodity, marketing_year, month)
);
alter table public.mya_monthly_prices enable row level security;
create policy mya_monthly_prices_select on public.mya_monthly_prices
  for select to authenticated using (true);
create policy mya_monthly_prices_insert on public.mya_monthly_prices
  for insert to authenticated with check (private.is_platform_admin());
create policy mya_monthly_prices_update on public.mya_monthly_prices
  for update to authenticated using (private.is_platform_admin()) with check (private.is_platform_admin());
create policy mya_monthly_prices_delete on public.mya_monthly_prices
  for delete to authenticated using (private.is_platform_admin());

-- FSA benchmark workbook cache (section 2.3). Server-refreshed: read-all,
-- no client write policies.
create table public.fsa_benchmark_cache (
  id                 uuid primary key default gen_random_uuid(),
  data_year          int not null,
  state_code         text not null,
  county             text not null,
  commodity          text not null,
  practice           text not null default 'all' check (practice in ('irrigated', 'non_irrigated', 'all')),
  benchmark_yield    numeric,
  benchmark_price    numeric,
  benchmark_revenue  numeric,
  source_url         text,
  fetched_at         timestamptz not null default now(),
  unique (data_year, state_code, county, commodity, practice)
);
create index fsa_benchmark_cache_lookup_idx
  on public.fsa_benchmark_cache (data_year, state_code, county);
alter table public.fsa_benchmark_cache enable row level security;
create policy fsa_benchmark_cache_select on public.fsa_benchmark_cache
  for select to authenticated using (true);

create table public.fsa_benchmark_fetches (
  id              uuid primary key default gen_random_uuid(),
  requested_year  int not null,
  state_code      text not null,
  file_year       int,
  file_url        text,
  checked_at      timestamptz not null default now()
);
create index fsa_benchmark_fetches_idx
  on public.fsa_benchmark_fetches (requested_year, state_code, checked_at desc);
alter table public.fsa_benchmark_fetches enable row level security;
create policy fsa_benchmark_fetches_select on public.fsa_benchmark_fetches
  for select to authenticated using (true);
