-- ============================================================================
-- Turnrow Landowner: Migration 0024
-- Unfiled documents. A document no longer has to name a property or
-- record before it is saved: entity_type 'organization' (entity_id =
-- the organization id) means "uploaded, not yet filed to a property".
-- The Documents page lists these in an Unfiled section and the owner
-- assigns properties any time (document_properties, migration 0023);
-- assigning re-points the primary attachment to the first property.
-- Every existing entity_type value stays valid. Run after 0023.
-- ============================================================================

set search_path = public, extensions;

alter table public.documents drop constraint documents_entity_type_check;
alter table public.documents add constraint documents_entity_type_check
  check (entity_type in ('property', 'parcel', 'field', 'pasture', 'wetland',
                         'easement',
                         'timber_stand', 'road', 'asset', 'entity',
                         'tenant', 'lease', 'timber_sale', 'tax_statement',
                         'organization'));
