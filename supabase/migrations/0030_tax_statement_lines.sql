-- ============================================================================
-- Turnrow Landowner: Migration 0030
-- Property tax statements rebuilt for how counties actually bill.
--
-- tax_statements becomes the HEADER (county, the billing key the county
-- uses, the taxpayer as printed, tax year, total, dates, source
-- document, matched entity). tax_statement_lines holds every parcel
-- block printed on the statement with every identifier it carries,
-- its values, its tax, and its parcel match. Payments stay at the
-- statement (account) level; expense allocation derives from lines.
--
-- parcel_identifiers is the universal identifier store: every number a
-- county prints for a parcel (parcel number, PPIN, account, key,
-- receipt, folio, ...) as printed and normalized, with its source. The
-- parcel's parcel_number mirrors into it by trigger so matching has ONE
-- path. County imports keep each feature's raw attributes on the parcel
-- (parcels.attributes) and harvest identifiers from them.
--
-- entity_accounts registers recurring statement account numbers to the
-- landowner's entities, confirmed once, so later years pre-label.
--
-- Existing per-parcel statements migrate to single-line statements with
-- their payments untouched. Run after 0029.
-- ============================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------- 1. header
alter table public.tax_statements
  add column account_number        text,
  add column account_kind          text check (account_kind in
                                     ('account_number', 'receipt_number', 'key_number',
                                      'parcel_number', 'bill_number', 'other')),
  add column taxpayer_name_printed text,
  add column care_of_printed       text,
  add column entity_id             uuid,
  add column entity_evidence       text,
  add column source_document_id    uuid references public.documents (id) on delete set null,
  add column line_total            numeric(14, 2),
  add column reconciled            boolean not null default true;

alter table public.tax_statements
  add constraint tax_statements_entity_fkey
  foreign key (entity_id, organization_id)
  references public.entities (id, organization_id)
  on delete set null (entity_id);

-- ---------------------------------------------------------------- 2. lines
create table public.tax_statement_lines (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  tax_statement_id  uuid not null,
  line_no           integer not null default 1,
  tax_year          integer not null,          -- denormalized for the per-parcel rule
  line_type         text not null default 'real_property'
                      check (line_type in ('real_property', 'personal_property')),
  -- Every identifier printed on the line, as printed:
  -- [{ label, kind, value, normalized }]
  identifiers       jsonb not null default '[]',
  appraised_value   numeric(14, 2),
  assessed_value    numeric(14, 2),
  tax_due           numeric(14, 2) not null default 0,
  exemptions        text,
  legal_description text,
  property_address  text,
  acres             numeric(12, 2),
  parcel_id         uuid,
  match_source      text check (match_source in ('identifier', 'manual', 'name', 'spatial', 'migrated')),
  match_evidence    text,
  confirmed         boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  foreign key (tax_statement_id, organization_id)
    references public.tax_statements (id, organization_id) on delete cascade,
  foreign key (parcel_id, organization_id)
    references public.parcels (id, organization_id) on delete set null (parcel_id),
  unique (id, organization_id)
);

-- One line per parcel per tax year across every statement.
create unique index tax_statement_lines_parcel_year_key
  on public.tax_statement_lines (parcel_id, tax_year)
  where parcel_id is not null;

create index tax_statement_lines_statement_idx on public.tax_statement_lines (tax_statement_id);
create index tax_statement_lines_parcel_idx    on public.tax_statement_lines (parcel_id);
create index tax_statement_lines_org_year_idx  on public.tax_statement_lines (organization_id, tax_year);

create trigger set_updated_at before update on public.tax_statement_lines
  for each row execute function private.set_updated_at();

alter table public.tax_statement_lines enable row level security;
create policy tax_statement_lines_all on public.tax_statement_lines
  for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());

-- ---------------------------------------------------------------- 3. parcel identifiers
create table public.parcel_identifiers (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  parcel_id        uuid not null,
  kind             text not null check (kind in (
                     'parcel_number', 'apn', 'pin', 'ppin', 'account_number', 'key_number',
                     'receipt_number', 'property_id', 'geo_id', 'folio', 'alt_key',
                     'schedule_number', 'duplicate_number', 'bill_number', 'sbl', 'bbl',
                     'tmk', 'assessment_number', 'control_map', 'upc', 'other')),
  label            text,                 -- as printed; required in spirit for 'other'
  value            text not null,        -- as printed
  normalized       text not null,        -- lib/parcelNumber.ts canonicalParcel
  source           text not null check (source in ('county_import', 'tax_statement', 'manual')),
  source_ref       text,                 -- statement line id, GIS service id, ...
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  unique (parcel_id, kind, normalized),
  foreign key (parcel_id, organization_id)
    references public.parcels (id, organization_id) on delete cascade
);

create index parcel_identifiers_org_norm_idx on public.parcel_identifiers (organization_id, normalized);
create index parcel_identifiers_parcel_idx   on public.parcel_identifiers (parcel_id);

alter table public.parcel_identifiers enable row level security;
create policy parcel_identifiers_all on public.parcel_identifiers
  for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());

-- SQL twin of lib/parcelNumber.ts canonicalParcel: split on any run of
-- non-alphanumerics, drop leading zeros per segment, drop trailing
-- zero-only segments, join with dashes. Keep the two in step.
create or replace function private.canonical_identifier(raw text)
returns text
language plpgsql
immutable
as $$
declare
  parts text[];
  part  text;
  outp  text[] := '{}';
