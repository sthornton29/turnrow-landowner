-- ============================================================================
-- Turnrow Landowner: Migration 0034 (v2: fixes "operator does not
-- exist: uuid = uuid[]" - Postgres reads "= any((select fn()))" as the
-- SUBQUERY form of ANY, comparing uuid to uuid[] rows; the ::uuid[]
-- cast forces the ARRAY form while keeping the one-evaluation-per-
-- statement InitPlan. Also made SAFELY RE-RUNNABLE: every DDL guarded
-- with if-exists/if-not-exists, every policy dropped before created.)
--
-- ADMIN AND USER ROLES WITH ENTITY-SCOPED ACCESS.
--
-- Roles rename: owner -> admin, member -> user (is_platform_admin is
-- orthogonal and untouched). Admins see everything in their org and
-- manage access. Users see ONLY data belonging to entities they are
-- granted through the new entity_access table, ENFORCED IN RLS:
-- properties by entity_id, and everything reached through them.
--
-- Mechanism: one ADDITIVE RESTRICTIVE policy per scoped table. The
-- existing permissive org policies (<t>_all) are untouched, so the org
-- boundary stands and rollback is "drop the _entity_scope policies".
-- Restrictive policies AND with permissive ones.
--
-- LOUD MIGRATION NOTE: after this runs, every existing 'member' account
-- becomes a 'user' with NO entity grants and their app goes EMPTY until
-- an admin grants entities (Settings > Members) or promotes them.
-- 'owner' accounts become 'admin' and see everything, unchanged.
--
-- Hardening rules baked in (from the design review):
--   * Policies hoist helper calls as scalar subselects
--     ("= any((select private.user_entity_ids())::uuid[])") so
--     Postgres evaluates them ONCE per statement (InitPlan) and can
--     use indexes, instead of once per row.
--   * INSERT/UPDATE checks never re-select the row being written (a
--     same-statement self-read sees nothing): document writes check
--     can_access_attachment(entity_type, entity_id) on the row's own
--     columns; tax statement writes fall back to the row's entity_id.
--   * Link tables (document_properties, lease_lands,
--     timber_sale_stands, fsa_farm_properties) check BOTH sides on
--     write so a user cannot graft their property onto another
--     entity's record to escalate reads. Reads stay one-sided: an
--     admin-created link is exactly how a record is shared into an
--     entity's view.
--   * Parents whose access derives from children (leases, timber
--     sales, FSA farms) cannot be CREATED by users (no children yet =
--     check fails); creating org-structure records is admin work by
--     intent. Updates to accessible parents still pass (the access
--     arrays derive from existing child rows).
--
-- Deliberately UNSCOPED beyond the org (documented in PROJECT_SUMMARY):
-- tenants (per spec they stay readable; note they carry counterparty
-- contact details), farm_connections reads (Farm Data needs the
-- connection names; writes below are admin-only), farm_marketing_prices
-- (a tenant's own price aggregate, not land data), county_tax_defaults,
-- assistant_usage (already per-user), profiles/invites/organizations
-- (already role-gated where needed). Storage objects stay org-scoped:
-- paths are unguessable and the documents table is the only index.
-- Run after 0033.
-- ============================================================================

set search_path = public, extensions;

-- ============================================================================
-- 1. ROLES: owner -> admin, member -> user.
--    Drop the CHECKs BEFORE the updates or the updates violate them
--    (if-exists so a partially applied run can be re-run safely).
-- ============================================================================

alter table public.profiles drop constraint if exists profiles_role_check;
update public.profiles set role = 'admin' where role = 'owner';
update public.profiles set role = 'user'  where role = 'member';
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'user'));

alter table public.invites drop constraint if exists invites_role_check;
update public.invites set role = 'admin' where role = 'owner';
update public.invites set role = 'user'  where role = 'member';
alter table public.invites add constraint invites_role_check
  check (role in ('admin', 'user'));
alter table public.invites alter column role set default 'user';

-- Invites can carry the initial entity grants for a user-role invite.
alter table public.invites add column if not exists entity_ids uuid[] not null default '{}';

-- ============================================================================
-- 2. entity_access: which entities a user-role member may see.
--    Admins are not listed here; the admin role sees everything.
-- ============================================================================

