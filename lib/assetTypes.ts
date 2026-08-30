import type { AssetType } from "@/types/db";

// Single source of truth for the asset type system. This config drives the
// dynamic entry forms, the detail panels, and the map markers, so
// type-specific fields stay structured (never free-form JSON editing).

export interface DetailField {
  key: string;
  label: string;
  input: "text" | "number" | "select" | "boolean";
  options?: Array<{ value: string; label: string }>;
  unit?: string; // display suffix, e.g. "ft", "gpm", "bu"
  dollars?: boolean;
  // Written by a map editor (pivot coverage circle parameters), never
  // hand-edited in the asset form: cleanDetails carries the stored
  // value through and the form shows it read-only at most.
  mapManaged?: boolean;
}

export interface AssetTypeDef {
  label: string;
  letter: string; // map marker letter
  defaultGeometry: "point" | "line";
  // Parent link through assets.parent_asset_id: a pivot/pipe/riser
  // points at its supply well, a grain bin at its bin site. The label
  // names the selector in forms.
  parentType?: AssetType;
  parentLabel?: string;
  // Circle placement is offered to every point type EXCEPT these
  // (grain bins are pins or outlines; capacity is their number).
  noCircle?: boolean;
  fields: DetailField[];
}

const opts = (...values: Array<[string, string]>) =>
  values.map(([value, label]) => ({ value, label }));

const buildingFields: DetailField[] = [
  { key: "dimensions", label: "Dimensions or sq ft", input: "text" },
  {
    key: "construction",
    label: "Construction",
    input: "select",
    options: opts(
      ["metal", "Metal"],
      ["pole_barn", "Pole barn"],
      ["wood_frame", "Wood frame"],
      ["block", "Block"]
    ),
  },
  { key: "concrete_floor", label: "Concrete floor", input: "boolean" },
  { key: "electricity", label: "Electricity", input: "boolean" },
  { key: "water", label: "Water", input: "boolean" },
  { key: "insured_value", label: "Insured value", input: "number", dollars: true },
];

