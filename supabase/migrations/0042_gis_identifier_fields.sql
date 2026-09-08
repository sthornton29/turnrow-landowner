-- 0042: Identifier field mappings per county GIS service.
--
-- Beyond the parcel number, a county layer usually carries the other
-- numbers its tax office prints (Alabama KCS layers carry PPIN and PIN;
-- elsewhere ALTKEY, FOLIO, KEY, ACCT). Each service now records which
-- attribute holds which identifier kind, so:
--   - imports harvest those identifiers by mapping, not by guessing
--     field names;
--   - the property tax matcher can ask the county for a parcel BY the
--     number printed on the statement when the local identifier store
--     has never seen it (the live lookup tier);
--   - the per-county backfill knows exactly what to store.
-- Shape: jsonb array of {"field": "<attribute name>", "kind": "<kind>"}
-- where kind is one of the parcel_identifiers kinds. Set from the admin
-- verify flow (auto-detected, confirmed by the platform admin).
--
-- The DIAGNOSIS that drove it (2026-09-08): the Colbert County 2026
-- statement (account 1234, two PPIN-only lines) could not match the
-- Cottontown parcels because they were imported five days before
-- attribute retention (0030), the Colbert server was down the night the
-- backfill ran, and the 2024 statement was never hand-confirmed, so no
-- PPIN was ever stored. The seeds below map the fields verified live
-- on every registered Alabama layer that day.
--
-- Re-runnable. No RLS change: reads are already open to all signed-in
-- users and writes are already platform-admin only (migration 0005).

alter table public.county_gis_services
  add column if not exists identifier_fields jsonb not null default '[]'::jsonb;

comment on column public.county_gis_services.identifier_fields is
  'Attribute -> identifier kind mappings beyond the parcel field: [{"field":"PPIN","kind":"ppin"}, ...]. Used by imports, the per-county backfill, and the tax matcher''s live county lookup.';

-- Seeds for the Alabama layers verified live on 2026-09-08. A service
-- an admin has already mapped by hand keeps its mappings.
update public.county_gis_services
   set identifier_fields = '[{"field":"PPIN","kind":"ppin"},{"field":"PIN","kind":"pin"}]'::jsonb
 where state = 'AL' and county in ('Colbert', 'Franklin', 'Lawrence')
   and identifier_fields = '[]'::jsonb;

update public.county_gis_services
   set identifier_fields = '[{"field":"PPIN","kind":"ppin"}]'::jsonb
 where state = 'AL' and county = 'Lauderdale'
   and identifier_fields = '[]'::jsonb;

update public.county_gis_services
   set identifier_fields = '[{"field":"PIN","kind":"pin"}]'::jsonb
 where state = 'AL' and county in ('Madison', 'Morgan')
   and identifier_fields = '[]'::jsonb;
