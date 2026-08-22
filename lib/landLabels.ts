// One place for how each mappable land type is NAMED in the UI. The
// stored type values (the EntityType union, table names, 'pasture' on
// pastures rows) never change; only these labels do. "Pasture" reads
// "Pasture/Grassland" everywhere since 2026-08-22.

export interface LandTypeLabel {
  singular: string;
  plural: string;
}

export const LAND_TYPE_LABELS: Record<string, LandTypeLabel> = {
  property: { singular: "Property", plural: "Properties" },
  parcel: { singular: "Parcel", plural: "Parcels" },
  field: { singular: "Ag field", plural: "Ag fields" },
  pasture: { singular: "Pasture/Grassland", plural: "Pastures/Grassland" },
  wetland: { singular: "Wetland", plural: "Wetlands" },
  timber_stand: { singular: "Timber stand", plural: "Timber stands" },
  road: { singular: "Road", plural: "Roads" },
  easement: { singular: "Easement", plural: "Easements" },
  asset: { singular: "Asset", plural: "Assets" },
  cemetery: { singular: "Cemetery", plural: "Cemeteries" },
  maintenance_issue: { singular: "Maintenance issue", plural: "Maintenance issues" },
};

export function landTypeLabel(type: string, form: "singular" | "plural" = "singular"): string {
  return LAND_TYPE_LABELS[type]?.[form] ?? type;
}
