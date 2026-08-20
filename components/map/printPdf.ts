// Client-side print engine: renders the framed extent on a hidden
// high-resolution Mapbox map (pixelRatio 3, only the checked layers, a
// true render rather than an upscaled screen grab) and assembles a
// Letter PDF with jsPDF: the map within margins, title and date line, a
// legend of only the checked layers, a scale bar from the render's real
// ground distance, a north indicator, the Turnrow lockup, and the
// required Mapbox/OpenStreetMap attribution. Downloads the PDF; no
// window.print anywhere.

import mapboxgl from "mapbox-gl";
import { jsPDF } from "jspdf";
import type { FeatureCollection } from "geojson";
import {
  EASEMENT_COLORS,
  STAND_TYPE_COLORS,
} from "@/lib/assetTypes";
import { distanceFt } from "@/lib/geo/pivot";
import { KELLY, PASTURE_TAN, PINE, WETLAND_BLUE } from "./MapView";

export interface PrintLayerFlags {
  property: boolean;
  parcel: boolean;
  field: boolean;
  pasture: boolean;
  wetland: boolean;
  timber_stand: boolean;
  road: boolean;
  utility_easement: boolean;
  asset: boolean;
  crops: boolean; // recolor ag fields by current-year crop
  entity: boolean; // recolor property outlines by holding entity
}

export interface PrintLabelFlags {
  property: boolean;
  parcel: boolean;
  field: boolean;
  pasture: boolean;
  wetland: boolean;
  timber_stand: boolean;
  road: boolean;
  utility_easement: boolean;
  asset: boolean;
}

export interface PrintSources {
  properties: FeatureCollection;
  parcels: FeatureCollection;
  fields: FeatureCollection;
  pastures: FeatureCollection;
  wetlands: FeatureCollection;
  timber: FeatureCollection;
  roads: FeatureCollection;
  easements: FeatureCollection;
  assets: FeatureCollection;
  propertyLabels: FeatureCollection;
  parcelLabels: FeatureCollection;
  fieldLabels: FeatureCollection;
  pastureLabels: FeatureCollection;
  wetlandLabels: FeatureCollection;
  timberLabels: FeatureCollection;
  easementLabels: FeatureCollection;
}

export interface LegendEntry {
  label: string;
  color: string;
  kind: "fill" | "line" | "dash" | "dotdash" | "outline" | "point";
}

export interface PrintJob {
  bounds: [[number, number], [number, number]]; // [[w,s],[e,n]] of the frame
  orientation: "landscape" | "portrait";
  title: string;
  subtitle: string;
  layers: PrintLayerFlags;
  labels: PrintLabelFlags;
  sources: PrintSources;
  legend: LegendEntry[];
  onProgress: (message: string) => void;
}

// Letter in mm, with the layout blocks per orientation.
const LAYOUT = {
  landscape: {
    page: { w: 279.4, h: 215.9 },
    map: { x: 12, y: 24, w: 255.4, h: 146 },
    footerY: 176,
  },
  portrait: {
    page: { w: 215.9, h: 279.4 },
    map: { x: 12, y: 24, w: 191.9, h: 192 },
    footerY: 222,
  },
} as const;

export function mapAspect(orientation: "landscape" | "portrait"): number {
  const m = LAYOUT[orientation].map;
  return m.w / m.h;
}

const MM_TO_CSS_PX = 96 / 25.4;

function niceScaleBar(groundFtAcross: number): { feet: number; label: string } {
  // Target roughly a quarter of the map width.
  const target = groundFtAcross / 4;
  const options = [
    { feet: 100, label: "100 ft" },
    { feet: 250, label: "250 ft" },
    { feet: 500, label: "500 ft" },
    { feet: 1000, label: "1,000 ft" },
    { feet: 2640, label: "0.5 mi" },
    { feet: 5280, label: "1 mi" },
    { feet: 10560, label: "2 mi" },
    { feet: 26400, label: "5 mi" },
    { feet: 52800, label: "10 mi" },
  ];
  let best = options[0];
  for (const option of options) {
    if (Math.abs(option.feet - target) < Math.abs(best.feet - target)) best = option;
  }
  return best;
}

