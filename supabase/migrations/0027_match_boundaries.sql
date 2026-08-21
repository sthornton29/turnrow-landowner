-- ============================================================================
-- Turnrow Landowner: Migration 0027
-- match_boundaries(geojson): which of the caller's properties and parcels
-- a described polygon (a resolved legal description) overlaps, with the
-- overlap in acres and as a share of the described area and of the
-- boundary. SECURITY INVOKER, so the properties/parcels row level
-- security policies apply to the caller exactly as on the pages: a
-- tenant can only ever see overlaps with its own boundaries. Used by the
-- document intake's spatial matching tier (the strongest association
-- evidence, shown only when this intersection actually computed).
-- Run after 0026.
-- ============================================================================

set search_path = public, extensions;

create or replace function public.match_boundaries(p_geojson jsonb)
returns table (
  entity_type       text,
  id                uuid,
  name              text,
  overlap_acres     numeric,
  pct_of_described  numeric,
  pct_of_boundary   numeric
)
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  g geometry;
  described_sqm double precision;
begin
  if p_geojson is null then
    return;
  end if;
  g := st_multi(st_collectionextract(
         st_makevalid(st_setsrid(st_geomfromgeojson(p_geojson::text), 4326)), 3));
  if g is null or st_isempty(g) then
    return;
  end if;
  described_sqm := st_area(g::geography);
  if described_sqm is null or described_sqm <= 0 then
    return;
  end if;

  return query
  with hits as (
    select 'property'::text as entity_type, p.id, p.name::text as name, p.boundary as boundary
    from public.properties p
    where p.boundary is not null and st_intersects(p.boundary, g)
    union all
    select 'parcel'::text, pc.id, pc.parcel_number::text, pc.boundary
    from public.parcels pc
    where pc.boundary is not null and st_intersects(pc.boundary, g)
  ),
  measured as (
    select h.entity_type, h.id, h.name,
           st_area(st_intersection(h.boundary, g)::geography) as overlap_sqm,
           st_area(h.boundary::geography) as boundary_sqm
    from hits h
  )
  select m.entity_type, m.id, m.name,
         round((m.overlap_sqm / 4046.8564224)::numeric, 1) as overlap_acres,
         round((m.overlap_sqm / described_sqm * 100)::numeric, 1) as pct_of_described,
         case when m.boundary_sqm > 0
              then round((m.overlap_sqm / m.boundary_sqm * 100)::numeric, 1)
              else null end as pct_of_boundary
  from measured m
  where m.overlap_sqm > 0
  order by m.overlap_sqm desc;
end;
$$;

revoke all on function public.match_boundaries(jsonb) from public;
grant execute on function public.match_boundaries(jsonb) to authenticated;
