-- ============================================================================
-- Turnrow Landowner: Migration 0045
-- TIMBER RECORDS, stage 1: what happened on each stand, and what it cost.
--
--   * timber_stands gains the facts a forester asks for first: trees
--     per acre planted, the site index base age (25 or 50), and the
--     management goal. year_established stays the planting / origin year.
--   * stand_activities: a dated history per stand (site prep, planting,
--     spraying, burns, thinnings, harvests, inspections, damage...).
--     status planned | done | skipped, so the same table holds history,
--     scheduled work, and "not needed" answers to the app's schedule
--     (plan_key ties a row to a schedule recommendation, lib/timberPlan.ts).
--     activity_year is required; activity_date is optional (families
--     often know only "we burned it in 2019"). Type-specific facts live
--     in details jsonb, validated in lib/standActivities.ts.
--   * stand_activity_stands: one activity can cover several stands of
--     the same property (one burn, several units), with acres in each.
--   * timber_costs: money spent, each with a tax_category set from one
--     plain question (reforestation, operating, selling, lasting
--     improvement, not sure). Usually tied to an activity; can stand
--     alone at property level. Feeds the Sec 194 replanting deduction,
--     timber basis, and the annual timber tax summary in later stages.
--   * save_stand_activity(jsonb): ONE call writes the activity, its
--     stands, and its costs together (no half-saved records). SECURITY
--     INVOKER, so every row still passes RLS.
--   * documents can attach to an activity (invoices, burn permits,
--     prescriptions), reachable through the activity's property.
-- Run after 0044; safely re-runnable is NOT a goal (create table).
-- ============================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------- timber_stands
alter table public.timber_stands
  add column if not exists tpa_planted integer check (tpa_planted is null or tpa_planted between 1 and 5000),
  add column if not exists site_index_base_age integer check (site_index_base_age is null or site_index_base_age in (25, 50)),
  add column if not exists management_goal text check (management_goal is null or management_goal in
    ('timber', 'wildlife', 'mixed', 'aesthetics', 'conservation'));

-- Same leading columns as 0002; new columns appended (create or replace
-- view only allows additions at the end).
create or replace view public.timber_stands_geo with (security_invoker = true) as
select id, organization_id, property_id, name, stand_type, species,
       year_established, site_index, last_thinning_year, last_burn_year,
       notes, acres, st_asgeojson(boundary)::json as boundary_geojson,
       created_at, updated_at,
       tpa_planted, site_index_base_age, management_goal
from public.timber_stands;
grant select on public.timber_stands_geo to authenticated;

-- ---------------------------------------------------------------- stand_activities
create table public.stand_activities (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  property_id      uuid not null,
  activity_type    text not null check (activity_type in
                     ('site_prep', 'planting', 'herbicide', 'precommercial_thin',
                      'thinning', 'harvest', 'prescribed_burn', 'fertilization',
                      'firebreak', 'road_work', 'boundary_marking', 'inspection',
                      'damage', 'cruise', 'other')),
  status           text not null default 'done' check (status in ('planned', 'done', 'skipped')),
  activity_year    integer not null check (activity_year between 1900 and 2200),
  activity_date    date,
  title            text,
  notes            text,
  performed_by     text,             -- vendor, forester, or "family"
  acres_treated    numeric check (acres_treated is null or acres_treated >= 0),
  timber_sale_id   uuid,
  plan_key         text,             -- schedule recommendation this answers (lib/timberPlan.ts)
  details          jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (property_id, organization_id)
    references public.properties (id, organization_id) on delete cascade,
  foreign key (timber_sale_id, organization_id)
    references public.timber_sales (id, organization_id) on delete set null (timber_sale_id)
);