export const ASSET_TYPES: Record<AssetType, AssetTypeDef> = {
  well: {
    label: "Well",
    letter: "W",
    defaultGeometry: "point",
    fields: [
      { key: "total_depth_ft", label: "Total depth", input: "number", unit: "ft" },
      { key: "casing_diameter_in", label: "Casing diameter", input: "number", unit: "in" },
      { key: "rated_gpm", label: "Rated GPM", input: "number", unit: "gpm" },
      {
        key: "pump_type",
        label: "Pump type",
        input: "select",
        options: opts(
          ["submersible", "Submersible"],
          ["turbine", "Turbine"],
          ["centrifugal", "Centrifugal"]
        ),
      },
      { key: "pump_hp", label: "Pump HP", input: "number", unit: "hp" },
      {
        key: "power_source",
        label: "Power source",
        input: "select",
        options: opts(
          ["electric_single_phase", "Electric, single phase"],
          ["electric_three_phase", "Electric, three phase"],
          ["diesel", "Diesel"],
          ["pto", "PTO"]
        ),
      },
      { key: "year_drilled", label: "Year drilled", input: "number" },
      { key: "driller", label: "Driller", input: "text" },
      { key: "permit_number", label: "Permit / registration number", input: "text" },
      { key: "static_water_level_ft", label: "Static water level", input: "number", unit: "ft" },
    ],
  },
  irrigation_pivot: {
    label: "Irrigation pivot",
    letter: "P",
    defaultGeometry: "point",
    parentType: "well",
    parentLabel: "Supply well",
    fields: [
      {
        key: "make",
        label: "Make",
        input: "select",
        options: opts(
          ["valley", "Valley"],
          ["zimmatic", "Zimmatic"],
          ["reinke", "Reinke"],
          ["tl", "T-L"],
          ["pierce", "Pierce"],
          ["other", "Other"]
        ),
      },
      { key: "model", label: "Model", input: "text" },
      { key: "year", label: "Year", input: "number" },
      { key: "wetted_length_ft", label: "Wetted length", input: "number", unit: "ft" },
      { key: "towers", label: "Number of towers", input: "number" },
      { key: "end_gun", label: "End gun", input: "boolean" },
      { key: "swing_arm", label: "Swing arm / corner", input: "boolean" },
      { key: "acres_covered", label: "Acres covered", input: "number", unit: "ac" },
      { key: "panel_type", label: "Panel type", input: "text" },
      { key: "supply_source", label: "Supply source", input: "text" },
      { key: "serial_number", label: "Serial number", input: "text" },
      // Coverage circle parameters, managed by the map's pivot editor.
      // The polygon is DERIVED from these and regenerated on every
      // parametric edit; wetted_length_ft doubles as the base radius.
      { key: "center_lon", label: "Center longitude", input: "number", mapManaged: true },
      { key: "center_lat", label: "Center latitude", input: "number", mapManaged: true },
      { key: "full_circle", label: "Full circle", input: "boolean", mapManaged: true },
      { key: "start_bearing_deg", label: "Start bearing", input: "number", mapManaged: true },
      { key: "end_bearing_deg", label: "End bearing", input: "number", mapManaged: true },
      // Manually drawn coverage shapes: add polygons union in (corner
      // arms, end guns, odd reaches), cut polygons difference out
      // (ponds, waterways, obstacles). Arrays, carried through form
      // saves by cleanDetails like the scalars above.
      { key: "add_polygons", label: "Added areas", input: "text", mapManaged: true },
      { key: "cut_polygons", label: "Cut areas", input: "text", mapManaged: true },
      { key: "acres_watered", label: "Gross watered acres", input: "number", mapManaged: true },
    ],
  },
  underground_pipe: {
    label: "Underground pipe",
    letter: "U",
    defaultGeometry: "line",
    parentType: "well",
    parentLabel: "Supply well",
    fields: [
      { key: "diameter_in", label: "Diameter", input: "number", unit: "in" },
      {
        key: "material",
        label: "Material",
        input: "select",
        options: opts(
          ["pvc", "PVC"],
          ["pip_pvc", "PIP PVC"],
          ["steel", "Steel"],
          ["aluminum", "Aluminum"],
          ["hdpe", "HDPE"]
        ),
      },
      { key: "depth_ft", label: "Approximate depth", input: "number", unit: "ft" },
    ],
  },
  riser: {
    label: "Riser",
    letter: "R",
    defaultGeometry: "point",
    parentType: "well",
    parentLabel: "Supply well",
    fields: [
      { key: "size_in", label: "Size", input: "number", unit: "in" },
      {
        key: "riser_type",
        label: "Type",
        input: "select",
        options: opts(
          ["alfalfa_valve", "Alfalfa valve"],
          ["hydrant", "Hydrant"],
          ["other", "Other"]
        ),
      },
    ],
  },
  shop: {
    label: "Shop",
    letter: "S",
    defaultGeometry: "point",
    fields: buildingFields,
  },
  shed: {
    label: "Shed",
    letter: "SD",
    defaultGeometry: "point",
    fields: buildingFields,
  },
  barn: {
    label: "Barn",
    letter: "BN",
    defaultGeometry: "point",
    fields: buildingFields,
  },
  grain_bin: {
    label: "Grain bin",
    letter: "B",
    defaultGeometry: "point",
    parentType: "grain_bin_site",
    parentLabel: "Bin site",
    noCircle: true,
    fields: [
      // Capacity is THE grain bin number: the click panel and the asset
      // page lead with it. (The old diameter_ft spec field retired with
      // the circle placement; migration 0035 cleared stored values.)
      { key: "capacity_bu", label: "Capacity", input: "number", unit: "bu" },
      {
        key: "manufacturer",
        label: "Manufacturer",
        input: "select",
        options: opts(
          ["gsi", "GSI"],
          ["sukup", "Sukup"],
          ["butler", "Butler"],
          ["behlen", "Behlen"],
          ["other", "Other"]
        ),
      },
      {
        key: "drying_system",
        label: "Drying system",
        input: "select",
        options: opts(
          ["none", "None"],
          ["aeration_only", "Aeration only"],
          ["in_bin_dryer", "In-bin dryer"],
          ["stirring", "Stirring"]
        ),
      },
      { key: "unload_system", label: "Unload system", input: "boolean" },
    ],
  },
  grain_bin_site: {
    // A pin or outline that groups the bins standing on it; child
    // grain_bin assets link here via parent_asset_id. Panels and pages
    // lead with TOTAL capacity summed from the children.
    label: "Grain bin site",
    letter: "BS",
    defaultGeometry: "point",
    noCircle: true,
    fields: [],
  },
  house: {
    label: "House",
    letter: "H",
    defaultGeometry: "point",
    fields: [
      { key: "square_feet", label: "Square feet", input: "number" },
      { key: "bedrooms", label: "Bedrooms", input: "number" },
      { key: "baths", label: "Baths", input: "number" },
      { key: "occupied", label: "Occupied", input: "boolean" },
      { key: "insured_value", label: "Insured value", input: "number", dollars: true },
    ],
  },
  fence: {
    label: "Fence",
    letter: "F",
    defaultGeometry: "line",
    fields: [
      {
        key: "fence_type",
        label: "Fence type",
        input: "select",
        options: opts(
          ["barbed", "Barbed"],
          ["woven_net", "Woven / net"],
          ["high_tensile", "High tensile"],
          ["board", "Board"]
        ),
      },
    ],
  },
  pond_dam: {
    label: "Pond / dam",
    letter: "PD",
    defaultGeometry: "point",
    fields: [
      { key: "surface_acres", label: "Surface acres", input: "number", unit: "ac" },
      { key: "last_inspection_year", label: "Last inspection year", input: "number" },
    ],
  },
  other: {
    label: "Other",
    letter: "A",
    defaultGeometry: "point",
    fields: [],
  },
};

