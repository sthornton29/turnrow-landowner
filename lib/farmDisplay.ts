// Client-safe helpers for displaying farm connection data: crop colors for
// the map, harvest status, yield formatting, and name/acres matching used
// by the mapping screen suggestions.

export interface FarmFieldDataRow {
  id: string;
  farm_connection_id: string;
  remote_field_id: string;
  crop_year: number;
  crop: string;
  planted_acres: number | null;
  irrigated_acres: number | null;
  dryland_acres: number | null;
  planting_date: string | null;
  varieties: Array<{ variety: string; acres: number }>;
  harvested_acres: number | null;
  production_units: number | null;
  production_unit: string | null;
  yield_shared: boolean;
  synced_at: string;
  // The field's farming entity (migration 0031; null on a pre-entity API).
  remote_entity_id?: string | null;
  remote_entity_name?: string | null;
}

export interface FieldMappingRow {
  id: string;
  farm_connection_id: string;
  remote_field_id: string;
  remote_name: string | null;
  remote_farm: string | null;
  remote_acres: number | null;
  local_field_id: string | null;
  local_property_id: string | null;
  status: "suggested" | "confirmed" | "ignored";
  remote_entity_id?: string | null;
  remote_entity_name?: string | null;
}

export interface FarmConnectionRow {
  id: string;
  label: string;
  status: "active" | "error" | "revoked";
  scopes: { yields?: boolean };
  operation_name: string | null;
  landowner_name: string | null;
  field_count: number | null;
  last_synced_at: string | null;
  entities?: Array<{ id: string; name: string; field_count?: number | null }> | null;
  last_error: string | null;
}

// ---------------------------------------------------------------- crops

// Colors chosen to read over satellite imagery, distinct from each other.
const CROP_COLORS: Array<{ match: RegExp; color: string; label: string }> = [
  { match: /corn/i, color: "#facc15", label: "Corn" },
  { match: /cotton/i, color: "#f8fafc", label: "Cotton" },
  { match: /soy/i, color: "#39b54a", label: "Soybeans" },
  { match: /wheat/i, color: "#d97706", label: "Wheat" },
  { match: /canola|rape/i, color: "#a3e635", label: "Canola" },
];
export const OTHER_CROP_COLOR = "#a78bfa";

export function cropColor(crop: string | null | undefined): string {
  if (!crop) return OTHER_CROP_COLOR;
  return CROP_COLORS.find((c) => c.match.test(crop))?.color ?? OTHER_CROP_COLOR;
}

export function cropLegend(
  crops: string[]
): Array<{ label: string; color: string }> {
  const seen = new Map<string, string>();
  for (const crop of crops) {
    const known = CROP_COLORS.find((c) => c.match.test(crop));
    if (known) seen.set(known.label, known.color);
    else if (crop) seen.set(crop, OTHER_CROP_COLOR);
  }
  return Array.from(seen.entries()).map(([label, color]) => ({ label, color }));
}

// ---------------------------------------------------------------- harvest

export function harvestStatus(row: FarmFieldDataRow): "harvested" | "growing" {
  return (row.harvested_acres ?? 0) > 0 ? "harvested" : "growing";
}

export function yieldPerAcre(row: FarmFieldDataRow): number | null {
  if (
    row.production_units === null ||
    !row.harvested_acres ||
    row.harvested_acres <= 0
  ) {
    return null;
  }
  return row.production_units / row.harvested_acres;
}

export function yieldUnitLabel(unit: string | null): string {
  return unit === "lbs" ? "lbs/ac" : "bu/ac";
}

// ---------------------------------------------------------------- matching

function normalizeName(name: string | null | undefined): string {
  return (name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Suggestion score for a remote field against a local field: name
// similarity plus acreage closeness (the farm API supplies no geometry).
export function matchScore(
  remote: { name: string | null; acres: number | null },
  local: { name: string; acres: number | null }
): number {
  let score = 0;
  const a = normalizeName(remote.name);
  const b = normalizeName(local.name);
  if (a && b) {
    if (a === b) score += 2;
    else if (a.includes(b) || b.includes(a)) score += 1;
    else {
      const aTokens = new Set(a.split(" "));
      const shared = b.split(" ").filter((t) => t.length > 1 && aTokens.has(t));
      if (shared.length > 0) score += 0.5;
    }
  }
  if (remote.acres && local.acres) {
    const diff = Math.abs(remote.acres - local.acres) / Math.max(remote.acres, local.acres);
    if (diff <= 0.05) score += 1;
    else if (diff <= 0.15) score += 0.5;
  }
  return score;
}

export function suggestLocalField<
  T extends { id: string; name: string; acres: number | null },
>(
  remote: { name: string | null; acres: number | null },
  locals: T[]
): T | null {
  let best: T | null = null;
  let bestScore = 0;
  for (const local of locals) {
    const score = matchScore(remote, local);
    if (score > bestScore) {
      best = local;
      bestScore = score;
    }
  }
  return bestScore >= 1 ? best : null;
}
