// Shared helpers for the entity level (LLCs, trusts, individuals that
// hold title to properties). The entities table is unified with the
// county-records owner matching: entity_aliases rows hang off it.

import type { LandEntityType } from "@/types/db";

export const ENTITY_TYPE_LABELS: Record<LandEntityType, string> = {
  individual: "Individual",
  llc: "LLC",
  corporation: "Corporation",
  partnership: "Partnership",
  trust: "Trust",
  estate: "Estate",
  other: "Other",
};

// Key used everywhere a "no entity" bucket appears (properties list
// grouping, income and tax subtotals, map legend).
export const NO_ENTITY = "__none__";

// Outline colors for the map's color-by-entity mode. Chosen to read over
// satellite imagery and to avoid the meanings already on the map: white
// (property outlines / no entity) and kelly green (fields). Cycles when
// an org somehow has more entities than colors.
export const ENTITY_COLORS = [
  "#fbbf24", // amber
  "#60a5fa", // blue
  "#f472b6", // pink
  "#c084fc", // purple
  "#fb923c", // orange
  "#2dd4bf", // teal
  "#a3e635", // lime
  "#f87171", // red
];

export function entityColor(index: number): string {
  return ENTITY_COLORS[index % ENTITY_COLORS.length];
}

// Best-guess entity type from a name (mirrors the migration 0009 guess
// for rows migrated from county groupings). Always user-correctable.
export function guessEntityType(name: string): LandEntityType {
  const n = " " + name.toUpperCase() + " ";
  if (/\bLLC\b/.test(n)) return "llc";
  if (/\b(CORP|CORPORATION|INC)\b/.test(n)) return "corporation";
  if (/\b(LP|FLP|PARTNERSHIP)\b/.test(n)) return "partnership";
  if (/\bTRUST\b/.test(n)) return "trust";
  if (/\b(ESTATE|EST)\b/.test(n)) return "estate";
  return "individual";
}
