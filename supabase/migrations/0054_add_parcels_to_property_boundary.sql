-- 0054: a parcel imported into a property that already has a boundary
-- grows that boundary to take the parcel in.
--
-- Until now a county import could only REPLACE a property's boundary with
-- the merged outline of all its parcels (set_property_boundary_from_parcels,
-- migration 0005) or leave it alone, and it left it alone by default so a
-- drawn or surveyed boundary was never replaced without asking. A parcel
-- added that way was saved with its county boundary but sat outside the
-- property's outline, and the map draws property outlines (the Parcels
-- layer starts off), so the parcel was nowhere to be seen (2026-11-20: two
-- parcels imported from the Property Taxes page).
--
-- This adds the third choice, and the import's new default for a property
-- that has a boundary: union the named parcels INTO the boundary. Nothing
-- already inside the boundary changes. A parcel the boundary already covers
-- (90% or more of it) is left out, so importing the county's version of land
-- a drawn boundary already holds does not add slivers along its edge.
--
-- SECURITY INVOKER like the other boundary functions: RLS decides whether
-- the caller can see the parcels and change the property. Only parcels that
-- belong to the property are used. Returns the property's acres afterward.

create or replace function public.add_parcels_to_property_boundary(
  p_property_id uuid,
  p_parcel_ids  uuid[]
)
returns numeric
language plpgsql
set search_path = public, extensions
as $$
declare
  current_boundary geometry;
  added geometry;
  new_acres numeric;
begin
  select boundary, acres into current_boundary, new_acres
  from public.properties
  where id = p_property_id;
  if not found then
    raise exception 'Property not found';
  end if;

  select st_union(pa.boundary) into added
  from public.parcels pa
  where pa.property_id = p_property_id
    and pa.id = any (p_parcel_ids)
    and pa.boundary is not null
    and (
      current_boundary is null
      or st_area(st_intersection(pa.boundary, current_boundary)) < 0.9 * st_area(pa.boundary)
    );

  -- Every named parcel is already inside the boundary: nothing to add.
  if added is null then
    return new_acres;
  end if;

  update public.properties
     set boundary = st_multi(st_collectionextract(
           case
             when current_boundary is null then added
             else st_union(current_boundary, added)
           end, 3))
   where id = p_property_id
   returning acres into new_acres;
  if not found then
    raise exception 'Property not found';
  end if;
  return new_acres;
end;
$$;

revoke execute on function public.add_parcels_to_property_boundary(uuid, uuid[]) from public, anon;
grant execute on function public.add_parcels_to_property_boundary(uuid, uuid[]) to authenticated;
