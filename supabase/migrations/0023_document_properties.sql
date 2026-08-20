-- ============================================================================
-- Turnrow Landowner: Migration 0023
-- A document can apply to SEVERAL properties (a deed conveying two
-- tracts, a title policy covering the whole farm, a survey of adjoining
-- places). documents.entity_type / entity_id stay the PRIMARY attachment
-- (the first property chosen, or a non-property record such as a lease
-- or easement); document_properties lists every property the document
-- applies to. Existing property-attached documents are backfilled with
-- one link each so nothing changes for them.
-- Run after 0022.
-- ============================================================================

set search_path = public, extensions;

create table public.document_properties (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  document_id      uuid not null references public.documents (id) on delete cascade,
  property_id      uuid not null,
  created_at       timestamptz not null default now(),
  unique (document_id, property_id),
  foreign key (property_id, organization_id)
    references public.properties (id, organization_id)
    on delete cascade
);

alter table public.document_properties enable row level security;
create policy document_properties_all on public.document_properties
  for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());

create index document_properties_doc_idx  on public.document_properties (document_id);
create index document_properties_prop_idx on public.document_properties (property_id);

-- Backfill: every document attached directly to a property links to it.
insert into public.document_properties (organization_id, document_id, property_id)
select d.organization_id, d.id, d.entity_id
from public.documents d
join public.properties p
  on p.id = d.entity_id and p.organization_id = d.organization_id
where d.entity_type = 'property'
on conflict (document_id, property_id) do nothing;
