import type { Feature, FeatureCollection, Geometry, Position } from "geojson";

// Writes the map's shapes out as KML (Google Earth, onX, most farm and
// mapping software) or GeoJSON (GIS tools). Pure: the map hands in
// already-described features; nothing here knows about Supabase rows.
// The KML round-trips through lib/geo/parse.ts: Placemark names come
// back as the suggested name and ExtendedData comes back as attributes.

export interface ExportFeature {
  id: string;
  name: string;
  // Folder the placemark is filed under ("Ag fields", "Timber stands").
  folder: string;
  // Style key shared by every feature of a kind ("field", "timber_stand:hardwood").
  styleKey: string;
  // #rrggbb, the color the map draws this kind in.
  color: string;
  // One line: "Ag field · 78.3 ac · Smith Place".
  description: string;
  // Attributes that travel with the shape (acres, property, parcel number).
  data: Record<string, string | number | null | undefined>;
  geometry: Geometry;
}

export type ExportFormat = "kml" | "geojson";

export const EXPORT_MIME: Record<ExportFormat, string> = {
  kml: "application/vnd.google-earth.kml+xml",
  geojson: "application/geo+json",
};

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// KML colors are aabbggrr (alpha first, then blue, green, red).
export function kmlColor(hex: string, alpha = 0xff): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  const [r, g, b] = m ? [m[1], m[2], m[3]] : ["ff", "ff", "ff"];
  const a = Math.max(0, Math.min(255, Math.round(alpha))).toString(16).padStart(2, "0");
  return (a + b + g + r).toLowerCase();
}

// Seven decimals is about a centimeter; anything finer just bloats the file.
function coord(p: Position): string {
  const lon = Number(p[0].toFixed(7));
  const lat = Number(p[1].toFixed(7));
  return `${lon},${lat},0`;
}

function ring(positions: Position[]): string {
  return `<LinearRing><coordinates>${positions.map(coord).join(" ")}</coordinates></LinearRing>`;
}

function polygonXml(rings: Position[][]): string {
  const [outer, ...holes] = rings;
  if (!outer) return "";
  return (
    "<Polygon><tessellate>1</tessellate>" +
    `<outerBoundaryIs>${ring(outer)}</outerBoundaryIs>` +
    holes.map((h) => `<innerBoundaryIs>${ring(h)}</innerBoundaryIs>`).join("") +
    "</Polygon>"
  );
}

function lineXml(positions: Position[]): string {
  return `<LineString><tessellate>1</tessellate><coordinates>${positions.map(coord).join(" ")}</coordinates></LineString>`;
}

function pointXml(p: Position): string {
  return `<Point><coordinates>${coord(p)}</coordinates></Point>`;
}

function multi(parts: string[]): string {
  const kept = parts.filter(Boolean);
  if (kept.length === 0) return "";
  return kept.length === 1 ? kept[0] : `<MultiGeometry>${kept.join("")}</MultiGeometry>`;
}

export function geometryXml(g: Geometry): string {
  switch (g.type) {
    case "Point":
      return pointXml(g.coordinates);
    case "MultiPoint":
      return multi(g.coordinates.map(pointXml));
    case "LineString":
      return lineXml(g.coordinates);
    case "MultiLineString":
      return multi(g.coordinates.map(lineXml));
    case "Polygon":
      return polygonXml(g.coordinates);
    case "MultiPolygon":
      return multi(g.coordinates.map(polygonXml));
    case "GeometryCollection":
      return multi(g.geometries.map(geometryXml));
    default:
      return "";
  }
}

function styleXml(id: string, color: string): string {
  const line = kmlColor(color, 0xff);
  const fill = kmlColor(color, 0x59); // ~35%: shapes stay readable over imagery
  return (
    `<Style id="${escapeXml(id)}">` +
    `<LineStyle><color>${line}</color><width>2.5</width></LineStyle>` +
    `<PolyStyle><color>${fill}</color></PolyStyle>` +
    `<IconStyle><color>${line}</color><scale>1</scale></IconStyle>` +
    "</Style>"
  );
}

function dataXml(data: ExportFeature["data"]): string {
  const rows = Object.entries(data).filter(
    ([, v]) => v !== null && v !== undefined && String(v).trim() !== ""
  );
  if (rows.length === 0) return "";
  return (
    "<ExtendedData>" +
    rows
      .map(([k, v]) => `<Data name="${escapeXml(k)}"><value>${escapeXml(String(v))}</value></Data>`)
      .join("") +
    "</ExtendedData>"
  );
}

function placemarkXml(f: ExportFeature): string {
  const geom = geometryXml(f.geometry);
  if (!geom) return "";
  return (
    "<Placemark>" +
    `<name>${escapeXml(f.name)}</name>` +
    (f.description ? `<description>${escapeXml(f.description)}</description>` : "") +
    `<styleUrl>#${escapeXml(f.styleKey)}</styleUrl>` +
    dataXml(f.data) +
    geom +
    "</Placemark>"
  );
}

// Style ids must be valid XML ids: letters, digits, dot, dash, underscore.
export function styleId(key: string): string {
  return key.replace(/[^A-Za-z0-9_.-]+/g, "-");
}

export function buildKml(
  features: ExportFeature[],
  opts: { documentName: string; description?: string }
): string {
  // Folders in first-seen order (the caller hands features grouped by kind).
  const folders = new Map<string, ExportFeature[]>();
  const styles = new Map<string, string>();
  for (const f of features) {
    const list = folders.get(f.folder) ?? [];
    list.push(f);
    folders.set(f.folder, list);
    const id = styleId(f.styleKey);
    if (!styles.has(id)) styles.set(id, f.color);
  }

  const parts: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    "<Document>",
    `<name>${escapeXml(opts.documentName)}</name>`,
  ];
  if (opts.description) parts.push(`<description>${escapeXml(opts.description)}</description>`);
  for (const [id, color] of styles) parts.push(styleXml(id, color));
  for (const [folder, list] of folders) {
    parts.push(`<Folder><name>${escapeXml(folder)}</name>`);
    for (const f of list) {
      parts.push(placemarkXml({ ...f, styleKey: styleId(f.styleKey) }));
    }
    parts.push("</Folder>");
  }
  parts.push("</Document>", "</kml>");
  return parts.join("\n");
}

export function buildGeoJson(features: ExportFeature[]): FeatureCollection {
  const out: Feature[] = features.map((f) => ({
    type: "Feature",
    id: f.id,
    geometry: f.geometry,
    properties: {
      name: f.name,
      folder: f.folder,
      description: f.description,
      ...Object.fromEntries(
        Object.entries(f.data).filter(([, v]) => v !== null && v !== undefined)
      ),
    },
  }));
  return { type: "FeatureCollection", features: out };
}

export function serializeExport(
  features: ExportFeature[],
  format: ExportFormat,
  opts: { documentName: string; description?: string }
): string {
  return format === "kml"
    ? buildKml(features, opts)
    : JSON.stringify(buildGeoJson(features), null, 1);
}

// "Smith Family Farms" -> "smith-family-farms"; empty falls back.
export function fileSlug(name: string | null | undefined, fallback = "turnrow"): string {
  const slug = (name ?? "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

export function exportFileName(base: string, format: ExportFormat, date = new Date()): string {
  const day = date.toISOString().slice(0, 10);
  return `${base}-${day}.${format}`;
}

// Browser-only: hands the text to the user as a file download.
export function downloadTextFile(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a beat to start the download before revoking.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
