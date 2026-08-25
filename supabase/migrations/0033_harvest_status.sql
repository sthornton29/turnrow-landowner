-- 0033: per-field-per-crop harvest completion from the farm software.
--
-- The partner API's /production rows now carry harvest_status
-- ("complete" | "in_progress" | "unharvested"), the same classification
-- the tenant's own Yields page shows. The sync stores it here; a yield
-- presents as ACTUAL only when the field x crop is complete. Null means
-- the row was synced before the farm side sent statuses (the app falls
-- back to the old harvested-acres inference until the next sync).

alter table public.farm_field_data
  add column harvest_status text
  check (harvest_status in ('complete', 'in_progress', 'unharvested'));
