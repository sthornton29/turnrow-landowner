import type { EasementRelationship, EasementType } from "@/types/db";

// Single source of truth for easements: the type list, labels, the
// category each type styles under, and the per-category map look.
// Fourteen colors would be noise, so the map and legend work by
// CATEGORY; the click panel, summary page, and editors show the exact
// type and every field. Mirrors the check constraint in migration 0019.

export const EASEMENT_TYPE_LABELS: Record<EasementType, string> = {
  powerline: "Powerline",
  pipeline: "Pipeline",
  waterline_sewer: "Waterline / sewer",
  telecom_fiber: "Telecom / fiber",
  access_row: "Access (ingress/egress)",
  public_road_row: "Public road right of way",
  railroad: "Railroad",
  drainage: "Drainage",
  flowage: "Flowage (reservoir)",
  conservation: "Conservation",
  cemetery_access: "Cemetery access",
  construction_temp: "Temporary construction",
  solar_wind: "Solar / wind",
  other: "Other",
};

export const EASEMENT_TYPES = Object.keys(EASEMENT_TYPE_LABELS) as EasementType[];

export const EASEMENT_RELATIONSHIP_LABELS: Record<EasementRelationship, string> = {
  burdens_this_property: "Burdens this property",
  benefits_this_property: "Benefits this property (held over a neighbor)",
};

export type EasementCategory =
  | "utility"
  | "access_transport"
  | "water"
  | "conservation"
  | "neutral";

export const EASEMENT_CATEGORY: Record<EasementType, EasementCategory> = {
  powerline: "utility",
  pipeline: "utility",
  waterline_sewer: "utility",
  telecom_fiber: "utility",
  access_row: "access_transport",
  public_road_row: "access_transport",
  railroad: "access_transport",
  drainage: "water",
  flowage: "water",
  conservation: "conservation",
  cemetery_access: "neutral",
  construction_temp: "neutral",
  solar_wind: "neutral",
  other: "neutral",
};

export const EASEMENT_CATEGORY_LABELS: Record<EasementCategory, string> = {
  utility: "Utility",
  access_transport: "Access / transport",
  water: "Drainage / flowage",
  conservation: "Conservation",
  neutral: "Other easements",
};

export const EASEMENT_CATEGORIES = Object.keys(
  EASEMENT_CATEGORY_LABELS
) as EasementCategory[];

// Per-TYPE style: a category color family with a dash that tells the
// types within a family apart. Colors checked against roads (white),
// the farm's own pipe (dashed light blue), wetlands steel blue
// #6487a8, pivot light blue, pastures tan #d2b48c, the crop palette,
// and the timber palette (mixed timber is deep violet #7c3aed; the
// conservation magenta-violet #a21caf is a hue step away AND renders as
// a hatch over a faint fill, never a solid, so the two never read the
// same even side by side).
export interface EasementStyle {
  color: string;
  dash: number[] | null; // null = solid
  fillOpacity: number;
  hatch: boolean; // conservation: hatched fill instead of a flat fill
  ticks: boolean; // railroad: crosshatch tick pattern over the line
  // CSS border style for legend swatches
  cssBorder: "solid" | "dashed" | "dotted";
}

const UTILITY_RED = "#dc2626";
const UTILITY_ORANGE = "#f97316";
const ACCESS_BROWN = "#92400e";
const ACCESS_TAN = "#b45309";
const WATER_BLUE = "#2563eb";
const CONSERVATION_VIOLET = "#a21caf";
const NEUTRAL_GRAY = "#9ca3af";
const NEUTRAL_SLATE = "#6b7280";

