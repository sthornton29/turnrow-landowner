-- ============================================================================
-- Turnrow Landowner: Migration 0020
-- Document vault: documents gain a TYPE (deeds, surveys, title policies,
-- FSA forms, determinations, appraisals, agreements, other), an AI
-- extraction payload reviewed by the user, links to the easement a deed
-- describes and to the boundary a deed or plat produced, and a search
-- text column for the Documents page. Existing rows become 'other' (the
-- backfill screen lets the owner re-type them in bulk).
-- Also: plss_cache, a GLOBAL read-all cache of BLM PLSS section
-- polygons (static ground truth, refreshed server-side only), and
-- assistant_usage, the per-user hourly rate-limit log shared by the AI
-- routes (extraction, data assistant, help chat, support contact).
-- Run after 0019.
-- ============================================================================

set search_path = public, extensions;

-- 1. Document taxonomy and extraction payload.
alter table public.documents
  add column doc_type text not null default 'other',
  add column title text,
  add column extracted jsonb,
  add column extracted_at timestamptz,
  add column extraction_reviewed boolean not null default false,
  add column ai_suggested_type text,
  add column linked_easement_id uuid,
  add column produced_boundary_type text,
  add column produced_boundary_id uuid,
  add column search_text text;

alter table public.documents add constraint documents_doc_type_check
  check (doc_type in (
    'deed_warranty', 'deed_quitclaim', 'deed_timber', 'deed_mineral',
    'title_insurance', 'title_opinion', 'closing_statement', 'probate_estate',
    'survey_plat', 'legal_description',
    'easement_deed', 'mortgage_dot', 'lien_release',
    'fsa_156ez', 'fsa_map', 'crp_contract', 'nrcs_conservation_plan',
    'wetland_determination', 'hel_determination',
    'appraisal', 'timber_cruise', 'management_plan', 'soil_survey',
    'insurance_policy', 'hunting_agreement', 'current_use_application',
    'other'));

-- An easement deed points at the easement it describes; deleting the
-- easement clears the link, never the document. Composite FK keeps it
-- in-tenant.
alter table public.documents
  add constraint documents_linked_easement_fkey
  foreign key (linked_easement_id, organization_id)
  references public.easements (id, organization_id)
  on delete set null (linked_easement_id);

create index documents_org_type_idx on public.documents (organization_id, doc_type);

-- 2. Search text: file name + title + extracted fields, lowercased,
--    maintained by trigger so the Documents page searches one column.
create or replace function private.documents_search_text()
returns trigger
language plpgsql
as $$
begin
  new.search_text := lower(
    coalesce(new.file_name, '') || ' ' ||
    coalesce(new.title, '') || ' ' ||
    coalesce(new.doc_type, '') || ' ' ||
    coalesce(new.extracted::text, '')
  );
  return new;
end;
$$;

create trigger documents_search_text before insert or update on public.documents
  for each row execute function private.documents_search_text();

-- Backfill search_text for existing rows (doc_type defaulted to other).
update public.documents set search_text = lower(file_name);

-- Trigram index when the extension is available (ILIKE stays correct
-- without it, just slower on very large vaults).
do $$
begin
  begin
    create extension if not exists pg_trgm;
  exception when others then
    raise notice 'pg_trgm unavailable; documents search uses a plain scan';
  end;
  if exists (select 1 from pg_extension where extname = 'pg_trgm') then
    execute 'create index documents_search_trgm_idx on public.documents using gin (search_text gin_trgm_ops)';
  end if;
end $$;

-- 3. plss_cache: GLOBAL, no organization_id. Section polygons from the
--    BLM PLSS services keyed by state|township|range|section|meridian.
--    All authenticated users read; only the server (service role)
--    writes, the RMA cache pattern.
create table public.plss_cache (
  key         text primary key,
  state       text,
  township    text,
  range       text,
  section     int,
  meridian    text,
  geojson     jsonb,
  attrs       jsonb,
  fetched_at  timestamptz not null default now()
);
alter table public.plss_cache enable row level security;
create policy plss_cache_select on public.plss_cache
  for select to authenticated using (true);

-- 4. assistant_usage: one row per AI call, per user, for hourly limits.
create table public.assistant_usage (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  user_id          uuid not null,
  kind             text not null check (kind in
                     ('assistant', 'support_chat', 'support_contact', 'extract')),
  created_at       timestamptz not null default now(),
  tokens           int
);
alter table public.assistant_usage enable row level security;
create policy assistant_usage_all on public.assistant_usage
  for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());
create index assistant_usage_user_idx
  on public.assistant_usage (user_id, kind, created_at);
