-- ============================================================================
-- Turnrow Landowner: Migration 0013
-- New asset type: irrigation_lateral (linear / lateral move machines).
-- Coverage is the drawn travel path swept by the machine length; the
-- parameters live in details jsonb like pivot circles, so this is only
-- a widening of the asset_type check. Run after 0012.
-- ============================================================================

set search_path = public, extensions;

alter table public.assets drop constraint assets_asset_type_check;
alter table public.assets add constraint assets_asset_type_check
  check (asset_type in
    ('well', 'irrigation_pivot', 'irrigation_lateral', 'underground_pipe',
     'riser', 'shop', 'shed', 'barn', 'grain_bin', 'house', 'fence',
     'pond_dam', 'other'));
