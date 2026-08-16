-- ============================================================================
-- Turnrow Landowner: Migration 0008
-- Five Alabama counties for the county GIS registry, live-verified
-- 2026-08-16 the same way the Phase 5 seeds were: layer metadata read,
-- parcel/owner fields identified from a sample record, and an owner LIKE
-- query with f=geojson returned real parcels with geometry. Run after 0007.
-- ============================================================================

set search_path = public, extensions;

insert into public.county_gis_services
  (state, county, display_name, service_url, layer_id,
   parcel_field, owner_field, acres_field, situs_field,
   status, last_verified_at, notes)
values
  ('AL', 'Morgan', 'Morgan County, Alabama',
   'https://web5.kcsgis.com/kcsgis/rest/services/Morgan/Public/MapServer', 118,
   'PARCELID', 'Owner', 'TotalAcres', 'PropAddr1',
   'active', now(),
   'KCS-hosted MapServer. Live-verified 2026-08-16. TotalAcres is 0 on many city lots but populated on rural parcels.'),
  ('AL', 'Lauderdale', 'Lauderdale County, Alabama',
   'https://web5.kcsgis.com/kcsgis/rest/services/Lauderdale/Public/MapServer', 120,
   'ParcelNum', 'Owner', 'DeededAcres', 'PhysAddr',
   'active', now(),
   'KCS-hosted MapServer. Live-verified 2026-08-16. Owner names sometimes comma-formatted (HUGHES, NATHAN).'),
  ('AL', 'Limestone', 'Limestone County, Alabama',
   'https://gis.limestonecounty-al.gov/arcgis/rest/services/Limestone_Parcels/MapServer', 0,
   'ParcelNo', 'OwnerName', null, 'PropertyAddr1',
   'active', now(),
   'County-run ArcGIS server (KCS-built data). Live-verified 2026-08-16. No deeded-acres field (CALC_ACRE is GIS-computed, StatedArea empty), so the app computes GIS acres. Values are space-padded; the proxy trims.'),
  ('AL', 'Madison', 'Madison County, Alabama',
   'https://web3.kcsgis.com/kcsgis/rest/services/Madison/Madison_Public_ISV/MapServer', 185,
   'ParcelNum', 'PropertyOwner', 'Acres', 'PropertyAddress',
   'active', now(),
   'KCS-hosted MapServer behind the county revenue ISV (the viewer itself is login-gated; this service is public). Live-verified 2026-08-16.'),
  ('AL', 'Franklin', 'Franklin County, Alabama',
   'https://web6.kcsgis.com/kcsgis/rest/services/Franklin/Franklin_Public_ISV/MapServer', 105,
   'ParcelID_GISlink', 'Owner', 'DeededAcres', null,
   'active', now(),
   'KCS-hosted MapServer behind the county ISV. Live-verified 2026-08-16. Layer 105 is the assessment parcels layer (layer 108 TaxParcel has no owner field).')
on conflict (service_url, layer_id) do nothing;
