// Map palette shared by the live map, the print renderer, and the
// pick-first draw flow (the draft shape is drawn in the color of what
// it will become, so the user sees what they are making).

import { STAND_TYPE_COLORS } from "@/lib/assetTypes";
import { EASEMENT_CATEGORY_COLORS } from "@/lib/easements";

export const KELLY = "#39b54a";
export const PINE = "#14532d";
export const MINT = "#a7f3d0";
// Pastures: warm tan, distinct from kelly (ag fields), canola light
// green, wheat amber, the timber palette, and pivot blue.
export const PASTURE_TAN = "#d2b48c";
// Wetlands (OPEN wetlands: marsh, sloughs, duck holes; forested
// bottomland stays a timber stand): muted steel blue, apart from kelly,
// every crop color, the timber palette, pivot light blue, and pasture tan.
export const WETLAND_BLUE = "#6487a8";
// Asset lines/footprints and the pivot coverage blues.
export const ASSET_LIGHT_BLUE = "#bae6fd";
export const PIVOT_BLUE = "#38bdf8";
// Cemeteries: a muted stone violet, apart from every land, crop, timber,
// water, and entity color on the map.
export const CEMETERY_VIOLET = "#c4b5fd";
export const CEMETERY_VIOLET_DARK = "#6d28d9";
// Maintenance issues: warning colors only (never used for land).
export const ISSUE_AMBER = "#f59e0b";

// Draft color while drawing, keyed by what the session will save.
export function draftColorFor(key: string): string {
  switch (key) {
    case "property": return "#ffffff";
    case "parcel": return "#e5e7eb";
    case "field": return KELLY;
    case "pasture": return PASTURE_TAN;
    case "wetland": return WETLAND_BLUE;
    case "timber_stand": return STAND_TYPE_COLORS.planted_pine;
    case "road": return "#ffffff";
    case "fence":
    case "underground_pipe":
    case "asset": return ASSET_LIGHT_BLUE;
    case "easement": return EASEMENT_CATEGORY_COLORS.utility;
    case "cemetery": return CEMETERY_VIOLET;
    case "maintenance_issue": return ISSUE_AMBER;
    default: return "#fbb03b"; // mapbox-gl-draw's default orange
  }
}

// mapbox-gl-draw 1.5 theme layer ids (each exists as .cold and .hot).
// The originals are captured the first time we override so restoring
// never depends on hardcoded defaults.
const DRAW_LAYERS: Array<{ id: string; prop: "fill-color" | "line-color" | "circle-color" }> = [
  { id: "gl-draw-polygon-fill", prop: "fill-color" },
  { id: "gl-draw-lines", prop: "line-color" },
  { id: "gl-draw-vertex-inner", prop: "circle-color" },
  { id: "gl-draw-midpoint", prop: "circle-color" },
];
const originals = new Map<string, unknown>();

// Draft color for a session (null restores mapbox-gl-draw's defaults).
// The polygon fill also gets a bit more opacity while drafting so the
// type's color reads over satellite.
export function applyDraftColor(map: mapboxgl.Map, color: string | null) {
  for (const { id, prop } of DRAW_LAYERS) {
    for (const suffix of [".cold", ".hot"]) {
      const layerId = id + suffix;
      if (!map.getLayer(layerId)) continue;
      const key = layerId + "|" + prop;
      try {
        if (color === null) {
          if (originals.has(key)) map.setPaintProperty(layerId, prop, originals.get(key) as never);
          if (prop === "fill-color" && originals.has(layerId + "|fill-opacity")) {
            map.setPaintProperty(layerId, "fill-opacity", originals.get(layerId + "|fill-opacity") as never);
          }
        } else {
          if (!originals.has(key)) originals.set(key, map.getPaintProperty(layerId, prop));
          map.setPaintProperty(layerId, prop, color);
          if (prop === "fill-color") {
            if (!originals.has(layerId + "|fill-opacity")) {
              originals.set(layerId + "|fill-opacity", map.getPaintProperty(layerId, "fill-opacity"));
            }
            map.setPaintProperty(layerId, "fill-opacity", 0.22);
          }
        }
      } catch {
        // Layer without this paint property: skip.
      }
    }
  }
}

import type mapboxgl from "mapbox-gl";