create table if not exists public.entity_access (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  entity_id        uuid not null,
  created_at       timestamptz not null default now(),
  unique (user_id, entity_id),
  -- composite FK: the entity must belong to the SAME organization
  foreign key (entity_id, organization_id)
    references public.entities (id, organization_id) on delete cascade
);
create index if not exists entity_access_user_idx   on public.entity_access (user_id);
create index if not exists entity_access_org_idx    on public.entity_access (organization_id);
create index if not exists entity_access_entity_idx on public.entity_access (entity_id);

-- ============================================================================
-- 3. Helper functions. SECURITY DEFINER so policy evaluation never
--    recurses into the policies being defined; each helper scopes to
--    the caller's own org/user itself. STABLE: one value per statement.
-- ============================================================================

create or replace function private.user_is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select role = 'admin' from public.profiles where id = (select auth.uid())),
    false);
$$;

create or replace function private.user_entity_ids()
returns uuid[] language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(entity_id), '{}')
  from public.entity_access where user_id = (select auth.uid());
$$;

-- The accessible-id arrays below power the hoisted
-- "= any((select ...)::uuid[])" policy form: one array build per
-- statement, then an indexable ANY. They list only ENTITY-GRANTED
-- rows; admins short-circuit in the policies via user_is_admin() and
-- never reach these.

create or replace function private.user_accessible_property_ids()
returns uuid[] language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(id), '{}')
  from public.properties
  where organization_id = private.user_org_id()
    and entity_id = any(private.user_entity_ids());
$$;

create or replace function private.user_accessible_parcel_ids()
returns uuid[] language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(id), '{}')
  from public.parcels
  where organization_id = private.user_org_id()
    and property_id = any(private.user_accessible_property_ids());
$$;

create or replace function private.user_accessible_field_ids()
returns uuid[] language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(id), '{}')
  from public.fields
  where organization_id = private.user_org_id()
    and property_id = any(private.user_accessible_property_ids());
$$;

create or replace function private.user_accessible_stand_ids()
returns uuid[] language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(id), '{}')
  from public.timber_stands
  where organization_id = private.user_org_id()
    and property_id = any(private.user_accessible_property_ids());
$$;

-- A lease is accessible when ANY of its land rows sits on an
-- accessible property. A lease with no land rows is admin-only.
create or replace function private.user_accessible_lease_ids()
returns uuid[] language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(distinct lease_id), '{}')
  from public.lease_lands
  where organization_id = private.user_org_id()
    and property_id = any(private.user_accessible_property_ids());
$$;

create or replace function private.user_accessible_timber_sale_ids()
returns uuid[] language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(distinct timber_sale_id), '{}')
  from public.timber_sale_stands
  where organization_id = private.user_org_id()
    and timber_stand_id = any(private.user_accessible_stand_ids());
$$;

create or replace function private.user_accessible_fsa_farm_ids()
returns uuid[] language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(distinct fsa_farm_id), '{}')
  from public.fsa_farm_properties
  where organization_id = private.user_org_id()
    and property_id = any(private.user_accessible_property_ids());
$$;

-- A statement is accessible when it is matched to a granted entity OR
-- any of its lines matches an accessible parcel. Personal-property
-- statements with no entity match stay admin-only.
create or replace function private.user_accessible_tax_statement_ids()
returns uuid[] language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(distinct id), '{}') from (
    select id from public.tax_statements
    where organization_id = private.user_org_id()
      and entity_id = any(private.user_entity_ids())
    union
    select tax_statement_id from public.tax_statement_lines
    where organization_id = private.user_org_id()
      and parcel_id = any(private.user_accessible_parcel_ids())
  ) s (id);
$$;

-- Farm rows key on (connection, remote field); accessible when a field
-- mapping ties that remote field to an accessible property or ag field.
create or replace function private.can_access_remote_field(conn uuid, rfid text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.field_mappings fm
    where fm.farm_connection_id = conn
      and fm.remote_field_id = rfid
      and fm.organization_id = private.user_org_id()
      and (fm.local_property_id = any(private.user_accessible_property_ids())
           or fm.local_field_id = any(private.user_accessible_field_ids())));
$$;

