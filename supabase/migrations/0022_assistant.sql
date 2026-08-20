-- ============================================================================
-- Turnrow Landowner: Migration 0022
-- "Ask about your land": the data assistant's read-only SQL seam.
--
-- THE TENANT ISOLATION GUARANTEE IS POSTGRES RLS, NOT PROMPT LANGUAGE.
-- The /api/data-assistant route runs every data access through the
-- CALLER'S OWN Supabase session (their JWT), never the service role:
--   * curated tools call the same lib engines the pages use with the
--     session client, so every select goes through PostgREST as
--     `authenticated` and the organization_id = private.user_org_id()
--     policies filter row by row;
--   * the long-tail tool calls assistant_query() below, which is
--     SECURITY INVOKER, so the dynamic SQL also executes as the calling
--     user and RLS filters exactly as in the app.
-- A prompt-injected or model-invented query therefore cannot see another
-- organization's rows: the database refuses, not the prompt.
--
-- assistant_query defense layers (belt and braces; lib/assistantSql.ts
-- re-validates in JS before calling so the model gets a clear error):
--   1. single statement: one trailing semicolon stripped, any other
--      semicolon or SQL comment rejected; must start with SELECT or WITH;
--   2. write/DDL/lock keywords rejected as WHOLE WORDS (catches
--      data-modifying CTEs like `with x as (insert ...) select`, SELECT
--      INTO, FOR UPDATE, and session settings);
--   3. `set local transaction_read_only = on`: any write that slips past
--      the lexical checks errors at execution;
--   4. `set local statement_timeout = '5000'` bounds runaway queries;
--   5. results wrapped in a subselect with LIMIT 200 (a row cap).
-- The usage log (assistant_usage) was created in migration 0020.
-- Run after 0021.
-- ============================================================================

create or replace function public.assistant_query(q text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  trimmed text := btrim(coalesce(q, ''));
  lowered text;
  result jsonb;
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

  -- Hard guarantees regardless of the lexical checks above.
  set local transaction_read_only = on;
  set local statement_timeout = '5000';

  execute format(
    'select coalesce(jsonb_agg(t), ''[]''::jsonb) from (select * from (%s) s limit 200) t',
    trimmed
  ) into result;
  return result;
end $$;

-- Session required: the function runs as the CALLER (security invoker),
-- so anon gets nothing useful; revoke anyway.
revoke execute on function public.assistant_query(text) from public, anon;
grant execute on function public.assistant_query(text) to authenticated;
