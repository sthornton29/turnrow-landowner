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
  entity_id: string | null;
  fsa_numbers: string[] | null;
}

// The ownership level above properties: LLCs, corporations, trusts, and
// individuals. Unified with the county-records owner matching: aliases
// (entity_aliases) hang off these same rows.
export type LandEntityType =
  | "individual"
  | "llc"
  | "corporation"
  | "partnership"
  | "trust"
  | "estate"
  | "other";

export interface LandEntity {
  id: string;
  organization_id: string;
  name: string;
  entity_type: LandEntityType;
  notes: string | null;
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
  irrigated_acres: number | null; // derived in PostGIS from irrigation coverage
  boundary_geojson: MultiPolygon | null;
  created_at: string;
  updated_at: string;
}

export interface PastureGeo {
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

// Open wetlands (marsh, sloughs, duck holes, easement ground); forested
// bottomland stays a timber stand.
export interface WetlandGeo {
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

export type EasementType =
  | "powerline"
  | "pipeline"
  | "waterline_sewer"
  | "telecom_fiber"
  | "access_row"
  | "public_road_row"
  | "railroad"
  | "drainage"
  | "flowage"
  | "conservation"
  | "cemetery_access"
  | "construction_temp"
  | "solar_wind"
  | "other";

export type EasementRelationship =
  | "burdens_this_property"
  | "benefits_this_property";

// Easements (migration 0019; utility_easements before that): every
// recorded right someone else holds over the land, or that the owner
// holds over a neighbor (relationship = benefits_this_property, whose
// geometry may lie outside the property). Each is EITHER a polygon
// (boundary + generated acres) OR a line (geom + generated length).
// NOT the farm's own underground irrigation pipe (that is an asset).
export interface EasementGeo {
  id: string;
  organization_id: string;
  property_id: string | null;
  name: string;
  easement_type: EasementType;
  relationship: EasementRelationship;
  holder: string | null;
  recorded_ref: string | null;
  expiration_date: string | null; // null = permanent / indefinite
  width_ft: number | null; // informational on line easements
  elevation_ft: number | null; // flowage contour
  program: string | null; // conservation program / holder detail
  restrictions: string | null; // conservation restrictions notes
  notes: string | null;
  acres: number | null;
  length_feet: number | null;
  miles: number | null;
  boundary_geojson: MultiPolygon | null;
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
  | "tax_statement"
  | "entity";

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
  | "pasture"
  | "wetland"
  | "timber_stand"
  | "road"
  | "easement"
  | "asset";
