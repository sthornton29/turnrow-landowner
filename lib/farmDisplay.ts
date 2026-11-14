// Client-safe helpers for displaying farm connection data: crop colors for
// the map, harvest status, yield formatting, and name/acres matching used
// by the mapping screen suggestions.

import { formatNumber, plural } from "@/lib/format";

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
  // From the partner API's /production harvest_status (migration 0033):
  // the same complete / in_progress / unharvested classification the
  // tenant's own Yields page shows. Null on rows synced before the farm
  // side sent it (harvestState falls back to the old inference).
  harvest_status?: "complete" | "in_progress" | "unharvested" | null;
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

// The one rule for a field x crop's harvest state, used by every yield
// display: complete (harvest done, production is the actual), in_progress
// (being cut; partial production must never present as an actual), or
// growing (nothing harvested yet). Rows synced before the farm API sent
// harvest_status fall back to the old inference: any harvested acres
// means done.
export type HarvestState = "complete" | "in_progress" | "growing";

export function harvestState(row: FarmFieldDataRow): HarvestState {
  const s = row.harvest_status ?? null;
  if (s === "complete") return "complete";
  if (s === "in_progress") return "in_progress";
  if (s === "unharvested") return "growing";
  return (row.harvested_acres ?? 0) > 0 ? "complete" : "growing";
}

export function harvestStateLabel(state: HarvestState): string {
  return state === "complete" ? "Harvested" : state === "in_progress" ? "Harvesting" : "Growing";
}

