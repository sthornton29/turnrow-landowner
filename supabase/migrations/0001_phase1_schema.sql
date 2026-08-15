-- ============================================================================
-- Turnrow Landowner: Migration 0001, Phase 1 schema
-- Run this in the Supabase SQL editor (or via supabase db push).
-- Assumes PostGIS is already enabled (Supabase installs it in the
-- "extensions" schema; the SQL editor's search_path already includes it).
-- ============================================================================

-- Helper functions live in a "private" schema so they are not exposed
-- through Supabase's auto-generated REST API.
create schema if not exists private;
grant usage on schema private to authenticated;

-- ============================================================================
-- 1. TENANCY: organizations, profiles, invites
-- ============================================================================

create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  organization_id  uuid references public.organizations (id) on delete set null,
  role             text check (role in ('owner', 'member')),
  full_name        text,
  email            text not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
-- organization_id and role stay NULL between signup and accepting an invite.

create table public.invites (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  email            text not null,
  role             text not null default 'member' check (role in ('owner', 'member')),
  invited_by       uuid references public.profiles (id) on delete set null,
  accepted_at      timestamptz,
  created_at       timestamptz not null default now(),
  unique (organization_id, email)
);

-- The calling user's organization. SECURITY DEFINER so RLS policies can use
-- it without recursing into the profiles table's own policies.
create or replace function private.user_org_id()
returns uuid language sql stable security definer set search_path = ''
as $$
  select organization_id from public.profiles where id = (select auth.uid());
$$;

create or replace function private.user_role()
returns text language sql stable security definer set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid());
$$;

grant execute on function private.user_org_id(), private.user_role() to authenticated;

-- Auto-create a profile row whenever a user signs up.
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

-- Signup is INVITE ONLY in Phase 1. Organizations and invites are created by
-- the admin (you) in the Supabase dashboard. Admin workflow for a new customer:
--
--   insert into public.organizations (name) values ('Smith Family Farms');
--   insert into public.invites (organization_id, email, role)
--   values ('<org id from above>', 'customer@example.com', 'owner');
--
-- Then tell the customer to sign up with that email address.

-- Called by the app after signup/login when the user has no organization yet:
-- if a pending invite matches the user's email, join that organization.
create or replace function public.accept_invite()
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  inv record;
  user_email text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if (select organization_id from public.profiles where id = auth.uid()) is not null then
    return false;
  end if;
  select email into user_email from auth.users where id = auth.uid();
  select * into inv from public.invites
  where lower(email) = lower(user_email) and accepted_at is null
  order by created_at
  limit 1;
  if inv.id is null then
    return false;
  end if;
  update public.profiles set organization_id = inv.organization_id, role = inv.role
  where id = auth.uid();
  update public.invites set accepted_at = now() where id = inv.id;
  return true;
end;
$$;

-- ============================================================================
-- 2. LAND: properties, parcels, fields
--    All geometry is MultiPolygon, SRID 4326 (plain lat/lng, what Mapbox and
--    GeoJSON use). Acres = square meters / 4046.8564224, computed by Postgres
--    in a generated column so it can never drift out of sync with the shape.
-- ============================================================================

create table public.properties (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null,
  county           text,
  state            text,
  notes            text,
  boundary         geometry(MultiPolygon, 4326),
  acres            numeric generated always as
                     (st_area(boundary::geography) / 4046.8564224) stored,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (id, organization_id)   -- target for the composite FKs below
);

create table public.parcels (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  property_id      uuid not null,
  parcel_number    text not null,
  county           text,
  notes            text,
  boundary         geometry(MultiPolygon, 4326),
  acres            numeric generated always as
                     (st_area(boundary::geography) / 4046.8564224) stored,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- composite FK: the parent property must belong to the SAME organization,
  -- so a row can never point at another tenant's property
  foreign key (property_id, organization_id)
    references public.properties (id, organization_id) on delete cascade
);

create table public.fields (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  property_id      uuid not null,
  name             text not null,
  notes            text,
  boundary         geometry(MultiPolygon, 4326),
  acres            numeric generated always as
                     (st_area(boundary::geography) / 4046.8564224) stored,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  foreign key (property_id, organization_id)
    references public.properties (id, organization_id) on delete cascade
);

-- ============================================================================
-- 3. DOCUMENTS: generic attachments, reused by every later phase
-- ============================================================================

create table public.documents (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  entity_type      text not null check (entity_type in ('property', 'parcel', 'field')),
                   -- later phases extend this list: asset, lease, timber_sale,
                   -- tax_statement... (one-line ALTER of this constraint)
  entity_id        uuid not null,
  file_name        text not null,
  storage_path     text not null,   -- path within the 'documents' storage bucket
  content_type     text,
  size_bytes       bigint,
  uploaded_by      uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now()
);

-- ============================================================================
-- 4. GeoJSON read views + boundary write function
--    Supabase's REST API returns raw geometry as binary hex, so the app reads
--    boundaries through these views (st_asgeojson) and writes them through
--    set_boundary(). security_invoker means RLS still applies to the caller.
-- ============================================================================

create view public.properties_geo with (security_invoker = true) as
select id, organization_id, name, county, state, notes, acres,
       st_asgeojson(boundary)::json as boundary_geojson, created_at, updated_at
from public.properties;

