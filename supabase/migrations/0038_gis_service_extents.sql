-- 0038: Coverage extent (WGS84 bbox) per county GIS service.
--
-- Captured automatically by the admin add/verify test query and
-- backfilled by the existing Re-verify action (both ask the county
-- server for the layer extent with outSR=4326, so no local projection
-- math). The map's Neighbors overlay uses extents to pick which
-- service(s) cover the current viewport, including a viewport that
-- straddles two counties. Null until the service is (re-)verified;
-- a null-extent service is skipped by the overlay, never guessed at.
--
-- Re-runnable. No RLS change: reads are already open to all signed-in
-- users and writes are already platform-admin only (migration 0005).

alter table public.county_gis_services
  add column if not exists extent_xmin double precision,
  add column if not exists extent_ymin double precision,
  add column if not exists extent_xmax double precision,
  add column if not exists extent_ymax double precision;

comment on column public.county_gis_services.extent_xmin is
  'Layer coverage extent, WGS84 lon/lat. Null until re-verified; the Neighbors overlay skips null-extent services.';
