-- ============================================================================
-- Turnrow Landowner: Migration 0035
-- GRAIN BIN SITES AND CAPACITY-FIRST BINS.
--
-- 1. New asset type 'grain_bin_site': a pin or outline that groups the
--    individual grain_bin assets standing on it (children link through
--    the existing parent_asset_id; deleting a site detaches its bins,
--    never deletes them - the FK is already ON DELETE SET NULL).
-- 2. Grain bins lose the circle placement: every bin that was drawn as
--    a parametric circle becomes a PIN at its circle center, keeping
--    capacity and every other detail. The circle bookkeeping keys
--    (footprint_shape, center_lon, center_lat) and the retired
--    diameter_ft field are removed from details. The migration RAISEs
--    a NOTICE with how many bins it converted - read it in the SQL
--    editor output and note it in the deploy checklist.
-- Run after 0034.
-- ============================================================================

set search_path = public, extensions;

-- 1. The asset type list gains grain_bin_site.
alter table public.assets drop constraint assets_asset_type_check;
alter table public.assets add constraint assets_asset_type_check
  check (asset_type in
    ('well', 'irrigation_pivot', 'underground_pipe', 'riser',
     'shop', 'shed', 'barn', 'grain_bin', 'grain_bin_site', 'house',
     'fence', 'pond_dam', 'other'));

-- 2. Circle-drawn grain bins become pins at their circle centers.
--    (The assets geometry check already allows Point.)
do $$
declare
  migrated integer;
begin
  update public.assets
  set geom = st_setsrid(st_makepoint(
        (details ->> 'center_lon')::float8,
        (details ->> 'center_lat')::float8), 4326),
      details = details - 'footprint_shape' - 'center_lon' - 'center_lat'
                        - 'diameter_ft'
  where asset_type = 'grain_bin'
    and details ->> 'footprint_shape' = 'circle'
    and details ->> 'center_lon' is not null
    and details ->> 'center_lat' is not null;
  get diagnostics migrated = row_count;
  raise notice 'Converted % circle-drawn grain bin(s) to pins at their centers', migrated;

  -- Belt and suspenders: a circle-flagged bin somehow missing its
  -- center keeps its polygon but still sheds the circle keys, so the
  -- app never reopens the circle editor for a bin.
  update public.assets
  set details = details - 'footprint_shape' - 'diameter_ft'
  where asset_type = 'grain_bin'
    and details ? 'footprint_shape';
  get diagnostics migrated = row_count;
  if migrated > 0 then
    raise notice '% grain bin(s) had circle flags without a stored center; flags cleared, geometry kept', migrated;
  end if;
end $$;
