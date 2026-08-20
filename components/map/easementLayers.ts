// Easement map layers, shared by the live map and the print renderer so
// the PDF always matches the screen. Styling is by CATEGORY family with
// a per-type dash (lib/easements.ts); polygons get a translucent fill
// (conservation a violet hatch), lines render on the same line layers
// a touch wider. Railroads add a tie pattern over the line.

import type mapboxgl from "mapbox-gl";
import {
  EASEMENT_STYLES,
  EASEMENT_TYPES,
  easementStyle,
} from "@/lib/easements";

export const EASEMENT_HATCH_IMAGE = "easement-hatch";

// Register the conservation hatch pattern (idempotent).
export function ensureEasementImages(map: mapboxgl.Map) {
  if (map.hasImage(EASEMENT_HATCH_IMAGE)) return;
  const size = 10;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.strokeStyle = EASEMENT_STYLES.conservation.color;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-2, size + 2);
  ctx.lineTo(size + 2, -2);
  ctx.moveTo(-2, size / 2 + 2);
  ctx.lineTo(size / 2 + 2, -2);
  ctx.moveTo(size / 2 - 2, size + 2);
  ctx.lineTo(size + 2, size / 2 - 2);
  ctx.stroke();
  map.addImage(EASEMENT_HATCH_IMAGE, ctx.getImageData(0, 0, size, size), {
    pixelRatio: 1,
  });
}

function colorExpression(): mapboxgl.Expression {
  const expr: unknown[] = ["match", ["get", "easementType"]];
  for (const t of EASEMENT_TYPES) expr.push(t, EASEMENT_STYLES[t].color);
  expr.push(EASEMENT_STYLES.other.color);
  return expr as mapboxgl.Expression;
}

function fillOpacityExpression(): mapboxgl.Expression {
  const expr: unknown[] = ["match", ["get", "easementType"]];
  for (const t of EASEMENT_TYPES) expr.push(t, EASEMENT_STYLES[t].fillOpacity);
  expr.push(EASEMENT_STYLES.other.fillOpacity);
  return expr as mapboxgl.Expression;
}

// Polygon outlines 2px, line easements wider so a line reads as the
// thing itself rather than an edge.
const LINE_WIDTH: mapboxgl.Expression = [
  "case", ["==", ["geometry-type"], "LineString"], 3.5, 2,
];

// Adds every easement layer for a source and returns the ids in order
// (the live map uses the list for visibility toggles and hit testing).
export function addEasementLayers(
  map: mapboxgl.Map,
  source: string,
  opts: { beforeId?: string } = {}
): { ids: string[]; hitIds: string[] } {
  ensureEasementImages(map);
  const ids: string[] = [];
  const add = (layer: mapboxgl.AnyLayer) => {
    map.addLayer(layer, opts.beforeId);
    ids.push(layer.id);
  };
  const color = colorExpression();
  const hatched = EASEMENT_TYPES.filter((t) => EASEMENT_STYLES[t].hatch);
  const isPolygon: mapboxgl.Expression = ["==", ["geometry-type"], "Polygon"];

  add({ id: "easements-fill", type: "fill", source,
    filter: ["all", isPolygon, ["!", ["in", ["get", "easementType"], ["literal", hatched]]]],
    paint: { "fill-color": color, "fill-opacity": fillOpacityExpression() } });
  // Conservation: faint flat fill under a hatch so the polygon still
  // reads as an area at low zoom.
  add({ id: "easements-hatch-base", type: "fill", source,
    filter: ["all", isPolygon, ["in", ["get", "easementType"], ["literal", hatched]]],
    paint: { "fill-color": color, "fill-opacity": EASEMENT_STYLES.conservation.fillOpacity } });
  add({ id: "easements-hatch", type: "fill", source,
    filter: ["all", isPolygon, ["in", ["get", "easementType"], ["literal", hatched]]],
    paint: { "fill-pattern": EASEMENT_HATCH_IMAGE, "fill-opacity": 0.7 } });

  // One line layer per distinct dash (dasharray is not data-driven).
  const groups = new Map<string, string[]>();
  for (const t of EASEMENT_TYPES) {
    const key = JSON.stringify(EASEMENT_STYLES[t].dash);
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  let i = 0;
  for (const [key, types] of groups) {
    const dash = JSON.parse(key) as number[] | null;
    add({ id: `easements-line-${i++}`, type: "line", source,
      filter: ["in", ["get", "easementType"], ["literal", types]],
      layout: { "line-cap": "butt", "line-join": "round" },
      paint: { "line-color": color, "line-width": LINE_WIDTH,
        ...(dash ? { "line-dasharray": dash } : {}) } });
  }
  // Railroad ties: short thick dashes across the rail line.
  const ticked = EASEMENT_TYPES.filter((t) => EASEMENT_STYLES[t].ticks);
  add({ id: "easements-ticks", type: "line", source,
    filter: ["in", ["get", "easementType"], ["literal", ticked]],
    paint: { "line-color": easementStyle("railroad").color,
      "line-width": ["case", ["==", ["geometry-type"], "LineString"], 9, 6],
      "line-dasharray": [0.25, 1.4], "line-opacity": 0.9 } });

  // Wide invisible hit target for LINE easements (polygons hit on fill).
  add({ id: "easements-hit", type: "line", source,
    filter: ["==", ["geometry-type"], "LineString"],
    paint: { "line-color": "#ffffff", "line-width": 16, "line-opacity": 0.01 } });

  return { ids, hitIds: ["easements-fill", "easements-hatch-base", "easements-hit"] };
}