create view public.parcels_geo with (security_invoker = true) as
select id, organization_id, property_id, parcel_number, county, notes, acres,
       st_asgeojson(boundary)::json as boundary_geojson, created_at, updated_at
from public.parcels;

create view public.fields_geo with (security_invoker = true) as
select id, organization_id, property_id, name, notes, acres,
       st_asgeojson(boundary)::json as boundary_geojson, created_at, updated_at
from public.fields;

grant select on public.properties_geo, public.parcels_geo, public.fields_geo
  to authenticated;

-- Saves a boundary from GeoJSON: repairs invalid rings (st_makevalid), keeps
-- only polygon parts, wraps single polygons as MultiPolygon, then updates the
-- row. SECURITY INVOKER (the default), so RLS guarantees the caller can only
-- touch rows in their own organization. Returns the recomputed acres.
create or replace function public.set_boundary(
  p_entity_type text,
  p_entity_id   uuid,
  p_geojson     jsonb
)
returns numeric
language plpgsql
set search_path = public, extensions
as $$
declare
  g geometry;
  new_acres numeric;
begin
  if p_geojson is null then
    g := null;
  else
    g := st_multi(st_collectionextract(st_makevalid(
           st_setsrid(st_geomfromgeojson(p_geojson::text), 4326)), 3));
    if g is null or st_isempty(g) then
      raise exception 'Geometry contains no polygon';
    end if;
  end if;

  if p_entity_type = 'property' then
    update public.properties set boundary = g where id = p_entity_id
      returning acres into new_acres;
  elsif p_entity_type = 'parcel' then
    update public.parcels set boundary = g where id = p_entity_id
      returning acres into new_acres;
  elsif p_entity_type = 'field' then
    update public.fields set boundary = g where id = p_entity_id
      returning acres into new_acres;
  else
    raise exception 'Unknown entity type %', p_entity_type;
  end if;

  if not found then
    raise exception 'Row not found';
  end if;
  return new_acres;
end;
$$;

-- ============================================================================
-- 5. updated_at maintenance + indexes
-- ============================================================================

create or replace function private.set_updated_at()
returns trigger language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_updated_at before update on public.organizations
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.properties
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.parcels
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.fields
  for each row execute function private.set_updated_at();

create index profiles_org_idx     on public.profiles (organization_id);
create index invites_org_idx      on public.invites (organization_id);
create index invites_email_idx    on public.invites (lower(email));
create index properties_org_idx   on public.properties (organization_id);
create index parcels_org_idx      on public.parcels (organization_id);
create index parcels_prop_idx     on public.parcels (property_id);
create index fields_org_idx       on public.fields (organization_id);
create index fields_prop_idx      on public.fields (property_id);
create index documents_org_idx    on public.documents (organization_id);
create index documents_entity_idx on public.documents (entity_type, entity_id);
-- spatial indexes for map queries
create index properties_boundary_gix on public.properties using gist (boundary);
create index parcels_boundary_gix    on public.parcels using gist (boundary);
create index fields_boundary_gix     on public.fields using gist (boundary);

-- ============================================================================
-- 6. ROW LEVEL SECURITY
-- ============================================================================

alter table public.organizations enable row level security;
alter table public.profiles      enable row level security;
alter table public.invites       enable row level security;
alter table public.properties    enable row level security;
alter table public.parcels       enable row level security;
alter table public.fields        enable row level security;
alter table public.documents     enable row level security;

-- organizations: members see their org; only owners rename it.
-- No direct insert/delete from the app; orgs are created by the admin.
create policy org_select on public.organizations for select to authenticated
  using (id = private.user_org_id());
create policy org_update on public.organizations for update to authenticated
  using (id = private.user_org_id() and private.user_role() = 'owner')
  with check (id = private.user_org_id());

-- profiles: see yourself and your teammates; edit only your own row.
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or organization_id = private.user_org_id());
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
-- Belt and suspenders: users may only edit their display name directly.
-- org and role changes happen only through the functions above.
revoke update on public.profiles from authenticated;
grant update (full_name) on public.profiles to authenticated;

-- invites: visible to the org; only owners create or revoke them.
create policy invites_select on public.invites for select to authenticated
  using (organization_id = private.user_org_id());
create policy invites_insert on public.invites for insert to authenticated
  with check (organization_id = private.user_org_id() and private.user_role() = 'owner');
create policy invites_delete on public.invites for delete to authenticated
  using (organization_id = private.user_org_id() and private.user_role() = 'owner');

-- land + documents: full access within your own organization.
create policy properties_all on public.properties for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());
create policy parcels_all on public.parcels for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());
create policy fields_all on public.fields for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());
create policy documents_all on public.documents for all to authenticated
  using (organization_id = private.user_org_id())
  with check (organization_id = private.user_org_id());

-- ============================================================================
-- 7. STORAGE: private 'documents' bucket. Files are stored under
--    <organization_id>/<entity_type>/<document_id>-<filename> so the first
--    path segment ties every object to a tenant.
-- ============================================================================

insert into storage.buckets (id, name, public) values ('documents', 'documents', false);

create policy docs_storage_select on storage.objects for select to authenticated
  using (bucket_id = 'documents'
         and (storage.foldername(name))[1] = private.user_org_id()::text);
create policy docs_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'documents'
              and (storage.foldername(name))[1] = private.user_org_id()::text);
create policy docs_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'documents'
         and (storage.foldername(name))[1] = private.user_org_id()::text);