async function loadLockupPng(): Promise<string | null> {
  try {
    const img = new Image();
    img.src = "/brand/turnrow_horizontal_green.svg";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("logo"));
    });
    const canvas = document.createElement("canvas");
    const w = 300;
    const h = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * w) || 64);
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

function addPrintLayers(map: mapboxgl.Map, job: PrintJob) {
  const empty: FeatureCollection = { type: "FeatureCollection", features: [] };
  const { layers, labels, sources } = job;
  const src = (id: string, data: FeatureCollection) =>
    map.addSource(id, { type: "geojson", data });
  const fonts = ["DIN Pro Medium", "Arial Unicode MS Regular"];

  src("properties", layers.property ? sources.properties : empty);
  src("parcels", layers.parcel ? sources.parcels : empty);
  src("fields", layers.field ? sources.fields : empty);
  src("pastures", layers.pasture ? sources.pastures : empty);
  src("wetlands", layers.wetland ? sources.wetlands : empty);
  src("timber", layers.timber_stand ? sources.timber : empty);
  src("roads", layers.road ? sources.roads : empty);
  src("easements", layers.utility_easement ? sources.easements : empty);
  src("assets", layers.asset ? sources.assets : empty);

  // Mirrors the live map's styles; order matches too.
  map.addLayer({ id: "properties-fill", type: "fill", source: "properties",
    paint: { "fill-color": "#ffffff", "fill-opacity": 0.05 } });
  map.addLayer({ id: "properties-line", type: "line", source: "properties",
    paint: {
      "line-color": layers.entity
        ? ["coalesce", ["get", "entityColor"], "#ffffff"]
        : "#ffffff",
      "line-width": layers.entity ? 3 : 2.5,
    } });
  map.addLayer({ id: "parcels-line", type: "line", source: "parcels",
    paint: { "line-color": "#e5e7eb", "line-width": 1.4, "line-dasharray": [2, 2] } });

  map.addLayer({ id: "pastures-fill", type: "fill", source: "pastures",
    paint: { "fill-color": PASTURE_TAN, "fill-opacity": 0.25 } });
  map.addLayer({ id: "pastures-line", type: "line", source: "pastures",
    paint: { "line-color": PASTURE_TAN, "line-width": 2 } });
  map.addLayer({ id: "wetlands-fill", type: "fill", source: "wetlands",
    paint: { "fill-color": WETLAND_BLUE, "fill-opacity": 0.3 } });
  map.addLayer({ id: "wetlands-line", type: "line", source: "wetlands",
    paint: { "line-color": WETLAND_BLUE, "line-width": 2 } });

  const timberColor: mapboxgl.Expression = [
    "match", ["get", "standType"],
    "planted_pine", STAND_TYPE_COLORS.planted_pine,
    "natural_pine", STAND_TYPE_COLORS.natural_pine,
    "hardwood", STAND_TYPE_COLORS.hardwood,
    "mixed", STAND_TYPE_COLORS.mixed,
    STAND_TYPE_COLORS.other,
  ];
  map.addLayer({ id: "timber-fill", type: "fill", source: "timber",
    paint: { "fill-color": timberColor, "fill-opacity": 0.35 } });
  map.addLayer({ id: "timber-line", type: "line", source: "timber",
    paint: { "line-color": timberColor, "line-width": 2 } });

  map.addLayer({ id: "fields-fill", type: "fill", source: "fields",
    paint: layers.crops
      ? { "fill-color": ["coalesce", ["get", "cropColor"], "#6b7280"],
          "fill-opacity": ["case", ["has", "cropColor"], 0.55, 0.08] }
      : { "fill-color": KELLY, "fill-opacity": 0.18 } });
  map.addLayer({ id: "fields-line", type: "line", source: "fields",
    paint: { "line-color": layers.crops
      ? ["coalesce", ["get", "cropColor"], KELLY]
      : KELLY, "line-width": 2 } });

  map.addLayer({ id: "roads-casing", type: "line", source: "roads",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": PINE, "line-width": 4.5 } });
  map.addLayer({ id: "roads-line", type: "line", source: "roads",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#ffffff", "line-width": 2 } });

  const easementColor: mapboxgl.Expression = [
    "match", ["get", "easementType"],
    "powerline", EASEMENT_COLORS.powerline,
    "pipeline", EASEMENT_COLORS.pipeline,
    EASEMENT_COLORS.other,
  ];
  map.addLayer({ id: "easements-fill", type: "fill", source: "easements",
    paint: { "fill-color": easementColor, "fill-opacity": 0.18 } });
  map.addLayer({ id: "easements-line-powerline", type: "line", source: "easements",
    filter: ["==", ["get", "easementType"], "powerline"],
    paint: { "line-color": EASEMENT_COLORS.powerline, "line-width": 2,
      "line-dasharray": [4, 2] } });
  map.addLayer({ id: "easements-line-pipeline", type: "line", source: "easements",
    filter: ["==", ["get", "easementType"], "pipeline"],
    paint: { "line-color": EASEMENT_COLORS.pipeline, "line-width": 2,
      "line-dasharray": [3, 1.5, 0.4, 1.5] } });
  map.addLayer({ id: "easements-line-other", type: "line", source: "easements",
    filter: ["==", ["get", "easementType"], "other"],
    paint: { "line-color": EASEMENT_COLORS.other, "line-width": 2 } });

  const notPivot: mapboxgl.Expression = [
    "!", ["==", ["get", "assetType"], "irrigation_pivot"],
  ];
  map.addLayer({ id: "assets-fill", type: "fill", source: "assets",
    filter: ["all", ["==", ["geometry-type"], "Polygon"], notPivot],
    paint: { "fill-color": "#ffffff", "fill-opacity": 0.08 } });
  map.addLayer({ id: "pivot-circles-fill", type: "fill", source: "assets",
    filter: ["all", ["==", ["geometry-type"], "Polygon"],
      ["==", ["get", "assetType"], "irrigation_pivot"]],
    paint: { "fill-color": "#7dd3fc", "fill-opacity": 0.18 } });
  map.addLayer({ id: "pivot-circles-line", type: "line", source: "assets",
    filter: ["all", ["==", ["geometry-type"], "Polygon"],
      ["==", ["get", "assetType"], "irrigation_pivot"]],
    paint: { "line-color": "#38bdf8", "line-width": 2 } });
  map.addLayer({ id: "assets-line", type: "line", source: "assets",
    filter: ["==", ["geometry-type"], "LineString"],
    paint: { "line-color": "#bae6fd", "line-width": 2, "line-dasharray": [2, 2] } });
  map.addLayer({ id: "assets-circle", type: "circle", source: "assets",
    filter: ["==", ["geometry-type"], "Point"],
    paint: { "circle-radius": 8, "circle-color": PINE,
      "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } });
  map.addLayer({ id: "assets-letter", type: "symbol", source: "assets",
    filter: ["==", ["geometry-type"], "Point"],
    layout: { "text-field": ["get", "letter"], "text-size": 8,
      "text-font": ["DIN Pro Bold", "Arial Unicode MS Bold"],
      "text-allow-overlap": true },
    paint: { "text-color": "#ffffff" } });

  // Labels, each behind its own print toggle.
  const labelLayer = (
    id: string, data: FeatureCollection, size: number,
    color: string, halo: string
  ) => {
    map.addSource(id, { type: "geojson", data });
    map.addLayer({ id, type: "symbol", source: id,
      layout: { "text-field": ["get", "name"], "text-size": size,
        "text-font": fonts },
      paint: { "text-color": color, "text-halo-color": halo, "text-halo-width": 1.2 } });
  };
  if (layers.property && labels.property) {
    labelLayer("property-labels", sources.propertyLabels, 14, "#ffffff", PINE);
  }
  if (layers.parcel && labels.parcel) {
    labelLayer("parcel-labels", sources.parcelLabels, 10, "#e5e7eb", "#374151");
  }
  if (layers.field && labels.field) {
    labelLayer("field-labels", sources.fieldLabels, 11.5, "#eafcee", PINE);
  }
  if (layers.pasture && labels.pasture) {
    labelLayer("pasture-labels", sources.pastureLabels, 11.5, "#f5ead7", "#57431f");
  }
  if (layers.wetland && labels.wetland) {
    labelLayer("wetland-labels", sources.wetlandLabels, 11.5, "#e2ecf5", "#2c3f52");
  }
  if (layers.timber_stand && labels.timber_stand) {
    labelLayer("timber-labels", sources.timberLabels, 11.5, "#ffffff", PINE);
  }
  if (layers.road && labels.road) {
    map.addLayer({ id: "road-labels", type: "symbol", source: "roads",
      layout: { "symbol-placement": "line", "text-field": ["get", "name"],
        "text-size": 10, "text-font": fonts },
      paint: { "text-color": "#ffffff", "text-halo-color": PINE, "text-halo-width": 1.2 } });
  }
  if (layers.utility_easement && labels.utility_easement) {
    labelLayer("easement-labels", sources.easementLabels, 10, "#ffffff", "#7f1d1d");
  }
  if (layers.asset && labels.asset) {
    map.addLayer({ id: "assets-name", type: "symbol", source: "assets",
      filter: ["==", ["geometry-type"], "Point"],
      layout: { "text-field": ["get", "name"], "text-size": 10,
        "text-offset": [0, 1.6], "text-font": fonts },
      paint: { "text-color": "#ffffff", "text-halo-color": PINE, "text-halo-width": 1.2 } });
  }
}

export async function generateMapPdf(job: PrintJob): Promise<void> {
  const layout = LAYOUT[job.orientation];
  const cssW = Math.round(layout.map.w * MM_TO_CSS_PX);
  const cssH = Math.round(layout.map.h * MM_TO_CSS_PX);

  job.onProgress("Rendering the map at print resolution...");
  const container = document.createElement("div");
  container.style.cssText = `position:fixed;left:-100000px;top:0;width:${cssW}px;height:${cssH}px;`;
  document.body.appendChild(container);

  let dataUrl: string;
  let groundFtAcross: number;
  // GL JS sizes its canvas from devicePixelRatio; overriding it around
  // the hidden render is the standard way to get a TRUE high-resolution
  // render (sharp satellite tiles at the print zoom, not an upscaled
  // screen grab). Restored in finally.
  const originalDprDescriptor = Object.getOwnPropertyDescriptor(
    window,
    "devicePixelRatio"
  );
  try {
    Object.defineProperty(window, "devicePixelRatio", {
      get: () => 3,
      configurable: true,
    });
    const map = new mapboxgl.Map({
      container,
      style: "mapbox://styles/mapbox/satellite-streets-v12",
      bounds: job.bounds,
      fitBoundsOptions: { padding: 0 },
      interactive: false,
      attributionControl: false,
      preserveDrawingBuffer: true,
      fadeDuration: 0,
    });
    await new Promise<void>((resolve, reject) => {
      map.on("load", () => resolve());
      map.on("error", (e) => reject(e.error ?? new Error("Map failed to load")));
    });
    addPrintLayers(map, job);
    job.onProgress("Waiting for satellite tiles...");
    await new Promise<void>((resolve) => map.once("idle", () => resolve()));
    await new Promise((r) => setTimeout(r, 400));

    const a = map.unproject([0, cssH / 2]);
    const b = map.unproject([cssW, cssH / 2]);
    groundFtAcross = distanceFt([a.lng, a.lat], [b.lng, b.lat]);

    job.onProgress("Capturing...");
    dataUrl = map.getCanvas().toDataURL("image/jpeg", 0.9);
    map.remove();
  } finally {
    if (originalDprDescriptor) {
      Object.defineProperty(window, "devicePixelRatio", originalDprDescriptor);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).devicePixelRatio;
    }
    container.remove();
  }

  job.onProgress("Assembling the PDF...");
  const pdf = new jsPDF({
    orientation: job.orientation,
    unit: "mm",
    format: "letter",
  });
  const { page, map: m, footerY } = layout;

  // Title block
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(16);
  pdf.setTextColor(20, 83, 45);
  pdf.text(job.title || "Map", m.x, 16);
  if (job.subtitle) {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    pdf.setTextColor(90, 90, 90);
    pdf.text(job.subtitle, m.x + m.w, 16, { align: "right" });
  }

  // Map with a hairline border
  pdf.addImage(dataUrl, "JPEG", m.x, m.y, m.w, m.h);
  pdf.setDrawColor(180, 180, 180);
  pdf.setLineWidth(0.2);
  pdf.rect(m.x, m.y, m.w, m.h);

  // Legend: only the checked layers, flowing in columns.
  pdf.setFontSize(8);
  pdf.setTextColor(60, 60, 60);
  const colWidth = 52;
  const rowHeight = 5;
  const legendRows = Math.max(3, Math.ceil(job.legend.length / 4));
  job.legend.forEach((entry, i) => {
    const col = Math.floor(i / legendRows);
    const rowIdx = i % legendRows;
    const x = m.x + col * colWidth;
    const y = footerY + rowIdx * rowHeight;
    const [r, g, b2] = [1, 3, 5].map((o) =>
      parseInt(entry.color.slice(o, o + 2), 16)
    );
    if (entry.kind === "fill") {
      pdf.setFillColor(r, g, b2);
      pdf.rect(x, y - 2.6, 5, 3.2, "F");
      pdf.setDrawColor(r, g, b2);
      pdf.rect(x, y - 2.6, 5, 3.2);
    } else if (entry.kind === "outline") {
      pdf.setDrawColor(r, g, b2);
      pdf.setLineWidth(0.6);
      pdf.rect(x, y - 2.6, 5, 3.2);
    } else if (entry.kind === "point") {
      pdf.setFillColor(r, g, b2);
      pdf.circle(x + 2.5, y - 1, 1.4, "F");
    } else {
      pdf.setDrawColor(r, g, b2);
      pdf.setLineWidth(0.8);
      if (entry.kind === "dash") {
        pdf.setLineDashPattern([1.6, 1], 0);
      } else if (entry.kind === "dotdash") {
        pdf.setLineDashPattern([1.4, 0.8, 0.3, 0.8], 0);
      } else {
        pdf.setLineDashPattern([], 0);
      }
      pdf.line(x, y - 1, x + 5, y - 1);
      pdf.setLineDashPattern([], 0);
    }
    pdf.setTextColor(60, 60, 60);
    pdf.text(entry.label, x + 6.5, y);
  });

  // Scale bar (bottom right of the footer strip)
  const bar = niceScaleBar(groundFtAcross);
  const barMm = (bar.feet / groundFtAcross) * m.w;
  const barX = m.x + m.w - barMm;
  const barY = footerY + 2;
  pdf.setDrawColor(40, 40, 40);
  pdf.setLineWidth(0.5);
  pdf.line(barX, barY, barX + barMm, barY);
  pdf.line(barX, barY - 1.2, barX, barY + 1.2);
  pdf.line(barX + barMm, barY - 1.2, barX + barMm, barY + 1.2);
  pdf.setFontSize(8);
  pdf.setTextColor(40, 40, 40);
  pdf.text(bar.label, barX + barMm / 2, barY + 4.2, { align: "center" });

  // North indicator above the scale bar
  const nX = m.x + m.w - 5;
  const nY = footerY + 12;
  pdf.setFillColor(40, 40, 40);
  pdf.triangle(nX, nY - 4, nX - 1.6, nY, nX + 1.6, nY, "F");
  pdf.setFontSize(8);
  pdf.text("N", nX, nY + 3.4, { align: "center" });

  // Brand lockup bottom-right corner (rasterized logo, text fallback)
  const lockup = await loadLockupPng();
  if (lockup) {
    const w = 26;
    pdf.addImage(lockup, "PNG", page.w - 12 - w, page.h - 12.5, w, w * 0.21);
    pdf.setFontSize(5.5);
    pdf.setTextColor(20, 83, 45);
    pdf.text("LANDOWNER", page.w - 12, page.h - 6.8, {
      align: "right", charSpace: 0.5,
    });
  } else {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.setTextColor(20, 83, 45);
    pdf.text("TURNROW LANDOWNER", page.w - 12, page.h - 8, { align: "right" });
  }

  // Required imagery attribution
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(6);
  pdf.setTextColor(130, 130, 130);
  pdf.text("© Mapbox © OpenStreetMap © Maxar", m.x, page.h - 7);

  const slug =
    (job.title || "map")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "map";
  const date = new Date().toISOString().slice(0, 10);
  pdf.save(`${slug}-${date}.pdf`);
}