// Footprint parameters shared by EVERY type (migration-free; details
// jsonb). footprint_shape is 'circle' when the polygon was generated
// from center + diameter_ft by the map's circle editor (lib/geo/
// circle.ts); outline-drawn footprints carry no shape key. Map-managed
// so form saves carry them through. noCircle types (grain bins, bin
// sites) never get the map-managed footprint diameter: the circle
// editor is not offered for them at all.
const FOOTPRINT_FIELDS: DetailField[] = [
  { key: "footprint_shape", label: "Footprint shape", input: "text", mapManaged: true },
  { key: "center_lon", label: "Center longitude", input: "number", mapManaged: true },
  { key: "center_lat", label: "Center latitude", input: "number", mapManaged: true },
];
for (const t of Object.keys(ASSET_TYPES) as AssetType[]) {
  const def = ASSET_TYPES[t];
  const have = new Set(def.fields.map((f) => f.key));
  for (const f of FOOTPRINT_FIELDS) if (!have.has(f.key)) def.fields.push(f);
  if (!def.noCircle && !have.has("diameter_ft")) {
    def.fields.push({ key: "diameter_ft", label: "Footprint diameter", input: "number", unit: "ft", mapManaged: true });
  }
}

export const ASSET_TYPE_ORDER = Object.keys(ASSET_TYPES) as AssetType[];

// Types whose footprint is usually round: the placement picker leads
// with Circle for these (it stays available for every type without
// noCircle). Empty since grain bins retired their circle placement;
// the mechanism stays for future round types.
export const ROUND_ASSET_TYPES: AssetType[] = [];

export function assetTypeLabel(t: AssetType): string {
  return ASSET_TYPES[t]?.label ?? t;
}

// Pull only known, non-empty values out of a submitted form for a type.
// Map-managed fields (pivot circle parameters) are never in the form;
// their stored values carry through so a form save cannot wipe them.
export function cleanDetails(
  assetType: AssetType,
  raw: Record<string, FormDataEntryValue>,
  existing: Record<string, unknown> = {}
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of ASSET_TYPES[assetType].fields) {
    if (field.mapManaged) {
      // Carry stored values through untouched, including arrays and
      // objects (composite pivot zones, lateral paths, cutouts).
      const kept = existing[field.key];
      if (kept !== undefined && kept !== null) out[field.key] = kept;
      continue;
    }
    const v = raw[field.key];
    if (field.input === "boolean") {
      if (v === "on" || v === "true") out[field.key] = true;
      continue;
    }
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (s === "") continue;
    out[field.key] = field.input === "number" ? Number(s) : s;
  }
  return out;
}

export const STAND_TYPE_LABELS: Record<string, string> = {
  planted_pine: "Planted pine",
  natural_pine: "Natural pine",
  hardwood: "Hardwood",
  mixed: "Mixed",
  other: "Other",
};

// Saved timber stand map colors, one per stand_type. Chosen to read over
// satellite and stay distinct from kelly (fields), the crop palette
// (corn #facc15, cotton white, soybeans kelly, wheat #d97706, canola
// #a3e635, other light violet #a78bfa), the entity outline palette, the
// pivot light blues (#7dd3fc/#38bdf8), and the Timber Scan DRAFT
// palette (light amber/sky/violet/teal, dashed): saved stands are solid
// and deep so drafts never look saved. STANDING RULE: timber types
// never use hues adjacent to the field/crop greens (planted pine moved
// from deep forest green to deep teal for exactly this reason).
export const STAND_TYPE_COLORS: Record<string, string> = {
  planted_pine: "#0f766e", // deep teal, unmistakably not a field green
  natural_pine: "#6b8e23", // olive drab
  hardwood: "#c2410c", // burnt orange
  mixed: "#7c3aed", // deep violet
  other: "#6b7280", // gray
};

export const ROAD_TYPE_LABELS: Record<string, string> = {
  gravel: "Gravel",
  dirt: "Dirt",
  paved: "Paved",
  field_road: "Field road / turnrow",
  other: "Other",
};

export const CONDITION_LABELS: Record<string, string> = {
  excellent: "Excellent",
  good: "Good",
  fair: "Fair",
  poor: "Poor",
};
