-- ============================================================================
-- Turnrow Landowner: Migration 0026
-- The documents bucket's own size cap (200 MB from 0025) sat BELOW the
-- project-wide upload limit raised in the dashboard, so large FSA
-- packets still failed. Remove the bucket cap; the project-wide
-- Storage > Settings limit is the single control.
-- Run after 0025.
-- ============================================================================

update storage.buckets
set file_size_limit = null
where id = 'documents';
