-- 0041: drop lease_assumption_drift (superseded same-day).
--
-- 0040 introduced drift flags so committed tenant-sourced assumption
-- values could be accepted per value when the cache moved. The design
-- changed before anyone used it: tenant data now flows into lease
-- assumptions AUTOMATICALLY on every sync (lib/tenantAutoFill.ts fills
-- empty and tenant-tagged values; hand-edited values are never touched),
-- so nothing ever waits for acceptance and the table has no readers.
-- 0040's farm_connections columns (scopes_checked_at, sync_detail) stay.
--
-- Re-runnable.

set search_path = public, extensions;

drop table if exists public.lease_assumption_drift;
