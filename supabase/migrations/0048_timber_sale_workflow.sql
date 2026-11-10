-- ============================================================================
-- Turnrow Landowner: Migration 0048
-- TIMBER RECORDS, stage 4: the sale from planning to after the harvest.
--
--   * timber_sales gains the steps around the contract: stage (planning,
--     cruise, marketing, contract, harvesting, closeout, complete; null =
--     worked out from the old status), the consulting forester and fee,
--     the minimum acceptable bid and bid opening date, harvest start and
--     end, closeout and deposit-returned dates, the replanting due date
--     for a clearcut, the 1099-S (received, amount), and a checklist jsonb
--     (item key -> yes | no | na; the items live in lib/timberSaleSteps.ts,
--     like product classes).
--   * timber_sale_bids: the sealed bids received (bidder, amount, date,
--     winner), entity-scoped through the sale.
-- Sources: ACES FOR-2101 "How Timber Is Sold", AFC timber sale contract
-- considerations, ACES BMP guidelines (docs/research/2026-11-09).
-- Run after 0047.
-- ============================================================================

set search_path = public, extensions;

alter table public.timber_sales
  add column if not exists stage text check (stage is null or stage in
    ('planning', 'cruise', 'marketing', 'contract', 'harvesting', 'closeout', 'complete')),
  add column if not exists forester_name text,
  add column if not exists forester_fee_pct numeric check (forester_fee_pct is null or (forester_fee_pct >= 0 and forester_fee_pct <= 100)),
  add column if not exists min_bid numeric(14, 2) check (min_bid is null or min_bid >= 0),
  add column if not exists bid_date date,
  add column if not exists harvest_start date,
  add column if not exists harvest_end date,
  add column if not exists closeout_date date,
  add column if not exists deposit_returned_date date,
  add column if not exists reforestation_due date,
  add column if not exists form_1099s_received boolean not null default false,
  add column if not exists form_1099s_amount numeric(14, 2) check (form_1099s_amount is null or form_1099s_amount >= 0),
  add column if not exists checklist jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------- timber_sale_bids
create table public.timber_sale_bids (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  timber_sale_id   uuid not null,
  bidder           text not null,
  amount           numeric(14, 2) not null check (amount >= 0),
  received_date    date,
  is_winner        boolean not null default false,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  foreign key (timber_sale_id, organization_id)
    references public.timber_sales (id, organization_id) on delete cascade
);

alter table public.timber_sale_bids enable row level security;
create policy timber_sale_bids_all on public.timber_sale_bids for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());
create policy timber_sale_bids_entity_scope on public.timber_sale_bids
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or timber_sale_id = any((select private.user_accessible_timber_sale_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or timber_sale_id = any((select private.user_accessible_timber_sale_ids())::uuid[]));

create trigger set_updated_at before update on public.timber_sale_bids
  for each row execute function private.set_updated_at();
create index timber_sale_bids_org_idx  on public.timber_sale_bids (organization_id);
create index timber_sale_bids_sale_idx on public.timber_sale_bids (timber_sale_id);
