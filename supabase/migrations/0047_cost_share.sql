-- ============================================================================
-- Turnrow Landowner: Migration 0047
-- TIMBER RECORDS, stage 3: cost-share contracts (Sec 126) and the link that
-- lets the replanting deduction (Sec 194) net them out.
--
--   * cost_share_awards: an NRCS EQIP / CSP / CRP, Alabama Forestry
--     Commission (SPB prevention), Longleaf Alliance, or other cost-share
--     contract on a property, held by an entity: contract number, dates,
--     approved dollars, practices (plain text), maintenance obligations.
--   * cost_share_payments: dollars received under an award, each with the
--     owner's tax choice: exclude it from income under Sec 126, include
--     it, or undecided. Excluded cost-share cannot also be deducted or
--     added to basis, and is recaptured if the land is sold within 20
--     years (USDA FS-1275).
--   * timber_costs.cost_share_award_id: which award helped pay a cost, so
--     the Sec 194 math (lib/reforestation.ts) subtracts the excluded part.
--   * save_stand_activity carries the new cost column.
--   * documents attach to an award (the contract, practice approvals).
-- Run after 0046.
-- ============================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------- cost_share_awards
create table public.cost_share_awards (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  property_id      uuid not null,
  entity_id        uuid,
  program          text not null default 'other' check (program in
                     ('eqip', 'csp', 'crp', 'afc_spb', 'longleaf', 'other')),
  agency           text,
  contract_number  text,
  title            text not null,
  status           text not null default 'active' check (status in
                     ('applied', 'active', 'completed', 'cancelled')),
  signed_date      date,
  end_date         date,
  approved_amount  numeric(14, 2) check (approved_amount is null or approved_amount >= 0),
  acres            numeric check (acres is null or acres >= 0),
  practices        text,
  obligations_until date,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (property_id, organization_id)
    references public.properties (id, organization_id) on delete cascade,
  foreign key (entity_id, organization_id)
    references public.entities (id, organization_id) on delete set null (entity_id)
);

alter table public.cost_share_awards enable row level security;
create policy cost_share_awards_all on public.cost_share_awards for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());
create policy cost_share_awards_entity_scope on public.cost_share_awards
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or property_id = any((select private.user_accessible_property_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or property_id = any((select private.user_accessible_property_ids())::uuid[]));

create trigger set_updated_at before update on public.cost_share_awards
  for each row execute function private.set_updated_at();
create index cost_share_awards_org_idx  on public.cost_share_awards (organization_id);
create index cost_share_awards_prop_idx on public.cost_share_awards (property_id);

create or replace function private.user_accessible_cost_share_award_ids()
returns uuid[] language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(id), '{}')
  from public.cost_share_awards
  where organization_id = private.user_org_id()
    and property_id = any(private.user_accessible_property_ids());
$$;

-- ---------------------------------------------------------------- cost_share_payments
create table public.cost_share_payments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  award_id         uuid not null,
  received_date    date not null,
  amount           numeric(14, 2) not null check (amount >= 0),
  practice         text,
  sec126_choice    text not null default 'undecided' check (sec126_choice in
                     ('exclude', 'include', 'undecided')),
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  foreign key (award_id, organization_id)
    references public.cost_share_awards (id, organization_id) on delete cascade
);

