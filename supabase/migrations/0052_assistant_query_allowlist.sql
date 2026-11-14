-- ============================================================================
-- Turnrow Landowner: Migration 0052
-- Security hardening found in the pre-rollout review (2026-11-14).
--
-- 1. assistant_query: calls only an allowlisted set of functions.
-- 2. assistant_usage: a member can no longer erase or forge the rate
--    limit log.
-- 3. accept_invite: only a confirmed email address can claim an invite.
-- 4. Storage: a member with access to some entities can no longer list,
--    read, or delete the stored files of the others.
--
-- WHY (1). assistant_query runs a SELECT as the calling user so that row
-- level security filters it. It is granted to `authenticated`, which
-- means ANY signed-in account, including one that signed itself up and
-- belongs to no organization, can call it directly through the REST API
-- with SQL of its own choosing; the Ask assistant is not in the way.
-- Row level security decides what a query may read from two session
-- settings: the role, and the request's JWT claims (auth.uid() reads
-- them). A SELECT can change both with set_config(), and can run a
-- second hidden statement with helpers such as query_to_xml(). The old
-- guard was a list of forbidden WORDS, which could not stop either:
-- "set_config" is not the word "set", and a forbidden name can be put
-- together from pieces inside a string. From here on the rule is the
-- other way round: a query may call ONLY the functions listed below
-- (plain SQL syntax and pure functions). Any other name followed by "("
-- is refused, as are double-quoted names (the one way to write a
-- function name the scan would not recognize), schema prefixes other
-- than the app's own, and the pg_ system names.
-- lib/assistantSql.ts carries the same list; assistantSql.test.ts fails
-- if the two drift.
--
-- Run after 0051. Safe to re-run.
-- ============================================================================

