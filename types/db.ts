import type { Geometry, MultiLineString, MultiPolygon } from "geojson";

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
  is_platform_admin: boolean;
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
  deeded_acres: number | null;
  source: string | null;
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

export type AssetType =
  | "well"
  | "irrigation_pivot"
  | "underground_pipe"
  | "riser"
  | "shop"
  | "shed"
  | "barn"
  | "grain_bin"
  | "house"
  | "fence"
  | "pond_dam"
  | "other";

export type StandType =
  | "planted_pine"
  | "natural_pine"
  | "hardwood"
  | "mixed"
  | "other";

export type RoadType = "gravel" | "dirt" | "paved" | "field_road" | "other";

export type Condition = "excellent" | "good" | "fair" | "poor";

export interface TimberStandGeo {
  id: string;
  organization_id: string;
  property_id: string;
  name: string;
  stand_type: StandType | null;
  species: string | null;
  year_established: number | null;
  site_index: number | null;
  last_thinning_year: number | null;
  last_burn_year: number | null;
  notes: string | null;
  acres: number | null;
  boundary_geojson: MultiPolygon | null;
  created_at: string;
  updated_at: string;
}

export interface RoadGeo {
  id: string;
  organization_id: string;
  property_id: string;
  name: string;
  road_type: RoadType | null;
  notes: string | null;
  length_feet: number | null;
  miles: number | null;
  geom_geojson: MultiLineString | null;
  created_at: string;
  updated_at: string;
}

export interface AssetGeo {
  id: string;
  organization_id: string;
  property_id: string | null;
  asset_type: AssetType;
  name: string;
  year_installed: number | null;
  condition: Condition | null;
  estimated_value: number | null;
  notes: string | null;
  details: Record<string, string | number | boolean | null>;
  parent_asset_id: string | null;
  is_active: boolean;
  geom_geojson: Geometry | null;
  created_at: string;
  updated_at: string;
}

// Everything documents can attach to (map entities plus Phase 3 records).
export type DocumentEntityType =
  | EntityType
  | "tenant"
  | "lease"
  | "timber_sale"
  | "tax_statement";

export interface DocumentRow {
  id: string;
  organization_id: string;
  entity_type: DocumentEntityType;
  entity_id: string;
  file_name: string;
  storage_path: string;
  content_type: string | null;
  size_bytes: number | null;
  uploaded_by: string | null;
  created_at: string;
}

// Every entity that can appear on the map or carry documents.
export type EntityType =
  | "property"
  | "parcel"
  | "field"
  | "timber_stand"
  | "road"
  | "asset";
