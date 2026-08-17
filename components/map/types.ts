import type {
  AssetGeo,
  EntityType,
  FieldGeo,
  ParcelGeo,
  PastureGeo,
  PropertyGeo,
  RoadGeo,
  TimberStandGeo,
} from "@/types/db";

export type MapMode = "view" | "draw" | "edit" | "place" | "split" | "pivot";

export interface SelectedFeature {
  entityType: EntityType;
  id: string;
}

export type AnyGeoRow =
  | PropertyGeo
  | ParcelGeo
  | FieldGeo
  | PastureGeo
  | TimberStandGeo
  | RoadGeo
  | AssetGeo;

export interface LayerVisibility {
  property: boolean;
  parcel: boolean;
  field: boolean;
  pasture: boolean;
  timber_stand: boolean;
  road: boolean;
  asset: boolean;
}

// What the user chose from the Add menu; decides the draw mode and which
// save dialog opens when the geometry is finished.
export type AddKind = "boundary" | "road" | "asset_line" | "asset_point";
