import type { MultiPolygon } from "geojson";

// Row shapes as the app reads them (geometry comes from the *_geo views
// as parsed GeoJSON).

export type Role = "owner" | "member";

export interface Organization {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  organization_id: string | null;
  role: Role | null;
  full_name: string | null;
  email: string;
  created_at: string;
  updated_at: string;
}

export interface Invite {
  id: string;
  organization_id: string;
  email: string;
  role: Role;
  invited_by: string | null;
  accepted_at: string | null;
  created_at: string;
}

export interface PropertyGeo {
  id: string;
  organization_id: string;
  name: string;
  county: string | null;
  state: string | null;
  notes: string | null;
  acres: number | null;
  boundary_geojson: MultiPolygon | null;
  created_at: string;
  updated_at: string;
}

export interface ParcelGeo {
  id: string;
  organization_id: string;
  property_id: string;
  parcel_number: string;
  county: string | null;
  notes: string | null;
  acres: number | null;
  boundary_geojson: MultiPolygon | null;
  created_at: string;
  updated_at: string;
}

export interface FieldGeo {
  id: string;
  organization_id: string;
  property_id: string;
  name: string;
  notes: string | null;
  acres: number | null;
  boundary_geojson: MultiPolygon | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentRow {
  id: string;
  organization_id: string;
  entity_type: "property" | "parcel" | "field";
  entity_id: string;
  file_name: string;
  storage_path: string;
  content_type: string | null;
  size_bytes: number | null;
  uploaded_by: string | null;
  created_at: string;
}

// The three boundary-bearing entity types, used by the map and import pages.
export type EntityType = "property" | "parcel" | "field";
