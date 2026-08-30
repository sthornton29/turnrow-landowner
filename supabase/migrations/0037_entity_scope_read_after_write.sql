-- ============================================================================
-- Turnrow Landowner: Migration 0037
-- ENTITY SCOPE FIX: reading back a row you just inserted.
--
-- PostgREST inserts use INSERT ... RETURNING, and the returned row must
-- pass the SELECT side (USING) of every policy. 0034's documents USING
-- called can_access_document(id), which re-SELECTS the documents row by
-- id - and a row inserted in the SAME statement is not visible to that
-- lookup, so a user-role member's own legitimate document upload was
-- rejected ("new row violates row-level security policy"). Same latent
-- trap on tax_statements (its accessible-ids array is built FROM
-- tax_statements). The fix mirrors the WITH CHECK rule: USING also
-- accepts the row's OWN columns (the attachment for documents, the
-- entity for statements), which need no self-read. Found by the live
-- isolation test (lib/entityScope.live.test.ts). Run after 0036;
-- safely re-runnable.
-- ============================================================================

set search_path = public, extensions;

-- Link-path helper: does any document_properties row tie this document
-- to a property the caller can see? (SECURITY DEFINER like the rest,
-- so policy evaluation never nests RLS.)
create or replace function private.document_has_accessible_link(did uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.document_properties dp
    where dp.document_id = did
      and dp.organization_id = private.user_org_id()
      and dp.property_id = any(private.user_accessible_property_ids()));
$$;

grant execute on function private.document_has_accessible_link(uuid) to authenticated;

-- can_access_document stays for the tables that reference an EXISTING
-- document (document_versions, document_properties writes); rebuilt on
-- the shared link helper.
create or replace function private.can_access_document(did uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.document_has_accessible_link(did)
  or exists (
    select 1 from public.documents d
    where d.id = did
      and d.organization_id = private.user_org_id()
      and private.can_access_attachment(d.entity_type, d.entity_id));
$$;

-- documents: USING now checks the row's own attachment columns first
-- (no self-read), with the link path as the second door.
drop policy if exists documents_entity_scope on public.documents;
create policy documents_entity_scope on public.documents
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or private.can_access_attachment(entity_type, entity_id)
         or private.document_has_accessible_link(id))
  with check ((select private.user_is_admin())
              or private.can_access_attachment(entity_type, entity_id));

-- tax_statements: USING gains the own-column entity branch so a
-- user-inserted, entity-matched statement reads back in the same
-- statement (the lines path still works through the id array).
drop policy if exists tax_statements_entity_scope on public.tax_statements;
create policy tax_statements_entity_scope on public.tax_statements
  as restrictive for all to authenticated
  using ((select private.user_is_admin())
         or entity_id = any((select private.user_entity_ids())::uuid[])
         or id = any((select private.user_accessible_tax_statement_ids())::uuid[]))
  with check ((select private.user_is_admin())
              or entity_id = any((select private.user_entity_ids())::uuid[])
              or id = any((select private.user_accessible_tax_statement_ids())::uuid[]));