begin
  if raw is null then return ''; end if;
  parts := regexp_split_to_array(upper(raw), '[^A-Z0-9]+');
  foreach part in array parts loop
    if part = '' then continue; end if;
    if part ~ '^[0-9]+$' then
      part := regexp_replace(part, '^0+', '');
      if part = '' then part := '0'; end if;
    end if;
    outp := outp || part;
  end loop;
  while array_length(outp, 1) > 1 and outp[array_length(outp, 1)] = '0' loop
    outp := outp[1:array_length(outp, 1) - 1];
  end loop;
  return array_to_string(outp, '-');
end;
$$;

-- The parcel number mirrors into the store: backfill, then keep in step.
insert into public.parcel_identifiers
  (organization_id, parcel_id, kind, label, value, normalized, source, first_seen_at, last_seen_at)
select p.organization_id, p.id, 'parcel_number', 'Parcel number', p.parcel_number,
       private.canonical_identifier(p.parcel_number),
       case when p.source like 'Imported from %' then 'county_import' else 'manual' end,
       p.created_at, p.updated_at
from public.parcels p
where p.parcel_number is not null and btrim(p.parcel_number) <> ''
  and private.canonical_identifier(p.parcel_number) <> ''
on conflict (parcel_id, kind, normalized) do nothing;

create or replace function private.mirror_parcel_number()
returns trigger
language plpgsql
as $$
begin
  if new.parcel_number is null or btrim(new.parcel_number) = '' then return new; end if;
  insert into public.parcel_identifiers
    (organization_id, parcel_id, kind, label, value, normalized, source)
  values (new.organization_id, new.id, 'parcel_number', 'Parcel number', new.parcel_number,
          private.canonical_identifier(new.parcel_number), 'manual')
  on conflict (parcel_id, kind, normalized)
    do update set value = excluded.value, last_seen_at = now();
  return new;
end;
$$;

create trigger mirror_parcel_number after insert or update of parcel_number on public.parcels
  for each row execute function private.mirror_parcel_number();

-- ---------------------------------------------------------------- 4. raw county attributes
alter table public.parcels
  add column attributes            jsonb,
  add column attributes_source     text,
  add column attributes_fetched_at timestamptz;

-- ---------------------------------------------------------------- 5. entity accounts
create table public.entity_accounts (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations (id) on delete cascade,
  county                 text not null,
  state                  text not null default '',
  account_number         text not null,    -- normalized
  account_printed        text,
  entity_id              uuid not null,
  taxpayer_name_printed  text,
  confirmed_at           timestamptz not null default now(),
  unique (organization_id, county, state, account_number),
  foreign key (entity_id, organization_id)
    references public.entities (id, organization_id) on delete cascade
);

create index entity_accounts_entity_idx on public.entity_accounts (entity_id);

alter table public.entity_accounts enable row level security;
create policy entity_accounts_all on public.entity_accounts
  for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());

-- ---------------------------------------------------------------- 6. migrate existing statements
-- Every existing statement becomes a header with ONE real-property line
-- carrying its printed parcel number, assessed value, amount, and match.
insert into public.tax_statement_lines
  (organization_id, tax_statement_id, line_no, tax_year, line_type, identifiers,
   assessed_value, tax_due, parcel_id, match_source, match_evidence, confirmed, created_at)
select s.organization_id, s.id, 1, s.tax_year, 'real_property',
       case when s.parcel_number_printed is not null and btrim(s.parcel_number_printed) <> ''
            then jsonb_build_array(jsonb_build_object(
                   'label', 'Parcel number', 'kind', 'parcel_number',
                   'value', s.parcel_number_printed,
                   'normalized', private.canonical_identifier(s.parcel_number_printed)))
            else '[]'::jsonb end,
       s.assessed_value, s.amount_due, s.parcel_id,
       case when s.parcel_id is not null then 'migrated' else null end,
       case when s.parcel_id is not null then 'Matched before statement lines existed' else null end,
       s.parcel_id is not null,
       s.created_at
from public.tax_statements s;

update public.tax_statements s
set taxpayer_name_printed = s.owner_name_printed,
    account_number = s.parcel_number_printed,
    account_kind = case when s.parcel_number_printed is not null then 'parcel_number' else null end,
    line_total = s.amount_due,
    reconciled = true;

-- Duplicate billing keys (unmatched duplicates were allowed before):
-- keep the first, clear the rest so the unique index can be created.
with ranked as (
  select id, row_number() over (
    partition by organization_id, county, coalesce(state, ''), account_number, tax_year
    order by created_at) as rn
  from public.tax_statements where account_number is not null
)
update public.tax_statements s set account_number = null, account_kind = null
from ranked r where r.id = s.id and r.rn > 1;

alter table public.tax_statements drop constraint tax_statements_parcel_id_tax_year_key;
alter table public.tax_statements
  drop column parcel_id,
  drop column parcel_number_printed,
  drop column owner_name_printed,
  drop column assessed_value;

create unique index tax_statements_account_year_key
  on public.tax_statements (organization_id, county, coalesce(state, ''), account_number, tax_year)
  where account_number is not null;

create index tax_statements_entity_idx on public.tax_statements (entity_id);
