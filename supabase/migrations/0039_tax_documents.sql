-- 0039: Property Taxes documents category.
--
-- The vault taxonomy gains a 'taxes' group with two types: tax_statement
-- (the county bill a batch upload files against a tax_statements header)
-- and tax_receipt. The tax upload used to save the source PDF as
-- doc_type 'other'; this migration widens the check constraint, retypes
-- those rows, points tax_statements.source_document_id at the oldest
-- matching document where it was never set, and synthesizes the
-- "<County> County property tax <year> (<account>)" title the upload now
-- writes for old rows that have none (title_reviewed stays false so the
-- backfill screen still surfaces them).
--
-- Re-runnable. No RLS change.

set search_path = public, extensions;

-- 1. Allow the two new types (the 0020 list plus tax_statement and
--    tax_receipt).
alter table public.documents drop constraint documents_doc_type_check;
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
    'tax_statement', 'tax_receipt',
    'other'));

-- 2. Retype the documents the tax upload saved as 'other'.
update public.documents
set doc_type = 'tax_statement'
where entity_type = 'tax_statement' and doc_type = 'other';

-- 3. Statements whose source_document_id was never set (the upload only
--    began setting it partway through; a failed update also leaves it
--    null) get their OLDEST attached document, deterministically.
update public.tax_statements ts
set source_document_id = d.id
from (
  select distinct on (entity_id) entity_id, id
  from public.documents
  where entity_type = 'tax_statement'
  order by entity_id, created_at, id
) d
where ts.source_document_id is null
  and d.entity_id = ts.id;

-- 4. Untitled tax-statement documents get the title the upload writes.
--    title_reviewed is left alone (false on these rows).
update public.documents d
set title = coalesce(ts.county, 'County') || ' County property tax ' || ts.tax_year
  || case when coalesce(ts.account_number, '') <> ''
          then ' (' || ts.account_number || ')' else '' end
from public.tax_statements ts
where d.entity_type = 'tax_statement'
  and d.entity_id = ts.id
  and d.title is null;
