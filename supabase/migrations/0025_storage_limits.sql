-- ============================================================================
-- Turnrow Landowner: Migration 0025
-- Larger documents: the private "documents" bucket accepts files up to
-- 200 MB (multi-farm FSA-156EZ packets, scanned deed books, survey
-- sets) with no MIME restriction. NOTE: the project-wide upload limit
-- in the Supabase dashboard (Storage > Settings > Upload file size
-- limit) still caps every bucket; raise it there too (the Free plan
-- tops out at 50 MB, Pro allows up to 50 GB). Scans in the app work
-- best under 100 pages per file; the extraction route splits bigger
-- PDFs into chunks itself.
-- Run after 0024.
-- ============================================================================

update storage.buckets
set file_size_limit = 209715200,
    allowed_mime_types = null
where id = 'documents';
