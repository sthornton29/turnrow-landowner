-- ============================================================================
-- Turnrow Landowner: Migration 0028
-- Document pages. Every document gets its own page (/documents/[id]) with
-- an editable info panel, so the row gains notes, a one-time title review
-- flag for the backfill screen, an extraction history (dates only), and
-- updated_at. Replace file keeps the superseded file as a row in
-- document_versions. AI-attached properties keep their match evidence
-- line in document_properties.evidence. Every existing title that is
-- empty becomes the cleaned file name (the review screen then proposes
-- richer titles from the extracted fields). Run after 0027.
-- ============================================================================

set search_path = public, extensions;

-- 1. Document row additions.
alter table public.documents
  add column notes text,
  add column title_reviewed boolean not null default false,
  add column extraction_history jsonb not null default '[]',
  add column updated_at timestamptz not null default now();

create trigger set_updated_at before update on public.documents
  for each row execute function private.set_updated_at();

-- Title floor: never show a raw file name again. Strip the extension,
-- turn _ and - into spaces, collapse whitespace.
update public.documents
  set title = btrim(regexp_replace(
        regexp_replace(regexp_replace(file_name, '\.[A-Za-z0-9]{1,5}$', ''), '[_\-]+', ' ', 'g'),
        '\s+', ' ', 'g'))
  where title is null or btrim(title) = '';

-- 2. Match evidence on AI-attached properties ("parcel 12-03-07 matches
--    River Place"), kept so the document page can show why.
alter table public.document_properties add column evidence text;

-- 3. Superseded files. Replace file moves the old object here; the
--    document row keeps its id, links, and extracted fields.
create table public.document_versions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  document_id      uuid not null references public.documents (id) on delete cascade,
  storage_path     text not null,
  file_name        text not null,
  content_type     text,
  size_bytes       bigint,
  uploaded_by      uuid,
  uploaded_at      timestamptz,
  replaced_at      timestamptz not null default now()
);

alter table public.document_versions enable row level security;
create policy document_versions_all on public.document_versions
  for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());

create index document_versions_doc_idx on public.document_versions (document_id);