-- Documents: the WRITE-side check reads the row's OWN attachment
-- columns (never a self-select of the row being inserted).
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
    when 'pasture' then exists (select 1 from public.pastures x where x.id = eid
      and x.property_id = any(private.user_accessible_property_ids()))
    when 'wetland' then exists (select 1 from public.wetlands x where x.id = eid
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

-- Documents: the READ side. Accessible via any linked property, or via
-- the primary attachment.
create or replace function private.can_access_document(did uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.document_properties dp
    where dp.document_id = did
      and dp.organization_id = private.user_org_id()
      and dp.property_id = any(private.user_accessible_property_ids()))
  or exists (
    select 1 from public.documents d
    where d.id = did
      and d.organization_id = private.user_org_id()
      and private.can_access_attachment(d.entity_type, d.entity_id));
$$;

grant execute on function
  private.user_is_admin(),
  private.user_entity_ids(),
  private.user_accessible_property_ids(),
  private.user_accessible_parcel_ids(),
  private.user_accessible_field_ids(),
  private.user_accessible_stand_ids(),
  private.user_accessible_lease_ids(),
  private.user_accessible_timber_sale_ids(),
  private.user_accessible_fsa_farm_ids(),
  private.user_accessible_tax_statement_ids(),
  private.can_access_remote_field(uuid, text),
  private.can_access_attachment(text, uuid),
  private.can_access_document(uuid)
to authenticated;

-- ============================================================================
-- 4. entity_access RLS: users read their own grants; admins manage all.
-- ============================================================================

alter table public.entity_access enable row level security;
drop policy if exists entity_access_select on public.entity_access;
create policy entity_access_select on public.entity_access for select to authenticated
  using (organization_id = private.user_org_id()
         and (user_id = (select auth.uid()) or (select private.user_is_admin())));
drop policy if exists entity_access_insert on public.entity_access;
create policy entity_access_insert on public.entity_access for insert to authenticated
  with check (organization_id = private.user_org_id() and (select private.user_is_admin()));
drop policy if exists entity_access_delete on public.entity_access;
create policy entity_access_delete on public.entity_access for delete to authenticated
  using (organization_id = private.user_org_id() and (select private.user_is_admin()));

-- ============================================================================
-- 5. The three 'owner'-literal policies become admin policies.
--    (No CREATE OR REPLACE POLICY exists: drop + create.)
-- ============================================================================

drop policy if exists org_update on public.organizations;
create policy org_update on public.organizations for update to authenticated
  using (id = private.user_org_id() and (select private.user_is_admin()))
  with check (id = private.user_org_id());

drop policy if exists invites_insert on public.invites;
create policy invites_insert on public.invites for insert to authenticated
  with check (organization_id = private.user_org_id() and (select private.user_is_admin()));

drop policy if exists invites_delete on public.invites;
create policy invites_delete on public.invites for delete to authenticated
  using (organization_id = private.user_org_id() and (select private.user_is_admin()));

-- ============================================================================
-- 6. accept_invite() copies role AND initial entity grants (only
--    entities that belong to the invite's own organization).
-- ============================================================================

create or replace function public.accept_invite()
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  inv record;
  user_email text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if (select organization_id from public.profiles where id = auth.uid()) is not null then
    return false;
  end if;
  select email into user_email from auth.users where id = auth.uid();
  select * into inv from public.invites
  where lower(email) = lower(user_email) and accepted_at is null
  order by created_at
  limit 1;
  if inv.id is null then
    return false;
  end if;
  update public.profiles set organization_id = inv.organization_id, role = inv.role
  where id = auth.uid();
  insert into public.entity_access (organization_id, user_id, entity_id)
  select inv.organization_id, auth.uid(), e.id
  from unnest(inv.entity_ids) as granted (eid)
  join public.entities e
    on e.id = granted.eid and e.organization_id = inv.organization_id
  on conflict (user_id, entity_id) do nothing;
  update public.invites set accepted_at = now() where id = inv.id;
  return true;
end;
$$;

-- ============================================================================
-- 7. set_member_role: the ONE way to change a role from the app
--    (profiles updates stay column-restricted to full_name).
--    Admin-only, same org, never your own row (no self-demotion, and
--    at least one admin always remains).
-- ============================================================================

create or replace function public.set_member_role(target uuid, new_role text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not private.user_is_admin() then
    raise exception 'Only admins can change roles';
  end if;
  if target = auth.uid() then
    raise exception 'You cannot change your own role';
  end if;
  if new_role not in ('admin', 'user') then
    raise exception 'Unknown role %', new_role;
  end if;
  update public.profiles
  set role = new_role
  where id = target and organization_id = private.user_org_id();
  if not found then
    raise exception 'No such member in your organization';
  end if;
end;
$$;

revoke execute on function public.set_member_role(uuid, text) from public, anon;
grant execute on function public.set_member_role(uuid, text) to authenticated;

-- ============================================================================
-- 8. RESTRICTIVE entity-scope policies. Every expression hoists its
--    helper calls as scalar subselects cast to uuid[] (once per
--    statement, indexable; the cast keeps ANY in its ARRAY form).
-- ============================================================================

-- ---- properties: the root. NULL entity_id = admin-only. -------------------
drop policy if exists properties_entity_scope on public.properties;
create policy properties_entity_scope on public.properties
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or entity_id = any((select private.user_entity_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or entity_id = any((select private.user_entity_ids())::uuid[]));

-- ---- entities and their satellites ----------------------------------------
drop policy if exists entities_entity_scope on public.entities;
create policy entities_entity_scope on public.entities
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or id = any((select private.user_entity_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or id = any((select private.user_entity_ids())::uuid[]));

drop policy if exists entity_aliases_entity_scope on public.entity_aliases;
create policy entity_aliases_entity_scope on public.entity_aliases
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or entity_id = any((select private.user_entity_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or entity_id = any((select private.user_entity_ids())::uuid[]));

drop policy if exists entity_accounts_entity_scope on public.entity_accounts;
create policy entity_accounts_entity_scope on public.entity_accounts
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or entity_id = any((select private.user_entity_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or entity_id = any((select private.user_entity_ids())::uuid[]));

-- ---- land children: property_id NOT NULL ----------------------------------
drop policy if exists parcels_entity_scope on public.parcels;
create policy parcels_entity_scope on public.parcels
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or property_id = any((select private.user_accessible_property_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or property_id = any((select private.user_accessible_property_ids())::uuid[]));

drop policy if exists fields_entity_scope on public.fields;
create policy fields_entity_scope on public.fields
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or property_id = any((select private.user_accessible_property_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or property_id = any((select private.user_accessible_property_ids())::uuid[]));

drop policy if exists pastures_entity_scope on public.pastures;
create policy pastures_entity_scope on public.pastures
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or property_id = any((select private.user_accessible_property_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or property_id = any((select private.user_accessible_property_ids())::uuid[]));

drop policy if exists wetlands_entity_scope on public.wetlands;
create policy wetlands_entity_scope on public.wetlands
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or property_id = any((select private.user_accessible_property_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or property_id = any((select private.user_accessible_property_ids())::uuid[]));

drop policy if exists timber_stands_entity_scope on public.timber_stands;
create policy timber_stands_entity_scope on public.timber_stands
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or property_id = any((select private.user_accessible_property_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or property_id = any((select private.user_accessible_property_ids())::uuid[]));

drop policy if exists roads_entity_scope on public.roads;
create policy roads_entity_scope on public.roads
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or property_id = any((select private.user_accessible_property_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or property_id = any((select private.user_accessible_property_ids())::uuid[]));

drop policy if exists cemeteries_entity_scope on public.cemeteries;
create policy cemeteries_entity_scope on public.cemeteries
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or property_id = any((select private.user_accessible_property_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or property_id = any((select private.user_accessible_property_ids())::uuid[]));

drop policy if exists land_sections_entity_scope on public.land_sections;
create policy land_sections_entity_scope on public.land_sections
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or property_id = any((select private.user_accessible_property_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or property_id = any((select private.user_accessible_property_ids())::uuid[]));

drop policy if exists property_aliases_entity_scope on public.property_aliases;
create policy property_aliases_entity_scope on public.property_aliases
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or property_id = any((select private.user_accessible_property_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or property_id = any((select private.user_accessible_property_ids())::uuid[]));

drop policy if exists timber_scans_entity_scope on public.timber_scans;
create policy timber_scans_entity_scope on public.timber_scans
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or property_id = any((select private.user_accessible_property_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or property_id = any((select private.user_accessible_property_ids())::uuid[]));

-- ---- property NULLABLE: a NULL property row is admin-only -----------------
drop policy if exists assets_entity_scope on public.assets;
create policy assets_entity_scope on public.assets
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or property_id = any((select private.user_accessible_property_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or property_id = any((select private.user_accessible_property_ids())::uuid[]));

drop policy if exists easements_entity_scope on public.easements;
create policy easements_entity_scope on public.easements
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or property_id = any((select private.user_accessible_property_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or property_id = any((select private.user_accessible_property_ids())::uuid[]));

drop policy if exists maintenance_issues_entity_scope on public.maintenance_issues;
create policy maintenance_issues_entity_scope on public.maintenance_issues
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or property_id = any((select private.user_accessible_property_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or property_id = any((select private.user_accessible_property_ids())::uuid[]));

-- ---- lease chain ----------------------------------------------------------
drop policy if exists leases_entity_scope on public.leases;
create policy leases_entity_scope on public.leases
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or id = any((select private.user_accessible_lease_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or id = any((select private.user_accessible_lease_ids())::uuid[]));

-- Link table: read follows the property; WRITE requires both sides so a
-- user cannot graft their property onto an inaccessible lease.
drop policy if exists lease_lands_entity_scope on public.lease_lands;
create policy lease_lands_entity_scope on public.lease_lands
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or property_id = any((select private.user_accessible_property_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or (property_id = any((select private.user_accessible_property_ids())::uuid[])
                  and lease_id = any((select private.user_accessible_lease_ids())::uuid[])));

drop policy if exists lease_year_assumptions_entity_scope on public.lease_year_assumptions;
create policy lease_year_assumptions_entity_scope on public.lease_year_assumptions
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or lease_id = any((select private.user_accessible_lease_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or lease_id = any((select private.user_accessible_lease_ids())::uuid[]));

drop policy if exists expected_payments_entity_scope on public.expected_payments;
create policy expected_payments_entity_scope on public.expected_payments
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or lease_id = any((select private.user_accessible_lease_ids())::uuid[])
         or timber_sale_id = any((select private.user_accessible_timber_sale_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or lease_id = any((select private.user_accessible_lease_ids())::uuid[])
              or timber_sale_id = any((select private.user_accessible_timber_sale_ids())::uuid[]));

drop policy if exists payments_entity_scope on public.payments;
create policy payments_entity_scope on public.payments
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or lease_id = any((select private.user_accessible_lease_ids())::uuid[])
         or timber_sale_id = any((select private.user_accessible_timber_sale_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or lease_id = any((select private.user_accessible_lease_ids())::uuid[])
              or timber_sale_id = any((select private.user_accessible_timber_sale_ids())::uuid[]));

-- ---- timber sale chain ----------------------------------------------------
drop policy if exists timber_sales_entity_scope on public.timber_sales;
create policy timber_sales_entity_scope on public.timber_sales
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or id = any((select private.user_accessible_timber_sale_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or id = any((select private.user_accessible_timber_sale_ids())::uuid[]));

drop policy if exists timber_sale_stands_entity_scope on public.timber_sale_stands;
create policy timber_sale_stands_entity_scope on public.timber_sale_stands
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or timber_sale_id = any((select private.user_accessible_timber_sale_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or (timber_sale_id = any((select private.user_accessible_timber_sale_ids())::uuid[])
                  and timber_stand_id = any((select private.user_accessible_stand_ids())::uuid[])));

drop policy if exists timber_settlements_entity_scope on public.timber_settlements;
create policy timber_settlements_entity_scope on public.timber_settlements
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or timber_sale_id = any((select private.user_accessible_timber_sale_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or timber_sale_id = any((select private.user_accessible_timber_sale_ids())::uuid[]));

-- ---- tax chain ------------------------------------------------------------
-- WRITE check falls back to the row's own entity_id (never a
-- self-select: the id array cannot contain a row being inserted).
drop policy if exists tax_statements_entity_scope on public.tax_statements;
create policy tax_statements_entity_scope on public.tax_statements
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or id = any((select private.user_accessible_tax_statement_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or id = any((select private.user_accessible_tax_statement_ids())::uuid[])
              or entity_id = any((select private.user_entity_ids())::uuid[]));

drop policy if exists tax_statement_lines_entity_scope on public.tax_statement_lines;
create policy tax_statement_lines_entity_scope on public.tax_statement_lines
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or parcel_id = any((select private.user_accessible_parcel_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or parcel_id = any((select private.user_accessible_parcel_ids())::uuid[]));

drop policy if exists tax_payments_entity_scope on public.tax_payments;
create policy tax_payments_entity_scope on public.tax_payments
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or tax_statement_id = any((select private.user_accessible_tax_statement_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or tax_statement_id = any((select private.user_accessible_tax_statement_ids())::uuid[]));

drop policy if exists parcel_identifiers_entity_scope on public.parcel_identifiers;
create policy parcel_identifiers_entity_scope on public.parcel_identifiers
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or parcel_id = any((select private.user_accessible_parcel_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or parcel_id = any((select private.user_accessible_parcel_ids())::uuid[]));

-- ---- gov payments chain ---------------------------------------------------
drop policy if exists fsa_farms_entity_scope on public.fsa_farms;
create policy fsa_farms_entity_scope on public.fsa_farms
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or id = any((select private.user_accessible_fsa_farm_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or id = any((select private.user_accessible_fsa_farm_ids())::uuid[]));

drop policy if exists fsa_farm_properties_entity_scope on public.fsa_farm_properties;
create policy fsa_farm_properties_entity_scope on public.fsa_farm_properties
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or property_id = any((select private.user_accessible_property_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or (property_id = any((select private.user_accessible_property_ids())::uuid[])
                  and fsa_farm_id = any((select private.user_accessible_fsa_farm_ids())::uuid[])));

drop policy if exists fsa_base_acres_entity_scope on public.fsa_base_acres;
create policy fsa_base_acres_entity_scope on public.fsa_base_acres
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or fsa_farm_id = any((select private.user_accessible_fsa_farm_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or fsa_farm_id = any((select private.user_accessible_fsa_farm_ids())::uuid[]));

drop policy if exists fsa_elections_entity_scope on public.fsa_elections;
create policy fsa_elections_entity_scope on public.fsa_elections
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or fsa_farm_id = any((select private.user_accessible_fsa_farm_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or fsa_farm_id = any((select private.user_accessible_fsa_farm_ids())::uuid[]));

-- ---- farm data chain ------------------------------------------------------
drop policy if exists field_mappings_entity_scope on public.field_mappings;
create policy field_mappings_entity_scope on public.field_mappings
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or local_property_id = any((select private.user_accessible_property_ids())::uuid[])
         or local_field_id = any((select private.user_accessible_field_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or local_property_id = any((select private.user_accessible_property_ids())::uuid[])
              or local_field_id = any((select private.user_accessible_field_ids())::uuid[]));

drop policy if exists farm_field_data_entity_scope on public.farm_field_data;
create policy farm_field_data_entity_scope on public.farm_field_data
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or private.can_access_remote_field(farm_connection_id, remote_field_id))
  with check ((select private.user_is_admin())
              or private.can_access_remote_field(farm_connection_id, remote_field_id));

drop policy if exists farm_projected_yields_entity_scope on public.farm_projected_yields;
create policy farm_projected_yields_entity_scope on public.farm_projected_yields
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or private.can_access_remote_field(farm_connection_id, remote_field_id))
  with check ((select private.user_is_admin())
              or private.can_access_remote_field(farm_connection_id, remote_field_id));

-- farm_connections: reads stay org-wide (Farm Data needs names/status);
-- writes are admin work. Per-command restrictive policies so SELECT is
-- untouched.
drop policy if exists farm_connections_admin_insert on public.farm_connections;
create policy farm_connections_admin_insert on public.farm_connections
  as restrictive for insert to authenticated
  with check ((select private.user_is_admin()));
drop policy if exists farm_connections_admin_update on public.farm_connections;
create policy farm_connections_admin_update on public.farm_connections
  as restrictive for update to authenticated
  using ((select private.user_is_admin()))
  with check ((select private.user_is_admin()));
drop policy if exists farm_connections_admin_delete on public.farm_connections;
create policy farm_connections_admin_delete on public.farm_connections
  as restrictive for delete to authenticated
  using ((select private.user_is_admin()));

-- ---- documents ------------------------------------------------------------
drop policy if exists documents_entity_scope on public.documents;
create policy documents_entity_scope on public.documents
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or private.can_access_document(id))
  with check ((select private.user_is_admin())
              or private.can_access_attachment(entity_type, entity_id));

-- Link table: WRITE requires both sides (a user must already be able to
-- read the document to link it to their property).
drop policy if exists document_properties_entity_scope on public.document_properties;
create policy document_properties_entity_scope on public.document_properties
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or property_id = any((select private.user_accessible_property_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or (property_id = any((select private.user_accessible_property_ids())::uuid[])
                  and private.can_access_document(document_id)));

drop policy if exists document_versions_entity_scope on public.document_versions;
create policy document_versions_entity_scope on public.document_versions
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or private.can_access_document(document_id))
  with check ((select private.user_is_admin())
              or private.can_access_document(document_id));
