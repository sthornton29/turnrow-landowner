import type { EntityType, FieldGeo, ParcelGeo, PropertyGeo } from "@/types/db";

export type MapMode = "view" | "draw" | "edit";

export interface SelectedFeature {
  entityType: EntityType;
  id: string;
}

export type AnyGeoRow = PropertyGeo | ParcelGeo | FieldGeo;

export interface LayerVisibility {
  property: boolean;
  parcel: boolean;
  field: boolean;
}
