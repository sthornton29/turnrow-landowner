// Public Land Survey System lookups against the BLM National PLSS
// CadNSDI service, used to plot aliquot legal descriptions ("NW1/4 of
// SE1/4 of Section 12, T4S R8W") onto the map. Pure helpers here; the
// network call lives in app/api/plss/route.ts with a global cache.
//
// VERIFIED LIVE 2026-08-20 against the service's ?f=json metadata and
// sample queries (do not change without re-verifying):
//   service: https://gis.blm.gov/arcgis/rest/services/Cadastral/BLM_Natl_PLSS_CadNSDI/MapServer
//   layer 1 "PLSS Township": STATEABBR, PRINMERCD, PRINMER, TWNSHPNO
//     (3-char zero padded string), TWNSHPFRAC, TWNSHPDIR, RANGENO (3-char),
//     RANGEFRAC, RANGEDIR, TWNSHPDPCD, PLSSID, TWNSHPLAB ("4S 8W")
//   layer 2 "PLSS Section": PLSSID, FRSTDIVID, FRSTDIVTYP ("SN"),
//     FRSTDIVNO (unpadded string, "22"), FRSTDIVDUP, FRSTDIVLAB. The
//     section layer carries NO township/range/state columns; the
//     township identity is the PLSSID string:
//       STATE(2) MERIDIAN CODE(2) TWNSHPNO(3) TWNSHPFRAC(1) TWNSHPDIR(1)
//       RANGENO(3) RANGEFRAC(1) RANGEDIR(1) TWNSHPDPCD(1)
//     e.g. AL160040S0080W0 = Alabama, Huntsville meridian, T4S R8W.
//   f=geojson with outSR=4326 returns WGS84 Polygons; maxRecordCount 2000;
//   pagination supported. Service native SR is 102100.
//   Alabama meridian codes (distinct query on layer 1): 16 Huntsville,
//   25 St. Stephens, 29 Tallahassee.

import turfArea from "@turf/area";
import type { Geometry, MultiPolygon, Polygon } from "geojson";
import { escapeSqlLiteral } from "@/lib/gisServer";

export const PLSS_SERVICE_URL =
  "https://gis.blm.gov/arcgis/rest/services/Cadastral/BLM_Natl_PLSS_CadNSDI/MapServer";
export const PLSS_TOWNSHIP_LAYER = 1;
export const PLSS_SECTION_LAYER = 2;
export const PLSS_SERVICE_LABEL = "the BLM PLSS service";

export const PLSS_FIELDS = {
  township: {
    state: "STATEABBR",
    meridianCode: "PRINMERCD",
    meridianName: "PRINMER",
    townshipNo: "TWNSHPNO",
    townshipDir: "TWNSHPDIR",
    rangeNo: "RANGENO",
    rangeDir: "RANGEDIR",
    plssId: "PLSSID",
    label: "TWNSHPLAB",
  },
  section: {
    plssId: "PLSSID",
    sectionNo: "FRSTDIVNO",
    duplicate: "FRSTDIVDUP",
    type: "FRSTDIVTYP",
  },
} as const;

// Principal meridians by BLM code. Alabama's three are what this app
// meets first; the rest of the table can grow as needed.
export const MERIDIANS: Record<string, { code: string; name: string; states: string[] }> = {
  HU: { code: "16", name: "Huntsville", states: ["AL", "MS"] },
  SS: { code: "25", name: "St. Stephens", states: ["AL", "MS"] },
  TA: { code: "29", name: "Tallahassee", states: ["AL", "FL"] },
  CH: { code: "07", name: "Choctaw", states: ["MS"] },
  WA: { code: "31", name: "Washington", states: ["MS"] },
  LA: { code: "19", name: "Louisiana", states: ["LA"] },
  SH: { code: "24", name: "St. Helena", states: ["LA"] },
  FI: { code: "05", name: "5th Principal", states: ["AR", "MO", "IA", "MN", "ND", "SD"] },
  SE: { code: "02", name: "2nd Principal", states: ["IN", "IL"] },
  TH: { code: "03", name: "3rd Principal", states: ["IL"] },
  FO: { code: "04", name: "4th Principal", states: ["IL", "WI", "MN"] },
  SI: { code: "06", name: "6th Principal", states: ["KS", "NE", "CO", "WY", "SD"] },
  IN: { code: "17", name: "Indian", states: ["OK"] },
  CI: { code: "08", name: "Cimarron", states: ["OK"] },
  MI: { code: "21", name: "Michigan", states: ["MI", "OH"] },
  TE: { code: "30", name: "Tallahassee (FL)", states: ["FL"] },
};

export interface PlssRequest {
  state: string; // 2-letter
  township: { num: number; dir: "N" | "S" };
  range: { num: number; dir: "E" | "W" };
  section: number;
  meridian?: string | null; // key in MERIDIANS (HU, SS, TA) or a BLM code
}