export const EASEMENT_STYLES: Record<EasementType, EasementStyle> = {
  powerline: { color: UTILITY_RED, dash: [4, 2], fillOpacity: 0.18, hatch: false, ticks: false, cssBorder: "dashed" },
  pipeline: { color: UTILITY_ORANGE, dash: [3, 1.5, 0.4, 1.5], fillOpacity: 0.18, hatch: false, ticks: false, cssBorder: "dotted" },
  waterline_sewer: { color: UTILITY_ORANGE, dash: [1, 1.5], fillOpacity: 0.16, hatch: false, ticks: false, cssBorder: "dotted" },
  telecom_fiber: { color: UTILITY_RED, dash: [1, 1.5], fillOpacity: 0.14, hatch: false, ticks: false, cssBorder: "dotted" },
  access_row: { color: ACCESS_TAN, dash: [4, 2], fillOpacity: 0.2, hatch: false, ticks: false, cssBorder: "dashed" },
  public_road_row: { color: ACCESS_BROWN, dash: [6, 2], fillOpacity: 0.18, hatch: false, ticks: false, cssBorder: "dashed" },
  railroad: { color: ACCESS_BROWN, dash: null, fillOpacity: 0.18, hatch: false, ticks: true, cssBorder: "solid" },
  drainage: { color: WATER_BLUE, dash: [3, 2], fillOpacity: 0.16, hatch: false, ticks: false, cssBorder: "dashed" },
  flowage: { color: WATER_BLUE, dash: [6, 2, 1, 2], fillOpacity: 0.26, hatch: false, ticks: false, cssBorder: "dashed" },
  conservation: { color: CONSERVATION_VIOLET, dash: null, fillOpacity: 0.1, hatch: true, ticks: false, cssBorder: "solid" },
  cemetery_access: { color: NEUTRAL_SLATE, dash: [2, 2], fillOpacity: 0.16, hatch: false, ticks: false, cssBorder: "dashed" },
  construction_temp: { color: NEUTRAL_GRAY, dash: [1, 2], fillOpacity: 0.14, hatch: false, ticks: false, cssBorder: "dotted" },
  solar_wind: { color: NEUTRAL_SLATE, dash: [5, 2], fillOpacity: 0.18, hatch: false, ticks: false, cssBorder: "dashed" },
  other: { color: NEUTRAL_GRAY, dash: null, fillOpacity: 0.16, hatch: false, ticks: false, cssBorder: "solid" },
};

// Representative color for a category (legend swatch, draft drawing).
export const EASEMENT_CATEGORY_COLORS: Record<EasementCategory, string> = {
  utility: UTILITY_RED,
  access_transport: ACCESS_BROWN,
  water: WATER_BLUE,
  conservation: CONSERVATION_VIOLET,
  neutral: NEUTRAL_GRAY,
};

export function easementCategory(type: string | null | undefined): EasementCategory {
  return EASEMENT_CATEGORY[(type ?? "other") as EasementType] ?? "neutral";
}

export function easementStyle(type: string | null | undefined): EasementStyle {
  return EASEMENT_STYLES[(type ?? "other") as EasementType] ?? EASEMENT_STYLES.other;
}

export function easementTypeLabel(type: string | null | undefined): string {
  return EASEMENT_TYPE_LABELS[(type ?? "other") as EasementType] ?? "Other";
}

// Which extra fields a type shows beyond the shared set.
export function easementShowsElevation(type: EasementType): boolean {
  return type === "flowage";
}
export function easementShowsProgram(type: EasementType): boolean {
  return type === "conservation";
}

// The category legend lists only categories present among the rows.
export function categoriesPresent(
  rows: Array<{ easement_type: string | null }>
): EasementCategory[] {
  const present = new Set(rows.map((r) => easementCategory(r.easement_type)));
  return EASEMENT_CATEGORIES.filter((c) => present.has(c));
}

// Migration 0019 in app terms: a pre-0019 row (type only, polygon
// boundary) reads as the same type with relationship defaulting to
// burdens and every new field null. Unit-tested so the SQL and the app
// never disagree about what an old row means.
export function migrateLegacyEasementRow<T extends { easement_type: string }>(
  row: T
): T & {
  relationship: EasementRelationship;
  expiration_date: null;
  width_ft: null;
  elevation_ft: null;
  program: null;
  restrictions: null;
  geom_geojson: null;
} {
  const type = (EASEMENT_TYPES as string[]).includes(row.easement_type)
    ? row.easement_type
    : "other";
  return {
    ...row,
    easement_type: type,
    relationship: "burdens_this_property",
    expiration_date: null,
    width_ft: null,
    elevation_ft: null,
    program: null,
    restrictions: null,
    geom_geojson: null,
  };
}