create or replace function public.assistant_query(q text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  trimmed text := btrim(coalesce(q, ''));
  lowered text;
  called text;
  result jsonb;
  -- ALLOWED_CALLS begin
  allowed constant text[] := array[
    'select', 'from', 'where', 'and', 'or', 'not', 'in', 'exists', 'any', 'all', 'some',
    'as', 'on', 'using', 'join', 'lateral', 'values', 'over', 'filter', 'by',
    'when', 'then', 'else', 'case', 'union', 'intersect', 'except', 'distinct',
    'having', 'limit', 'offset', 'between', 'like', 'ilike', 'to',
    'group', 'sets', 'rollup', 'cube', 'materialized', 'array', 'row',
    'numeric', 'decimal', 'varchar', 'char', 'character', 'varying',
    'timestamp', 'timestamptz', 'time', 'float',
    'cast', 'extract', 'position', 'substring', 'trim', 'overlay',
    'coalesce', 'nullif', 'greatest', 'least',
    'count', 'sum', 'avg', 'min', 'max', 'string_agg', 'array_agg',
    'json_agg', 'jsonb_agg', 'json_object_agg', 'jsonb_object_agg',
    'bool_and', 'bool_or', 'every', 'stddev', 'variance',
    'percentile_cont', 'percentile_disc', 'mode',
    'row_number', 'rank', 'dense_rank', 'percent_rank', 'cume_dist', 'ntile',
    'lag', 'lead', 'first_value', 'last_value', 'nth_value',
    'abs', 'round', 'trunc', 'ceil', 'ceiling', 'floor', 'sign', 'sqrt',
    'power', 'exp', 'ln', 'log', 'mod', 'div',
    'lower', 'upper', 'initcap', 'length', 'char_length', 'btrim', 'ltrim', 'rtrim',
    'lpad', 'rpad', 'left', 'right', 'substr', 'strpos', 'replace', 'translate',
    'split_part', 'concat', 'concat_ws', 'repeat', 'reverse', 'starts_with', 'format',
    'regexp_replace', 'regexp_match', 'regexp_matches', 'regexp_split_to_array',
    'regexp_split_to_table', 'string_to_array', 'array_to_string',
    'to_char', 'to_number', 'to_date', 'to_timestamp',
    'now', 'date_trunc', 'date_part', 'age', 'make_date', 'date', 'isfinite',
    'unnest', 'array_length', 'cardinality', 'array_position', 'array_remove',
    'array_append', 'array_cat', 'generate_series',
    'jsonb_array_elements', 'jsonb_array_elements_text', 'jsonb_array_length',
    'jsonb_each', 'jsonb_each_text', 'jsonb_object_keys', 'jsonb_extract_path',
    'jsonb_extract_path_text', 'jsonb_typeof', 'jsonb_build_object', 'jsonb_build_array',
    'jsonb_strip_nulls', 'to_jsonb', 'to_json', 'json_build_object', 'json_build_array',
    'json_array_elements', 'json_array_elements_text', 'json_array_length',
    'json_each', 'json_each_text', 'json_object_keys', 'json_extract_path',
    'json_extract_path_text', 'json_typeof', 'row_to_json'
  ];
  -- ALLOWED_CALLS end
begin
  -- One trailing semicolon is the model being tidy: strip it.
  trimmed := regexp_replace(trimmed, ';\s*$', '');
  lowered := lower(trimmed);
  if trimmed = '' then
    raise exception 'assistant_query: empty query';
  end if;
  if position(';' in trimmed) > 0 then
    raise exception 'assistant_query: one SELECT statement only';
  end if;
  if position('--' in trimmed) > 0 or position('/*' in trimmed) > 0 then
    raise exception 'assistant_query: comments are not allowed';
  end if;
  if lowered !~ '^(select|with)\M' then
    raise exception 'assistant_query: only SELECT queries are allowed';
  end if;
  -- Whole-word write/DDL/lock/session keywords (catches data-modifying
  -- CTEs, SELECT INTO, FOR UPDATE, SET/RESET, and the pg_ helpers).
  if lowered ~ '\m(insert|update|delete|merge|truncate|drop|alter|create|grant|revoke|copy|call|do|execute|refresh|lock|set|reset|comment|security|vacuum|analyze|cluster|reindex|listen|notify|into|pg_sleep|pg_read_file|pg_read_binary_file|pg_ls_dir|dblink)\M'
     or lowered ~ '\mlo_[a-z_]*'
     or lowered ~ '\mfor\s+(update|share|no\s+key\s+update|key\s+share)\M' then
    raise exception 'assistant_query: read-only, that keyword is not allowed';
  end if;
  -- A quoted name is the one way to spell a function the scan below
  -- would not recognize (including the U&"..." escaped form).
  if position('"' in trimmed) > 0 then
    raise exception 'assistant_query: double-quoted names are not allowed';
  end if;
  -- The app's data is in the default schema. Sign-in records, stored
  -- files, secrets, private helpers, and system catalogs are off limits.
  if lowered ~ '\m(auth|storage|vault|pgsodium|supabase_functions|extensions|graphql|graphql_public|realtime|cron|private|pg_catalog|information_schema|pg_temp|pg_toast)\s*\.'
     or lowered ~ '\mnet\s*\.\s*_?http'
     or lowered ~ '\mpg_' then
    raise exception 'assistant_query: only this organization''s own tables may be read';
  end if;
  -- The allowlist: every name written directly before "(" must be on it.
  -- Scanned over the whole text, quoted parts included, so nothing can
  -- hide from it; a false refusal is cheap, a missed call is not.
  for called in
    select m[1] from regexp_matches(lowered, '([a-z_][a-z0-9_$]*)\s*\(', 'g') as m
  loop
    if not (called = any (allowed)) then
      raise exception 'assistant_query: "%(" is not an allowed function', called;
    end if;
  end loop;

  -- Hard guarantees regardless of the lexical checks above.
  set local transaction_read_only = on;
  set local statement_timeout = '5000';

  execute format(
    'select coalesce(jsonb_agg(t), ''[]''::jsonb) from (select * from (%s) s limit 200) t',
    trimmed
  ) into result;
  return result;
end $fn$;

-- Session required: the function runs as the CALLER (security invoker),
-- so anon gets nothing useful; revoke anyway.
revoke execute on function public.assistant_query(text) from public, anon;
grant execute on function public.assistant_query(text) to authenticated;

-- ============================================================================
-- 2. assistant_usage: the hourly rate limit log.
--    The one policy was FOR ALL across the whole organization, so a
--    member could delete their own rows (no limit) or insert rows under
--    someone else's user id (locking that person out for an hour).
--    Now: read your own rows, add rows only as yourself, never change or
--    remove one.
-- ============================================================================

drop policy if exists assistant_usage_all on public.assistant_usage;
drop policy if exists assistant_usage_select on public.assistant_usage;
drop policy if exists assistant_usage_insert on public.assistant_usage;

create policy assistant_usage_select on public.assistant_usage
  for select to authenticated
  using (organization_id = private.user_org_id()
         and user_id = (select auth.uid()));

create policy assistant_usage_insert on public.assistant_usage
  for insert to authenticated
  with check (organization_id = private.user_org_id()
              and user_id = (select auth.uid()));

-- ============================================================================
-- 3. accept_invite: require a confirmed email.
--    An invite is matched to whoever signs up with its email address.
--    Email confirmation is on today, which is what makes that safe; this
--    makes the function itself refuse an unconfirmed address, so turning
--    the setting off later cannot let a stranger claim a family
--    member's invite. (Unchanged otherwise from migration 0034.)
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
  select email into user_email from auth.users
  where id = auth.uid() and email_confirmed_at is not null;
  if user_email is null then
    return false;
  end if;
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
-- 4. Storage: entity scope for the stored files themselves.
--    The documents TABLE has been entity-scoped since 0034, but the
--    bucket's own policies only checked the organization folder, on the
--    idea that file paths cannot be guessed. They do not need to be
--    guessed: the same select policy lets any member LIST the folder.
--    So a member granted one entity could list, download, and delete
--    another entity's deeds, leases, and tax bills.
--
--    Now a member may read or delete a stored file only when one of
--    these holds:
--      * they are an admin of the organization;
--      * they uploaded it themselves (covers the moments between an
--        upload and the document row being saved, when the file is read
--        back for the AI scan);
--      * a documents row, or a kept earlier version, that THEY can see
--        points at it. Those subqueries run as the member, so the
--        documents table's own row level security answers the question
--        and the two can never disagree.
--    Uploading is unchanged (any member, into their organization's
--    folder).
-- ============================================================================

create index if not exists documents_storage_path_idx
  on public.documents (storage_path);
create index if not exists document_versions_storage_path_idx
  on public.document_versions (storage_path);

drop policy if exists docs_storage_select on storage.objects;
create policy docs_storage_select on storage.objects for select to authenticated
  using (bucket_id = 'documents'
         and (storage.foldername(name))[1] = private.user_org_id()::text
         and ((select private.user_is_admin())
              or owner_id = (select auth.uid())::text
              or exists (select 1 from public.documents d
                         where d.storage_path = storage.objects.name)
              or exists (select 1 from public.document_versions v
                         where v.storage_path = storage.objects.name)));

drop policy if exists docs_storage_delete on storage.objects;
create policy docs_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'documents'
         and (storage.foldername(name))[1] = private.user_org_id()::text
         and ((select private.user_is_admin())
              or owner_id = (select auth.uid())::text
              or exists (select 1 from public.documents d
                         where d.storage_path = storage.objects.name)
              or exists (select 1 from public.document_versions v
                         where v.storage_path = storage.objects.name)));
