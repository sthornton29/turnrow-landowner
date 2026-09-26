import { describe, expect, it } from "vitest";
import type { MultiPolygon } from "geojson";
import {
  buildGeoJson,
  buildKml,
  exportFileName,
  fileSlug,
  geometryXml,
  kmlColor,
  styleId,
  type ExportFeature,
} from "./kml";

const field: ExportFeature = {
  id: "f1",
  name: "North 80 <east half>",
  folder: "Ag fields",
  styleKey: "field",
  color: "#39b54a",
  description: "Ag field · 78.3 ac · Smith & Sons Place",
  data: { turnrow_type: "field", acres: 78.3, property: "Smith & Sons Place", notes: null },
  geometry: {
    type: "MultiPolygon",
    coordinates: [
      [
        [[-87.31, 34.65], [-87.30364, 34.65], [-87.30364, 34.65572], [-87.31, 34.65572], [-87.31, 34.65]],
        [[-87.308, 34.652], [-87.306, 34.652], [-87.306, 34.654], [-87.308, 34.654], [-87.308, 34.652]],
      ],
    ],
  },
};

const road: ExportFeature = {
  id: "r1",
  name: "Turnrow",
  folder: "Roads",
  styleKey: "road",
  color: "#ffffff",
  description: "Road · 0.4 mi",
  data: { turnrow_type: "road", miles: 0.4 },
  geometry: { type: "MultiLineString", coordinates: [[[-87.31, 34.65], [-87.30, 34.66]]] },
};

const well: ExportFeature = {
  id: "w1",
  name: "Well 2",
  folder: "Assets",
  styleKey: "asset",
  color: "#bae6fd",
  description: "Well",
  data: { turnrow_type: "asset", asset_type: "well" },
  geometry: { type: "Point", coordinates: [-87.3050000001, 34.6520000009] },
};

describe("kmlColor", () => {
  it("writes aabbggrr with the alpha first", () => {
    expect(kmlColor("#39b54a")).toBe("ff4ab539");
    expect(kmlColor("#39b54a", 0x59)).toBe("594ab539");
    expect(kmlColor("ffffff", 0)).toBe("00ffffff");
  });
  it("falls back to white for anything it cannot read", () => {
    expect(kmlColor("kelly")).toBe("ffffffff");
  });
});

describe("geometryXml", () => {
  it("writes a polygon with its holes as inner boundaries", () => {
    const xml = geometryXml(field.geometry);
    expect(xml.startsWith("<Polygon>")).toBe(true); // one polygon: no MultiGeometry wrapper
    expect(xml).toContain("<outerBoundaryIs>");
    expect(xml).toContain("<innerBoundaryIs>");
    expect(xml).toContain("-87.31,34.65,0 -87.30364,34.65,0");
  });
  it("wraps several parts in MultiGeometry and rounds to seven decimals", () => {
    const one = field.geometry as MultiPolygon;
    const two = geometryXml({
      type: "MultiPolygon",
      coordinates: [one.coordinates[0], one.coordinates[0]],
    });
    expect(two.startsWith("<MultiGeometry>")).toBe(true);
    expect(geometryXml(well.geometry)).toBe("<Point><coordinates>-87.305,34.652,0</coordinates></Point>");
  });
  it("writes lines with tessellate so they follow the terrain", () => {
    expect(geometryXml(road.geometry)).toContain("<LineString><tessellate>1</tessellate>");
  });
});

describe("buildKml", () => {
  const kml = buildKml([field, road, well], {
    documentName: "Smith & Sons boundaries",
    description: "Exported 2026-09-26",
  });

  it("is one KML document with a folder per kind, in first-seen order", () => {
    expect(kml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">')).toBe(true);
    expect(kml.trim().endsWith("</Document>\n</kml>")).toBe(true);
    const folders = [...kml.matchAll(/<Folder><name>([^<]+)<\/name>/g)].map((m) => m[1]);
    expect(folders).toEqual(["Ag fields", "Roads", "Assets"]);
  });
  it("escapes names, descriptions, and data so ampersands and brackets survive", () => {
    expect(kml).toContain("<name>Smith &amp; Sons boundaries</name>");
    expect(kml).toContain("<name>North 80 &lt;east half&gt;</name>");
    expect(kml).toContain("<description>Ag field · 78.3 ac · Smith &amp; Sons Place</description>");
    expect(kml).not.toContain("<east half>");
  });
  it("defines one style per kind and points each placemark at it", () => {
    expect(kml.match(/<Style id="field">/g)?.length).toBe(1);
    expect(kml).toContain("<LineStyle><color>ff4ab539</color>");
    expect(kml).toContain("<PolyStyle><color>594ab539</color>");
    expect(kml).toContain("<styleUrl>#field</styleUrl>");
    expect(kml).toContain("<styleUrl>#road</styleUrl>");
  });
  it("carries attributes as ExtendedData and drops empty ones", () => {
    expect(kml).toContain('<Data name="acres"><value>78.3</value></Data>');
    expect(kml).toContain('<Data name="property"><value>Smith &amp; Sons Place</value></Data>');
    expect(kml).not.toContain('<Data name="notes">');
  });
  it("skips a feature whose geometry cannot be written", () => {
    const empty = buildKml(
      [{ ...well, geometry: { type: "MultiPolygon", coordinates: [] } }],
      { documentName: "x" }
    );
    expect(empty).not.toContain("<Placemark>");
    expect(empty).toContain("<Folder><name>Assets</name>");
  });
});

describe("buildGeoJson", () => {
  it("keeps the name, folder, description, and attributes as properties", () => {
    const fc = buildGeoJson([field, well]);
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(2);
    expect(fc.features[0].id).toBe("f1");
    expect(fc.features[0].properties).toMatchObject({
      name: "North 80 <east half>",
      folder: "Ag fields",
      acres: 78.3,
      property: "Smith & Sons Place",
    });
    expect(fc.features[0].properties).not.toHaveProperty("notes");
    expect(fc.features[1].geometry).toEqual(well.geometry);
  });
});

describe("file names", () => {
  it("slugs the organization name and dates the file", () => {
    expect(fileSlug("Smith's Family Farms, LLC")).toBe("smiths-family-farms-llc");
    expect(fileSlug("   ")).toBe("turnrow");
    expect(fileSlug(null, "boundary")).toBe("boundary");
    expect(exportFileName("smith-boundaries", "kml", new Date("2026-09-26T15:00:00Z"))).toBe(
      "smith-boundaries-2026-09-26.kml"
    );
  });
  it("keeps style ids valid XML ids", () => {
    expect(styleId("timber_stand:natural pine")).toBe("timber_stand-natural-pine");
  });
});
