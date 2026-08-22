-- ============================================================================
-- Turnrow Landowner: Migration 0031
-- Tenant farming entities from the farm API (PARTNER_API.md, operating
-- entities section): the share's farming entities on the connection,
-- the field's entity on every mapping, planting, and projected yield
-- row, per-entity marketing prices beside the whole-operation rows, and
-- an optional link from a landowner-side tenant to one farming entity
-- of one connection. Everything is nullable: a pre-entity farm API
-- leaves all of it null and nothing new renders. Run after 0030.
-- ============================================================================

set search_path = public, extensions;

alter table public.farm_connections
  add column entities jsonb not null default '[]';   -- [{ id, name, field_count }]

alter table public.field_mappings
  add column remote_entity_id   text,
  add column remote_entity_name text;

alter table public.farm_field_data
  add column remote_entity_id   text,
  add column remote_entity_name text;

alter table public.farm_projected_yields
  add column remote_entity_id text;

-- Prices: null remote_entity_id = the whole operation (the row the API
-- calls data[]); per-entity rows come from by_entity[].
alter table public.farm_marketing_prices
  add column remote_entity_id   text,
  add column remote_entity_name text;
alter table public.farm_marketing_prices
  drop constraint farm_marketing_prices_farm_connection_id_crop_year_crop_key;
create unique index farm_marketing_prices_scope_key
  on public.farm_marketing_prices (farm_connection_id, crop_year, crop, coalesce(remote_entity_id, ''));

-- A landowner-side tenant may be one farming entity of one connection.
alter table public.tenants
  add column farm_connection_id uuid,
  add column farm_entity_id     text,
  add column farm_entity_name   text;
alter table public.tenants
  add constraint tenants_farm_connection_fkey
  foreign key (farm_connection_id, organization_id)
  references public.farm_connections (id, organization_id)
  on delete set null (farm_connection_id);

create index farm_field_data_entity_idx on public.farm_field_data (farm_connection_id, remote_entity_id);