alter table public.cost_share_payments enable row level security;
create policy cost_share_payments_all on public.cost_share_payments for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());
create policy cost_share_payments_entity_scope on public.cost_share_payments
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or award_id = any((select private.user_accessible_cost_share_award_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or award_id = any((select private.user_accessible_cost_share_award_ids())::uuid[]));

create trigger set_updated_at before update on public.cost_share_payments
  for each row execute function private.set_updated_at();
create index cost_share_payments_org_idx   on public.cost_share_payments (organization_id);
create index cost_share_payments_award_idx on public.cost_share_payments (award_id);

-- ---------------------------------------------------------------- timber_costs link
alter table public.timber_costs add column cost_share_award_id uuid;
alter table public.timber_costs add constraint timber_costs_cost_share_fk
  foreign key (cost_share_award_id, organization_id)
  references public.cost_share_awards (id, organization_id)
  on delete set null (cost_share_award_id);
create index timber_costs_award_idx on public.timber_costs (cost_share_award_id);

-- ---------------------------------------------------------------- save_stand_activity
-- Same function as 0045 plus costs[].cost_share_award_id.
create or replace function public.save_stand_activity(p jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_org uuid := private.user_org_id();
  v_id  uuid := nullif(p->>'id', '')::uuid;
  v_property uuid := (p->>'property_id')::uuid;
  v_keep uuid[];
  c jsonb;
begin
  if v_org is null then
    raise exception 'Not signed in to an organization';
  end if;

  if v_id is null then
    insert into public.stand_activities (
      organization_id, property_id, activity_type, status, activity_year,
      activity_date, title, notes, performed_by, acres_treated,
      timber_sale_id, plan_key, details)
    values (
      v_org, v_property, p->>'activity_type', coalesce(p->>'status', 'done'),
      (p->>'activity_year')::int, nullif(p->>'activity_date', '')::date,
      nullif(p->>'title', ''), nullif(p->>'notes', ''), nullif(p->>'performed_by', ''),
      nullif(p->>'acres_treated', '')::numeric, nullif(p->>'timber_sale_id', '')::uuid,
      nullif(p->>'plan_key', ''), coalesce(p->'details', '{}'::jsonb))
    returning id into v_id;
  else
    update public.stand_activities set
      property_id    = v_property,
      activity_type  = p->>'activity_type',
      status         = coalesce(p->>'status', 'done'),
      activity_year  = (p->>'activity_year')::int,
      activity_date  = nullif(p->>'activity_date', '')::date,
      title          = nullif(p->>'title', ''),
      notes          = nullif(p->>'notes', ''),
      performed_by   = nullif(p->>'performed_by', ''),
      acres_treated  = nullif(p->>'acres_treated', '')::numeric,
      timber_sale_id = nullif(p->>'timber_sale_id', '')::uuid,
      plan_key       = nullif(p->>'plan_key', ''),
      details        = coalesce(p->'details', '{}'::jsonb)
    where id = v_id;
    if not found then
      raise exception 'Activity not found';
    end if;
  end if;

  delete from public.stand_activity_stands where activity_id = v_id;
  insert into public.stand_activity_stands (organization_id, activity_id, timber_stand_id, acres)
  select v_org, v_id, (s->>'timber_stand_id')::uuid, nullif(s->>'acres', '')::numeric
  from jsonb_array_elements(coalesce(p->'stands', '[]'::jsonb)) s;

  select coalesce(array_agg((x->>'id')::uuid), '{}')
    into v_keep
  from jsonb_array_elements(coalesce(p->'costs', '[]'::jsonb)) x
  where nullif(x->>'id', '') is not null;

  delete from public.timber_costs
  where activity_id = v_id and not (id = any(v_keep));

  for c in select * from jsonb_array_elements(coalesce(p->'costs', '[]'::jsonb)) loop
    if nullif(c->>'id', '') is null then
      insert into public.timber_costs (
        organization_id, property_id, activity_id, timber_sale_id, paid_date,
        amount, vendor, description, tax_category, notes, cost_share_award_id)
      values (
        v_org, v_property, v_id, nullif(p->>'timber_sale_id', '')::uuid,
        (c->>'paid_date')::date, (c->>'amount')::numeric,
        nullif(c->>'vendor', ''), nullif(c->>'description', ''),
        coalesce(nullif(c->>'tax_category', ''), 'not_sure'), nullif(c->>'notes', ''),
        nullif(c->>'cost_share_award_id', '')::uuid);
    else
      update public.timber_costs set
        property_id    = v_property,
        timber_sale_id = nullif(p->>'timber_sale_id', '')::uuid,
        paid_date      = (c->>'paid_date')::date,
        amount         = (c->>'amount')::numeric,
        vendor         = nullif(c->>'vendor', ''),
        description    = nullif(c->>'description', ''),
        tax_category   = coalesce(nullif(c->>'tax_category', ''), 'not_sure'),
        notes          = nullif(c->>'notes', ''),
        cost_share_award_id = nullif(c->>'cost_share_award_id', '')::uuid
      where id = (c->>'id')::uuid and activity_id = v_id;
      if not found then
        raise exception 'Cost not found on this activity';
      end if;
    end if;
  end loop;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------- documents
alter table public.documents drop constraint documents_entity_type_check;
alter table public.documents add constraint documents_entity_type_check
  check (entity_type in ('property', 'parcel', 'field', 'pasture', 'wetland',
                         'pollinator_habitat',
                         'easement', 'cemetery', 'maintenance_issue',
                         'timber_stand', 'stand_activity', 'timber_account',
                         'cost_share_award',
                         'road', 'asset', 'entity',
                         'tenant', 'lease', 'timber_sale', 'tax_statement',
                         'organization'));

-- Same function as 0046 plus the cost_share_award branch.
create or replace function private.can_access_attachment(etype text, eid uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select case etype
    when 'property' then eid = any(private.user_accessible_property_ids())
    when 'parcel'   then eid = any(private.user_accessible_parcel_ids())
    when 'field'    then eid = any(private.user_accessible_field_ids())
    when 'timber_stand' then eid = any(private.user_accessible_stand_ids())
    when 'timber_account' then eid = any(private.user_accessible_timber_account_ids())
    when 'cost_share_award' then eid = any(private.user_accessible_cost_share_award_ids())
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