export interface PlssCandidate {
  key: string;
  polygon: Polygon | MultiPolygon;
  attrs: {
    state: string;
    township: string; // "4S"
    range: string; // "8W"
    section: number;
    meridian: string | null; // BLM code, e.g. "16"
    meridianName: string | null;
    plssid: string;
    duplicate: string | null;
  };
  acres: number;
}

const pad3 = (n: number) => String(Math.max(0, Math.floor(n))).padStart(3, "0");

export function meridianCode(meridian: string | null | undefined): string | null {
  if (!meridian) return null;
  const m = meridian.trim().toUpperCase();
  if (/^\d{2}$/.test(m)) return m;
  return MERIDIANS[m]?.code ?? null;
}

export function meridianName(code: string | null | undefined): string | null {
  if (!code) return null;
  const hit = Object.values(MERIDIANS).find((m) => m.code === code);
  return hit?.name ?? null;
}

// Meridian keys plausible for a state (used by the UI to ask when a
// description names none and the grid returns several matches).
export function meridiansForState(state: string): string[] {
  const st = state.toUpperCase();
  return Object.keys(MERIDIANS).filter((k) => MERIDIANS[k].states.includes(st));
}

// The PLSSID prefix for a township. Fractional townships and duplicate
// codes are wildcarded (underscore) so "T4S R8W" matches its standard
// instance; the meridian is wildcarded when unknown.
export function plssIdPattern(req: PlssRequest): string {
  const code = meridianCode(req.meridian) ?? "__";
  return (
    req.state.toUpperCase() +
    code +
    pad3(req.township.num) + "_" + req.township.dir.toUpperCase() +
    pad3(req.range.num) + "_" + req.range.dir.toUpperCase() +
    "_"
  );
}

// WHERE clause for the SECTION layer (layer 2). Uses LIKE on PLSSID
// because the section layer has no separate township/range columns.
export function buildPlssWhere(req: PlssRequest): string {
  const pattern = escapeSqlLiteral(plssIdPattern(req));
  const section = escapeSqlLiteral(String(Math.floor(req.section)));
  return (
    `${PLSS_FIELDS.section.plssId} LIKE '${pattern}' AND ` +
    `${PLSS_FIELDS.section.sectionNo} = '${section}' AND ` +
    `${PLSS_FIELDS.section.type} = 'SN'`
  );
}

// Stable cache key; meridian null means "any meridian" and is cached
// separately from an explicit one.
export function cacheKey(
  state: string,
  township: string,
  range: string,
  section: number,
  meridian: string | null | undefined
): string {
  return [
    state.toUpperCase(),
    township.toUpperCase(),
    range.toUpperCase(),
    String(section),
    meridianCode(meridian) ?? "ANY",
  ].join("|");
}

export function townshipLabel(req: PlssRequest): { township: string; range: string } {
  return {
    township: `${req.township.num}${req.township.dir.toUpperCase()}`,
    range: `${req.range.num}${req.range.dir.toUpperCase()}`,
  };
}

// Decode a PLSSID back into its parts (see the layout note above).
export function parsePlssId(plssid: string): {
  state: string;
  meridian: string;
  township: string;
  range: string;
  duplicate: string;
} | null {
  const m = /^([A-Z]{2})(\d{2})(\d{3})(\d)([NS])(\d{3})(\d)([EW])(\d)$/.exec(plssid.trim().toUpperCase());
  if (!m) return null;
  const frac = (f: string) => (f === "0" ? "" : ` ${f}/4`);
  return {
    state: m[1],
    meridian: m[2],
    township: `${Number(m[3])}${frac(m[4])}${m[5]}`,
    range: `${Number(m[6])}${frac(m[7])}${m[8]}`,
    duplicate: m[9],
  };
}

export function acresOf(g: Geometry): number {
  try {
    return Math.round((turfArea(g) / 4046.8564224) * 10) / 10;
  } catch {
    return 0;
  }
}

// Raw section feature (GeoJSON from queryLayerFeatures) -> candidate.
export function normalizePlssFeature(raw: {
  geometry: Geometry | null;
  properties: Record<string, unknown>;
}): PlssCandidate | null {
  const g = raw.geometry;
  if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) return null;
  const plssid = String(raw.properties[PLSS_FIELDS.section.plssId] ?? "");
  const parsed = parsePlssId(plssid);
  if (!parsed) return null;
  const section = Number(raw.properties[PLSS_FIELDS.section.sectionNo]);
  if (!Number.isFinite(section)) return null;
  const dup = raw.properties[PLSS_FIELDS.section.duplicate];
  return {
    key: `${plssid}|${section}|${dup ?? "0"}`,
    polygon: g,
    attrs: {
      state: parsed.state,
      township: parsed.township,
      range: parsed.range,
      section,
      meridian: parsed.meridian,
      meridianName: meridianName(parsed.meridian),
      plssid,
      duplicate: dup === null || dup === undefined ? null : String(dup),
    },
    acres: acresOf(g),
  };
}
