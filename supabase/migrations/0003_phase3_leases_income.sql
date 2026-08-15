-- ============================================================================
-- Turnrow Landowner: Migration 0003, Phase 3
-- Tenants, leases (agricultural + hunting), expected/actual payments,
-- timber sale contracts, settlements. Run after 0002.
-- ============================================================================

set search_path = public, extensions;

-- Composite-FK targets needed by the new join tables.
alter table public.timber_stands add unique (id, organization_id);
alter table public.fields add unique (id, organization_id);

-- ============================================================================
-- 1. TENANTS (the counterparties; one tenant can hold many leases)
-- ============================================================================

create table public.tenants (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  name               text not null,           -- person or entity
  contact_person     text,
  phone              text,
  email              text,
  mailing_address    text,
  insurance_on_file  boolean not null default false,
  insurance_expires  date,                    -- matters most for hunting leases
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (id, organization_id)
);

-- ============================================================================
-- 2. LEASES (agricultural and hunting in one table with a type system)
--    Rent-structure-specific terms live in the "terms" jsonb, validated by
--    the app against lib/leaseTerms.ts (same pattern as assets.details):
--      cash:       { cash_basis: 'per_acre'|'lump_sum', rate_per_acre, lump_sum }
--      flex:       { base_rate_per_acre, bonus_description }
--      crop_share: { landowner_share_pct, shares_expenses, expense_share_pct }
--      hunting:    { hunt_basis: 'lump_sum'|'per_acre', amount, rate_per_acre,
--                    insurance_required }
--    payment_schedule jsonb: 1 to 4 entries like
--      [{ "label": "First half", "month": 3, "day": 1, "percent": 50 },
--       { "label": "Second half", "month": 12, "day": 1, "percent": 50 }]
--    (an entry may use "amount" instead of "percent")
-- ============================================================================

create table public.leases (
  id                        uuid primary key default gen_random_uuid(),
  organization_id           uuid not null references public.organizations (id) on delete cascade,
  tenant_id                 uuid not null,
  lease_type                text not null check (lease_type in ('agricultural', 'hunting')),
  name                      text not null,
  status                    text not null default 'draft'
                              check (status in ('draft', 'active', 'expired', 'terminated')),
  start_date                date,
  end_date                  date,
  auto_renew                boolean not null default false,
  termination_notice_days   integer,
  rent_structure            text check (rent_structure in ('cash', 'flex', 'crop_share')),
                            -- null for hunting leases
  terms                     jsonb not null default '{}',
  payment_schedule          jsonb not null default '[]',
  special_provisions        text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (tenant_id, organization_id)
    references public.tenants (id, organization_id) on delete restrict
);

-- Land under lease: one or more properties, optionally narrowed to specific
-- fields. leased_acres defaults from the computed GIS acres but is editable
-- (contract acres often differ slightly).
create table public.lease_lands (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  lease_id         uuid not null,
  property_id      uuid not null,
  field_id         uuid,
  leased_acres     numeric(12, 2) not null default 0,
  created_at       timestamptz not null default now(),
  foreign key (lease_id, organization_id)
    references public.leases (id, organization_id) on delete cascade,
  foreign key (property_id, organization_id)
    references public.properties (id, organization_id) on delete cascade,
  foreign key (field_id, organization_id)
    references public.fields (id, organization_id) on delete cascade,
  unique nulls not distinct (lease_id, property_id, field_id)
);

-- Per-year projection assumptions the user enters (never computed by AI):
--   flex:       { bonus_estimate }
--   crop_share: { crop, acres, expected_yield, expected_price,
--                 expected_shared_expenses }
create table public.lease_year_assumptions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  lease_id         uuid not null,
  year             integer not null,
  data             jsonb not null default '{}',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  foreign key (lease_id, organization_id)
    references public.leases (id, organization_id) on delete cascade,
  unique (lease_id, year)
);

-- ============================================================================
-- 3. TIMBER SALE CONTRACTS
--    stumpage_rates jsonb (pay_as_cut): [{ "product": "pine_sawtimber",
--      "label": "Pine sawtimber", "price_per_ton": 28.50 }, ...]
--    payment_schedule jsonb (split lump sums): [{ "label", "due_date",
--      "amount" }]
-- ============================================================================

create table public.timber_sales (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations (id) on delete cascade,
  sale_name            text not null,
  buyer_name           text,               -- buyers are often one-off
  buyer_tenant_id      uuid,               -- optional link to a tenants row
  sale_type            text not null check (sale_type in ('lump_sum', 'pay_as_cut')),
  status               text not null default 'active'
                         check (status in ('active', 'completed', 'expired')),
  contract_date        date,
  harvest_deadline     date,
  performance_deposit  numeric(14, 2),
  sale_acres           numeric(12, 2),     -- contract acres, editable
  lump_sum_price       numeric(14, 2),     -- lump_sum sales only
  stumpage_rates       jsonb not null default '[]',  -- pay_as_cut sales only
  payment_schedule     jsonb not null default '[]',
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (buyer_tenant_id, organization_id)
    references public.tenants (id, organization_id) on delete set null
);

create table public.timber_sale_stands (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  timber_sale_id   uuid not null,
  timber_stand_id  uuid not null,
  created_at       timestamptz not null default now(),
  foreign key (timber_sale_id, organization_id)
    references public.timber_sales (id, organization_id) on delete cascade,
  foreign key (timber_stand_id, organization_id)
    references public.timber_stands (id, organization_id) on delete cascade,
  unique (timber_sale_id, timber_stand_id)
);