// ACTUAL yield per acre: production over HARVESTED acres, and only once
// the field x crop is harvest-complete. An in-progress field returns
// null here (its partial production would read artificially low); show
// its harvest state and the projected yield instead.
export function yieldPerAcre(row: FarmFieldDataRow): number | null {
  if (
    harvestState(row) !== "complete" ||
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

// How alike two field names are: 2 the same name, 1 one contains the
// other, 0.5 they share a word, 0 nothing in common. A shared word that
// is only a number does not count: "North 40" and "South 40" share an
// acreage, not a name.
export function nameScore(
  remoteName: string | null | undefined,
  localName: string | null | undefined
): number {
  const a = normalizeName(remoteName);
  const b = normalizeName(localName);
  if (!a || !b) return 0;
  if (a === b) return 2;
  if (a.includes(b) || b.includes(a)) return 1;
  const aTokens = new Set(a.split(" "));
  const shared = b.split(" ").filter((t) => t.length > 1 && !/^\d+$/.test(t) && aTokens.has(t));
  return shared.length > 0 ? 0.5 : 0;
}

// How close two acre figures are: 1 within 5 percent, 0.5 within 15, else 0.
function acresScore(remoteAcres: number | null, localAcres: number | null): number {
  if (!remoteAcres || !localAcres) return 0;
  const diff = Math.abs(remoteAcres - localAcres) / Math.max(remoteAcres, localAcres);
  if (diff <= 0.05) return 1;
  if (diff <= 0.15) return 0.5;
  return 0;
}

// Suggestion score for a remote field against a local field: name
// similarity plus acreage closeness (the farm API supplies no geometry).
export function matchScore(
  remote: { name: string | null; acres: number | null },
  local: { name: string; acres: number | null }
): number {
  return nameScore(remote.name, local.name) + acresScore(remote.acres, local.acres);
}

// The local field to PRE-SELECT for a remote field. The names must have
// something in common: acreage alone never pre-selects a match (two
// 40-acre fields would otherwise trade harvests on one tap of Confirm).
// Same-size fields are offered by acresOnlyMatches instead.
export function suggestLocalField<
  T extends { id: string; name: string; acres: number | null },
>(
  remote: { name: string | null; acres: number | null },
  locals: T[]
): T | null {
  let best: T | null = null;
  let bestScore = 0;
  for (const local of locals) {
    if (nameScore(remote.name, local.name) <= 0) continue;
    const score = matchScore(remote, local);
    if (score > bestScore) {
      best = local;
      bestScore = score;
    }
  }
  return bestScore >= 1 ? best : null;
}

// Local fields about the same size as a remote field (within 5 percent)
// whose names have nothing in common with it. Shown as a hint with both
// acre figures; never pre-selected.
export function acresOnlyMatches<
  T extends { id: string; name: string; acres: number | null },
>(
  remote: { name: string | null; acres: number | null },
  locals: T[]
): T[] {
  return locals.filter(
    (local) => nameScore(remote.name, local.name) <= 0 && acresScore(remote.acres, local.acres) >= 1
  );
}

// ---------------------------------------------------------------- ignored fields

// "Ignore this field" on the mapping screen (field_mappings.status
// 'ignored') means the owner does not want that farm-side field counted.
// Its plantings are left out of every total and list: Farm Data, the Home
// harvest card, and Ask. Keyed by connection plus remote field.
export function withoutIgnoredFields<
  T extends { farm_connection_id: string; remote_field_id: string },
>(
  rows: T[],
  mappings: Array<{ farm_connection_id: string; remote_field_id: string; status: string }>
): T[] {
  const ignored = new Set(
    mappings
      .filter((m) => m.status === "ignored")
      .map((m) => `${m.farm_connection_id}|${m.remote_field_id}`)
  );
  if (ignored.size === 0) return rows;
  return rows.filter((r) => !ignored.has(`${r.farm_connection_id}|${r.remote_field_id}`));
}

// ---------------------------------------------------------------- crop year

// The crop year a "this season" card shows: the current year once it has
// plantings, otherwise the prior year (harvest often finishes in January,
// before anything is planted for the new year).
export function seasonYear(rows: Array<{ crop_year: number }>, currentYear: number): number {
  if (rows.some((r) => r.crop_year === currentYear)) return currentYear;
  return rows.some((r) => r.crop_year === currentYear - 1) ? currentYear - 1 : currentYear;
}

// ---------------------------------------------------------------- sync replies

// The body of a fetch reply, read as text and parsed with care. A gateway
// timeout or a crashed route answers with a web page or with nothing, and
// res.json() would put a raw parse error in front of the user.
export async function readJsonBody<T>(res: { text: () => Promise<string> }): Promise<T | null> {
  try {
    const text = await res.text();
    if (!text.trim()) return null;
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" ? (parsed as T) : null;
  } catch {
    return null;
  }
}

export interface SyncReply {
  results?: Array<{
    ok: boolean;
    fields?: number;
    plantings?: number;
    tenants?: { created: number; linked: number };
    error?: string;
  }>;
  error?: string;
}

// What to tell the person after POST /api/farm/sync for ONE connection.
// Every reply ends in a sentence: a success, the farm software's own
// reason, or a plain "it did not go through".
export function describeSyncReply(
  status: number,
  body: SyncReply | null
): { ok: boolean; text: string } {
  const r = body?.results?.[0];
  if (status >= 200 && status < 300 && r?.ok) {
    const t = r.tenants;
    const parts = [
      t && t.created > 0 ? `${plural(t.created, "tenant")} created` : null,
      t && t.linked > 0 ? `${formatNumber(t.linked)} linked` : null,
    ].filter(Boolean);
    return {
      ok: true,
      text:
        `Synced ${plural(r.fields ?? 0, "field")} and ${plural(r.plantings ?? 0, "planting")}` +
        (parts.length > 0 ? `; ${parts.join(", ")} from the farm's entities` : "") +
        ".",
    };
  }
  if (r && !r.ok) {
    return {
      ok: false,
      text: r.error
        ? `The sync did not finish: ${r.error}`
        : "The sync did not finish. The numbers shown are from the last sync that worked.",
    };
  }
  if (status === 401) {
    return { ok: false, text: "You have been signed out. Sign in again, then try once more." };
  }
  if (status >= 200 && status < 300) {
    return {
      ok: false,
      text: "Nothing was synced. This connection may have been ended or removed; reload the page to check.",
    };
  }
  return {
    ok: false,
    text: "The sync did not go through. The numbers shown are from the last sync that worked. Try again in a few minutes.",
  };
}