alter table public.stand_activities enable row level security;
create policy stand_activities_all on public.stand_activities for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());
create policy stand_activities_entity_scope on public.stand_activities
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or property_id = any((select private.user_accessible_property_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or property_id = any((select private.user_accessible_property_ids())::uuid[]));

create trigger set_updated_at before update on public.stand_activities
  for each row execute function private.set_updated_at();
create index stand_activities_org_idx  on public.stand_activities (organization_id);
create index stand_activities_prop_idx on public.stand_activities (property_id);
create index stand_activities_sale_idx on public.stand_activities (timber_sale_id);

-- ---------------------------------------------------------------- stand_activity_stands
create table public.stand_activity_stands (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  activity_id       uuid not null,
  timber_stand_id   uuid not null,
  acres             numeric check (acres is null or acres >= 0),
  created_at        timestamptz not null default now(),
  unique (activity_id, timber_stand_id),
  foreign key (activity_id, organization_id)
    references public.stand_activities (id, organization_id) on delete cascade,
  foreign key (timber_stand_id, organization_id)
    references public.timber_stands (id, organization_id) on delete cascade
);

alter table public.stand_activity_stands enable row level security;
create policy stand_activity_stands_all on public.stand_activity_stands for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());
create policy stand_activity_stands_entity_scope on public.stand_activity_stands
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or timber_stand_id = any((select private.user_accessible_stand_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or timber_stand_id = any((select private.user_accessible_stand_ids())::uuid[]));

create index stand_activity_stands_org_idx      on public.stand_activity_stands (organization_id);
create index stand_activity_stands_activity_idx on public.stand_activity_stands (activity_id);
create index stand_activity_stands_stand_idx    on public.stand_activity_stands (timber_stand_id);

-- ---------------------------------------------------------------- timber_costs
create table public.timber_costs (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  property_id      uuid not null,
  activity_id      uuid,
  timber_sale_id   uuid,
  paid_date        date not null,
  amount           numeric(12, 2) not null check (amount >= 0),
  vendor           text,
  description      text,
  tax_category     text not null default 'not_sure' check (tax_category in
                     ('reforestation', 'operating_expense', 'selling_expense',
                      'capital_improvement', 'not_sure')),
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (property_id, organization_id)
    references public.properties (id, organization_id) on delete cascade,
  foreign key (activity_id, organization_id)
    references public.stand_activities (id, organization_id) on delete cascade,
  foreign key (timber_sale_id, organization_id)
    references public.timber_sales (id, organization_id) on delete set null (timber_sale_id)
);

alter table public.timber_costs enable row level security;
create policy timber_costs_all on public.timber_costs for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());
create policy timber_costs_entity_scope on public.timber_costs
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or property_id = any((select private.user_accessible_property_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or property_id = any((select private.user_accessible_property_ids())::uuid[]));

create trigger set_updated_at before update on public.timber_costs
  for each row execute function private.set_updated_at();
create index timber_costs_org_idx      on public.timber_costs (organization_id);
create index timber_costs_prop_idx     on public.timber_costs (property_id);
create index timber_costs_activity_idx on public.timber_costs (activity_id);
create index timber_costs_sale_idx     on public.timber_costs (timber_sale_id);

-- ---------------------------------------------------------------- save_stand_activity
-- Payload:
--   { id?, property_id, activity_type, status, activity_year, activity_date?,
--     title?, notes?, performed_by?, acres_treated?, timber_sale_id?,
--     plan_key?, details?,
--     stands: [{ timber_stand_id, acres? }],
--     costs:  [{ id?, paid_date, amount, vendor?, description?, tax_category, notes? }] }
-- Stands are replaced; costs are upserted by id and any cost of this
-- activity missing from the payload is deleted. Returns the activity id.
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
        amount, vendor, description, tax_category, notes)
      values (
        v_org, v_property, v_id, nullif(p->>'timber_sale_id', '')::uuid,
        (c->>'paid_date')::date, (c->>'amount')::numeric,
        nullif(c->>'vendor', ''), nullif(c->>'description', ''),
        coalesce(nullif(c->>'tax_category', ''), 'not_sure'), nullif(c->>'notes', ''));
    else
      update public.timber_costs set
        property_id    = v_property,
        timber_sale_id = nullif(p->>'timber_sale_id', '')::uuid,
        paid_date      = (c->>'paid_date')::date,
        amount         = (c->>'amount')::numeric,
        vendor         = nullif(c->>'vendor', ''),
        description    = nullif(c->>'description', ''),
        tax_category   = coalesce(nullif(c->>'tax_category', ''), 'not_sure'),
        notes          = nullif(c->>'notes', '')
      where id = (c->>'id')::uuid and activity_id = v_id;
      if not found then
        raise exception 'Cost not found on this activity';
      end if;
    end if;
  end loop;

  return v_id;
end;
$$;

revoke execute on function public.save_stand_activity(jsonb) from public, anon;
grant execute on function public.save_stand_activity(jsonb) to authenticated;

-- ---------------------------------------------------------------- documents
alter table public.documents drop constraint documents_entity_type_check;
alter table public.documents add constraint documents_entity_type_check
  check (entity_type in ('property', 'parcel', 'field', 'pasture', 'wetland',
                         'pollinator_habitat',
                         'easement', 'cemetery', 'maintenance_issue',
                         'timber_stand', 'stand_activity', 'road', 'asset', 'entity',
                         'tenant', 'lease', 'timber_sale', 'tax_statement',
                         'organization'));

-- Same function as 0043 plus the stand_activity branch (reachable
-- through its property).
create or replace function private.can_access_attachment(etype text, eid uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select case etype
    when 'property' then eid = any(private.user_accessible_property_ids())
    when 'parcel'   then eid = any(private.user_accessible_parcel_ids())
    when 'field'    then eid = any(private.user_accessible_field_ids())
    when 'timber_stand' then eid = any(private.user_accessible_stand_ids())
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
