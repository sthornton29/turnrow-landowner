-- ============================================================================
-- Turnrow Landowner: Migration 0012
-- Lease price methods: RMA benchmark cache (global, public data) and
-- tenant price/yield caches (per connection, synced like farm_field_data).
-- price_method itself lives in leases.terms jsonb (no schema change).
-- Run after 0011.
-- ============================================================================

set search_path = public, extensions;

-- RMA price discovery cache: GLOBAL like county_gis_services (public CC0
-- data, identical for every org). All authenticated users read; ONLY the
-- server refresh route writes, using the service role (no write policies).
create table public.rma_price_cache (
  id              uuid primary key default gen_random_uuid(),
  crop            text not null,       -- app crop key, lowercase
  state           text not null,       -- 2-letter
  commodity_year  integer not null,
  data            jsonb not null,      -- parsed offer: prices, statuses, windows, base contracts, or no_offer
  fetched_at      timestamptz not null default now(),
  unique (crop, state, commodity_year)
);
alter table public.rma_price_cache enable row level security;
create policy rma_price_cache_read on public.rma_price_cache
  for select to authenticated using (true);

-- Tenant's projected average price per crop (partner /marketing-prices,
-- scope projected_prices). One aggregate number per crop by design.
create table public.farm_marketing_prices (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations (id) on delete cascade,
  farm_connection_id   uuid not null,
  crop_year            integer not null,
  crop                 text not null,
  projected_avg_price  numeric(12, 4),
  unit                 text,               -- usd_per_bu | cents_per_lb
  is_final             boolean not null default false,
  as_of                timestamptz,
  synced_at            timestamptz not null default now(),
  foreign key (farm_connection_id, organization_id)
    references public.farm_connections (id, organization_id) on delete cascade,
  unique (farm_connection_id, crop_year, crop)
);
create index farm_marketing_prices_org_idx on public.farm_marketing_prices (organization_id);
alter table public.farm_marketing_prices enable row level security;
create policy farm_marketing_prices_all on public.farm_marketing_prices for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());

-- Tenant's projected yields per shared field x crop (partner
-- /projected-yields, scope projected_yields). basis flips to actual once
-- harvest data replaces the expectation.
create table public.farm_projected_yields (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  farm_connection_id  uuid not null,
  remote_field_id     text not null,
  crop_year           integer not null,
  crop                text not null,
  planted_acres       numeric(12, 2),
  yield_per_acre      numeric(12, 2),
  unit                text,               -- bu_per_ac | lbs_per_ac
  basis               text,               -- expected | actual
  practices           jsonb,
  synced_at           timestamptz not null default now(),
  foreign key (farm_connection_id, organization_id)
    references public.farm_connections (id, organization_id) on delete cascade,
  unique (farm_connection_id, remote_field_id, crop_year, crop)
);
create index farm_projected_yields_org_idx on public.farm_projected_yields (organization_id);
alter table public.farm_projected_yields enable row level security;
create policy farm_projected_yields_all on public.farm_projected_yields for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());
