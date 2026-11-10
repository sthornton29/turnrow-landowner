-- ============================================================================
-- Turnrow Landowner: Migration 0046
-- TIMBER RECORDS, stage 2: timber basis and depletion.
--
-- When timber is sold, the owner is taxed on the proceeds minus selling
-- expenses minus the DEPLETION ALLOWANCE: the part of their cost (basis)
-- in the timber that was cut. Without a basis record the IRS presumes
-- zero. (USDA FS-1275 Tax Tips for Forest Landowners; research in
-- docs/research/2026-11-09/research-timber.md, M2.)
--
--   * timber_accounts: one per tract (usually one per property), held by
--     an owner entity. Set up once by a short interview: how the land was
--     acquired (purchase, inheritance = stepped-up value at death, gift =
--     donor's basis carries over, transfer into an entity, unknown),
--     when, the total cost or value, and the split among land, timber,
--     and improvements with its source (closing statement, cruise,
--     appraisal, estate appraisal, retroactive appraisal, estimate).
--   * timber_account_products: the opening timber basis and volume per
--     product (pine sawtimber tons...), or one 'all_timber' pool when no
--     product split exists. Volume may be unknown (null): depletion then
--     goes by share ("about half the timber was cut").
--   * timber_account_entries: the ledger. Depletion from a sale (negative
--     volume and basis), capitalized costs added to basis, volume
--     adjustments (a re-cruise, growth), casualty losses, other. Adjusted
--     basis, volume, and the depletion unit ($ per ton) are SUMS computed
--     in lib/timberBasis.ts; nothing derived is stored.
--   * Entity scoping: accounts through their property; products and
--     entries through their account (private.user_accessible_timber_account_ids).
-- Run after 0045.
-- ============================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------- timber_accounts
create table public.timber_accounts (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  property_id        uuid not null,
  entity_id          uuid,
  name               text not null,
  acquisition_type   text not null default 'unknown' check (acquisition_type in
                       ('purchase', 'inheritance', 'gift', 'transfer', 'unknown')),
  acquired_date      date,
  total_value        numeric(14, 2) check (total_value is null or total_value >= 0),
  land_value         numeric(14, 2) check (land_value is null or land_value >= 0),
  timber_value       numeric(14, 2) check (timber_value is null or timber_value >= 0),
  improvements_value numeric(14, 2) check (improvements_value is null or improvements_value >= 0),
  basis_source       text not null default 'unknown' check (basis_source in
                       ('closing_statement', 'timber_cruise', 'appraisal', 'estate_appraisal',
                        'retroactive_appraisal', 'estimate', 'unknown')),
  acres_covered      numeric check (acres_covered is null or acres_covered >= 0),
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (property_id, organization_id)
    references public.properties (id, organization_id) on delete cascade,
  foreign key (entity_id, organization_id)
    references public.entities (id, organization_id) on delete set null (entity_id)
);

alter table public.timber_accounts enable row level security;
create policy timber_accounts_all on public.timber_accounts for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());
create policy timber_accounts_entity_scope on public.timber_accounts
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or property_id = any((select private.user_accessible_property_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or property_id = any((select private.user_accessible_property_ids())::uuid[]));

create trigger set_updated_at before update on public.timber_accounts
  for each row execute function private.set_updated_at();
create index timber_accounts_org_idx  on public.timber_accounts (organization_id);
create index timber_accounts_prop_idx on public.timber_accounts (property_id);

-- Accounts a user-role member may reach (through the property), for the
-- child tables' policies. Same shape as the 0034 helpers.
create or replace function private.user_accessible_timber_account_ids()
returns uuid[] language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(id), '{}')
  from public.timber_accounts
  where organization_id = private.user_org_id()
    and property_id = any(private.user_accessible_property_ids());
$$;

