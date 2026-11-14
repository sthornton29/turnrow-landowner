-- ============================================================================
-- Turnrow Landowner: Migration 0053
-- Two fixes from the pre-rollout review (2026-11-14).
--
-- 1. Five foreign keys that made a delete fail instead of unlinking.
-- 2. remove_member(): an admin can take someone off the account.
--
-- WHY (1). These keys pair a record's id with organization_id (so one
-- organization can never point at another's rows) and say ON DELETE SET
-- NULL. Written without a column list, SET NULL blanks BOTH columns of
-- the pair, and organization_id is NOT NULL, so the delete of the parent
-- row is refused with "null value in column organization_id". Later
-- migrations (0009 onward) use the correct form,
-- ON DELETE SET NULL (the_one_column); these five predate it:
--   payments.expected_payment_id     deleting an expected payment that
--                                    has money recorded against it
--   timber_sales.buyer_tenant_id     deleting a tenant who bought timber
--   assets.parent_asset_id           deleting a bin site that has bins,
--                                    or a well that feeds a pivot
--   field_mappings.local_field_id    deleting an ag field that is mapped
--   field_mappings.local_property_id to farm data, or its property
-- In each case the app said the delete worked, or showed a confusing
-- message, and nothing happened.
--
-- The constraints were created without names, so each is found by its
-- table and columns rather than by a guessed name.
--
-- Run after 0052. Safe to re-run.
-- ============================================================================

do $$
declare
  fix record;
  found_name text;
begin
  for fix in
    select * from (values
      ('payments',       'expected_payment_id', 'expected_payments'),
      ('timber_sales',   'buyer_tenant_id',     'tenants'),
      ('assets',         'parent_asset_id',     'assets'),
      ('field_mappings', 'local_field_id',      'fields'),
      ('field_mappings', 'local_property_id',   'properties')
    ) as t (child_table, child_column, parent_table)
  loop
    -- The existing key: on this table, to that parent, over exactly
    -- (child_column, organization_id).
    select c.conname into found_name
    from pg_constraint c
    where c.contype = 'f'
      and c.conrelid = format('public.%I', fix.child_table)::regclass
      and c.confrelid = format('public.%I', fix.parent_table)::regclass
      and (
        select array_agg(a.attname::text order by k.ord)
        from unnest(c.conkey) with ordinality as k (attnum, ord)
        join pg_attribute a
          on a.attrelid = c.conrelid and a.attnum = k.attnum
      ) = array[fix.child_column, 'organization_id']
    limit 1;

    if found_name is not null then
      execute format('alter table public.%I drop constraint %I', fix.child_table, found_name);
    end if;

    execute format(
      'alter table public.%I add constraint %I '
      || 'foreign key (%I, organization_id) '
      || 'references public.%I (id, organization_id) '
      || 'on delete set null (%I)',
      fix.child_table,
      fix.child_table || '_' || fix.child_column || '_org_fkey',
      fix.child_column,
      fix.parent_table,
      fix.child_column
    );
  end loop;
end $$;

-- ============================================================================
-- 2. remove_member(target): take a person off the account.
--    Until now the only option was to demote them and untick every
--    entity, which still left them able to see tenants and the member
--    list. This disconnects their profile from the organization and
--    removes their entity grants. Their sign-in itself is untouched: if
--    they are invited again later, the invite connects them as before.
--    Admin-only, same organization, never yourself (so at least one
--    admin always remains).
-- ============================================================================

create or replace function public.remove_member(target uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  org uuid := private.user_org_id();
begin
  if not private.user_is_admin() then
    raise exception 'Only admins can remove members';
  end if;
  if target = auth.uid() then
    raise exception 'You cannot remove yourself';
  end if;
  if not exists (
    select 1 from public.profiles where id = target and organization_id = org
  ) then
    raise exception 'No such member in your organization';
  end if;
  delete from public.entity_access
  where user_id = target and organization_id = org;
  -- Back to the state of someone who has signed up and not yet been
  -- invited: no organization and no role.
  update public.profiles
  set organization_id = null, role = null
  where id = target and organization_id = org;
end;
$$;

revoke execute on function public.remove_member(uuid) from public, anon;
grant execute on function public.remove_member(uuid) to authenticated;
