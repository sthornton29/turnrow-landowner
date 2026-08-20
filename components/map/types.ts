import type {
  AssetGeo,
  EntityType,
  FieldGeo,
  ParcelGeo,
  PastureGeo,
  PropertyGeo,
  RoadGeo,
  TimberStandGeo,
  EasementGeo,
  WetlandGeo,
} from "@/types/db";

export type MapMode = "view" | "draw" | "edit" | "place" | "split" | "pivot" | "circle";

export interface SelectedFeature {
  entityType: EntityType;
  id: string;
}

export type AnyGeoRow =
  | PropertyGeo
  | ParcelGeo
  | FieldGeo
  | PastureGeo
  | WetlandGeo
  | TimberStandGeo
  | RoadGeo
  | EasementGeo
  | AssetGeo;

export interface LayerVisibility {
  property: boolean;
  parcel: boolean;
  field: boolean;
  pasture: boolean;
  wetland: boolean;
  timber_stand: boolean;
  road: boolean;
  easement: boolean;
  asset: boolean;
}

// Pick-first draw sessions: what the Add menu chose (components/map/
// DrawTypePicker.tsx) fixes the draw tool, draft color, and save form.