-- ---------------------------------------------------------------- timber_account_products
create table public.timber_account_products (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  account_id       uuid not null,
  product          text not null,      -- TIMBER_PRODUCTS slug, or 'all_timber'
  unit             text not null default 'ton' check (unit in ('ton', 'mbf')),
  opening_volume   numeric check (opening_volume is null or opening_volume >= 0),
  opening_basis    numeric(14, 2) not null default 0 check (opening_basis >= 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (account_id, product),
  foreign key (account_id, organization_id)
    references public.timber_accounts (id, organization_id) on delete cascade
);

alter table public.timber_account_products enable row level security;
create policy timber_account_products_all on public.timber_account_products for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());
create policy timber_account_products_entity_scope on public.timber_account_products
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or account_id = any((select private.user_accessible_timber_account_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or account_id = any((select private.user_accessible_timber_account_ids())::uuid[]));

create trigger set_updated_at before update on public.timber_account_products
  for each row execute function private.set_updated_at();
create index timber_account_products_org_idx     on public.timber_account_products (organization_id);
create index timber_account_products_account_idx on public.timber_account_products (account_id);

-- ---------------------------------------------------------------- timber_account_entries
create table public.timber_account_entries (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  account_id       uuid not null,
  entry_date       date not null,
  entry_type       text not null check (entry_type in
                     ('depletion', 'capitalized_cost', 'volume_adjustment', 'casualty_loss', 'other')),
  product          text,               -- null = the whole account
  volume_change    numeric not null default 0,
  basis_change     numeric(14, 2) not null default 0,
  timber_sale_id   uuid,
  cost_id          uuid,
  memo             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  foreign key (account_id, organization_id)
    references public.timber_accounts (id, organization_id) on delete cascade,
  foreign key (timber_sale_id, organization_id)
    references public.timber_sales (id, organization_id) on delete set null (timber_sale_id),
  foreign key (cost_id, organization_id)
    references public.timber_costs (id, organization_id) on delete set null (cost_id)
);

alter table public.timber_account_entries enable row level security;
create policy timber_account_entries_all on public.timber_account_entries for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());
create policy timber_account_entries_entity_scope on public.timber_account_entries
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or account_id = any((select private.user_accessible_timber_account_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or account_id = any((select private.user_accessible_timber_account_ids())::uuid[]));

create trigger set_updated_at before update on public.timber_account_entries
  for each row execute function private.set_updated_at();
create index timber_account_entries_org_idx     on public.timber_account_entries (organization_id);
create index timber_account_entries_account_idx on public.timber_account_entries (account_id);
create index timber_account_entries_sale_idx    on public.timber_account_entries (timber_sale_id);

-- ---------------------------------------------------------------- documents
-- Basis evidence (closing statement, estate appraisal, cruise) attaches
-- to the account.
alter table public.documents drop constraint documents_entity_type_check;
alter table public.documents add constraint documents_entity_type_check
  check (entity_type in ('property', 'parcel', 'field', 'pasture', 'wetland',
                         'pollinator_habitat',
                         'easement', 'cemetery', 'maintenance_issue',
                         'timber_stand', 'stand_activity', 'timber_account',
                         'road', 'asset', 'entity',
                         'tenant', 'lease', 'timber_sale', 'tax_statement',
                         'organization'));

-- Same function as 0045 plus the timber_account branch.
create or replace function private.can_access_attachment(etype text, eid uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select case etype
    when 'property' then eid = any(private.user_accessible_property_ids())
    when 'parcel'   then eid = any(private.user_accessible_parcel_ids())
    when 'field'    then eid = any(private.user_accessible_field_ids())
    when 'timber_stand' then eid = any(private.user_accessible_stand_ids())
    when 'timber_account' then eid = any(private.user_accessible_timber_account_ids())
    when 'entity'   then eid = any(private.user_entity_ids())
    when 'lease'    then eid = any(private.user_accessible_lease_ids())
    when 'timber_sale' then eid = any(private.user_accessible_timber_sale_ids())
    when 'tax_statement' then eid = any(private.user_accessible_tax_statement_ids())
    when 'stand_activity' then exists (select 1 from public.stand_activities x
      where x.id = eid
      and x.property_id = any(private.user_accessible_property_ids()))
    when 'pasture' then exists (select 1 from public.pastures x where x.id = eid
      and x.property_id = any(private.user_accessible_property_ids()))
    when 'wetland' then exists (select 1 from public.wetlands x where x.id = eid
      and x.property_id = any(private.user_accessible_property_ids()))
    when 'pollinator_habitat' then exists (select 1 from public.pollinator_habitats x
      where x.id = eid
      and x.property_id = any(private.user_accessible_property_ids()))
    when 'road' then exists (select 1 from public.roads x where x.id = eid
      and x.property_id = any(private.user_accessible_property_ids()))
    when 'cemetery' then exists (select 1 from public.cemeteries x where x.id = eid
      and x.property_id = any(private.user_accessible_property_ids()))
    when 'asset' then exists (select 1 from public.assets x where x.id = eid
      and x.property_id = any(private.user_accessible_property_ids()))
    when 'easement' then exists (select 1 from public.easements x where x.id = eid
      and x.property_id = any(private.user_accessible_property_ids()))
    when 'maintenance_issue' then exists (select 1 from public.maintenance_issues x
      where x.id = eid
      and x.property_id = any(private.user_accessible_property_ids()))
    -- tenant documents and org-level Unfiled documents are admin-only
    else false
  end;
$$;