-- Pay-as-cut settlements: tons by product at contract rates.
--   lines jsonb: [{ "product", "label", "tons", "price_per_ton", "amount" }]
--   total_amount is stored for fast income rollups and equals the sum of
--   the line amounts (the app computes and writes both together).
create table public.timber_settlements (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  timber_sale_id   uuid not null,
  settlement_date  date not null,
  lines            jsonb not null default '[]',
  total_amount     numeric(14, 2) not null default 0,
  check_number     text,
  memo             text,
  created_at       timestamptz not null default now(),
  foreign key (timber_sale_id, organization_id)
    references public.timber_sales (id, organization_id) on delete cascade
);

-- ============================================================================
-- 4. EXPECTED PAYMENTS AND ACTUAL PAYMENTS
--    expected_payments are generated by the app from an active lease's terms
--    and schedule (or a timber sale's schedule). Regeneration never touches
--    rows that already have payments recorded against them.
-- ============================================================================

create table public.expected_payments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  lease_id         uuid,
  timber_sale_id   uuid,
  year             integer not null,
  label            text not null default '',
  due_date         date not null,
  expected_amount  numeric(14, 2) not null,
  created_at       timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (lease_id, organization_id)
    references public.leases (id, organization_id) on delete cascade,
  foreign key (timber_sale_id, organization_id)
    references public.timber_sales (id, organization_id) on delete cascade,
  check (num_nonnulls(lease_id, timber_sale_id) = 1)
);

create table public.payments (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations (id) on delete cascade,
  lease_id             uuid,
  timber_sale_id       uuid,
  expected_payment_id  uuid,   -- null for unscheduled/extra payments
  received_date        date not null,
  amount               numeric(14, 2) not null,
  method               text,   -- e.g. "check #1042", "wire"
  memo                 text,
  created_at           timestamptz not null default now(),
  foreign key (lease_id, organization_id)
    references public.leases (id, organization_id) on delete cascade,
  foreign key (timber_sale_id, organization_id)
    references public.timber_sales (id, organization_id) on delete cascade,
  foreign key (expected_payment_id, organization_id)
    references public.expected_payments (id, organization_id) on delete set null,
  check (num_nonnulls(lease_id, timber_sale_id) = 1)
);

-- Documents (and photos) now attach to tenants, leases, and timber sales.
alter table public.documents drop constraint documents_entity_type_check;
alter table public.documents add constraint documents_entity_type_check
  check (entity_type in ('property', 'parcel', 'field', 'timber_stand',
                         'road', 'asset', 'tenant', 'lease', 'timber_sale'));

-- ============================================================================
-- 5. updated_at triggers + indexes
-- ============================================================================

create trigger set_updated_at before update on public.tenants
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.leases
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.lease_year_assumptions
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.timber_sales
  for each row execute function private.set_updated_at();

create index tenants_org_idx            on public.tenants (organization_id);
create index leases_org_idx             on public.leases (organization_id);
create index leases_tenant_idx          on public.leases (tenant_id);
create index leases_status_idx          on public.leases (status);
create index lease_lands_org_idx        on public.lease_lands (organization_id);
create index lease_lands_lease_idx      on public.lease_lands (lease_id);
create index lease_lands_property_idx   on public.lease_lands (property_id);
create index lease_year_assumptions_lease_idx
  on public.lease_year_assumptions (lease_id);
create index timber_sales_org_idx       on public.timber_sales (organization_id);
create index timber_sale_stands_sale_idx on public.timber_sale_stands (timber_sale_id);
create index timber_settlements_sale_idx on public.timber_settlements (timber_sale_id);
create index timber_settlements_org_idx  on public.timber_settlements (organization_id);
create index expected_payments_org_idx  on public.expected_payments (organization_id);
create index expected_payments_lease_idx on public.expected_payments (lease_id);
create index expected_payments_sale_idx on public.expected_payments (timber_sale_id);
create index expected_payments_due_idx  on public.expected_payments (due_date);
create index payments_org_idx           on public.payments (organization_id);
create index payments_lease_idx         on public.payments (lease_id);
create index payments_sale_idx          on public.payments (timber_sale_id);
create index payments_expected_idx      on public.payments (expected_payment_id);

-- ============================================================================
-- 6. ROW LEVEL SECURITY (same pattern as Phases 1 and 2)
-- ============================================================================

alter table public.tenants                enable row level security;
alter table public.leases                 enable row level security;
alter table public.lease_lands            enable row level security;
alter table public.lease_year_assumptions enable row level security;
alter table public.timber_sales           enable row level security;
alter table public.timber_sale_stands     enable row level security;
alter table public.timber_settlements     enable row level security;
alter table public.expected_payments      enable row level security;
alter table public.payments               enable row level security;

create policy tenants_all on public.tenants for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());
create policy leases_all on public.leases for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());
create policy lease_lands_all on public.lease_lands for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());
create policy lease_year_assumptions_all on public.lease_year_assumptions
  for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());
create policy timber_sales_all on public.timber_sales for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());
create policy timber_sale_stands_all on public.timber_sale_stands
  for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());
create policy timber_settlements_all on public.timber_settlements
  for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());
create policy expected_payments_all on public.expected_payments
  for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());
create policy payments_all on public.payments for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());
