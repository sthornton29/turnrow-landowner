import { beforeAll, describe, expect, it } from "vitest";
import type { FeatureCollection, MultiPolygon } from "geojson";
import { kml as kmlToGeoJSON } from "@tmcw/togeojson";
import { buildKml, type ExportFeature } from "./kml";
import { NOT_LAT_LON_MESSAGE, parseBoundaryFile, parseGeoJson } from "./parse";

// ---------------------------------------------------------------- KML reader
// Node has no DOMParser. This is the small part of the DOM that
// @tmcw/togeojson reads from a KML document, so the tests below run the
// real KML reader over real KML text instead of a hand-made stand-in for
// its output.

class MiniText {
  nodeType = 3;
  nodeName = "#text";
  parentNode: MiniElement | null = null;
  constructor(public textContent: string) {}
}

class MiniElement {
  nodeType = 1;
  parentNode: MiniElement | null = null;
  attributes: Record<string, string> = {};
  childNodes: Array<MiniElement | MiniText> & { item: (i: number) => MiniElement | MiniText | null };
  constructor(public tagName: string) {
    const list = [] as unknown as MiniElement["childNodes"];
    list.item = (i: number) => list[i] ?? null;
    this.childNodes = list;
  }
  get nodeName(): string {
    return this.tagName;
  }
  get localName(): string {
    return this.tagName.split(":").pop() ?? this.tagName;
  }
  get children(): MiniElement[] {
    return this.childNodes.filter((c): c is MiniElement => c.nodeType === 1);
  }
  get textContent(): string {
    return this.childNodes.map((c) => c.textContent).join("");
  }
  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }
  getElementsByTagName(name: string): MiniElement[] {
    const found: MiniElement[] = [];
    const walk = (el: MiniElement) => {
      for (const c of el.children) {
        if (name === "*" || c.tagName === name) found.push(c);
        walk(c);
      }
    };
    walk(this);
    return found;
  }
  getElementsByTagNameNS(): MiniElement[] {
    return [];
  }
  normalize() {}
}

function decode(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function parseXml(text: string): MiniElement {
  const root = new MiniElement("#document");
  let current = root;
  const token =
    /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\/([^\s>]+)\s*>|<([^\s>/]+)((?:\s+[^\s=>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = token.exec(text))) {
    const [, cdata, closeTag, openTag, attrs, selfClosing, chars] = m;
    const append = (node: MiniElement | MiniText) => {
      node.parentNode = current;
      current.childNodes.push(node);
    };
    if (cdata !== undefined) append(new MiniText(cdata));
    else if (closeTag) current = current.parentNode ?? root;
    else if (openTag) {
      const el = new MiniElement(openTag);
      for (const a of (attrs ?? "").matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        el.attributes[a[1]] = decode(a[2] ?? a[3] ?? "");
      }
      append(el);
      if (!selfClosing) current = el;
    } else if (chars !== undefined) append(new MiniText(decode(chars)));
  }
  return root;
}

beforeAll(() => {
  (globalThis as unknown as { DOMParser: unknown }).DOMParser = class {
    parseFromString(text: string) {
      return parseXml(text);
    }
  };
});

function fileOf(name: string, text: string): File {
  return new File([text], name);
}

// ---------------------------------------------------------------- fixtures

// A field near Courtland.
const ring = [[-87.31, 34.65], [-87.30364, 34.65], [-87.30364, 34.65572], [-87.31, 34.65572], [-87.31, 34.65]];
const hole = [[-87.308, 34.652], [-87.306, 34.652], [-87.306, 34.654], [-87.308, 34.654], [-87.308, 34.652]];

// What Google Earth writes: every point carries an altitude.
const googleEarthKml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>North 80.kml</name>
  <Placemark>
    <name>North 80</name>
    <Polygon>
      <tessellate>1</tessellate>
      <outerBoundaryIs><LinearRing><coordinates>
        -87.31,34.65,181.5 -87.30364,34.65,180.2 -87.30364,34.65572,179.9 -87.31,34.65572,182 -87.31,34.65,181.5
      </coordinates></LinearRing></outerBoundaryIs>
    </Polygon>
  </Placemark>
  <Placemark>
    <name>Turnrow</name>
    <LineString><coordinates>-87.31,34.65,0 -87.30,34.66,0</coordinates></LineString>
  </Placemark>
  <Placemark>
    <name>Well 2</name>
    <Point><coordinates>-87.305,34.652,178</coordinates></Point>
  </Placemark>
</Document>
</kml>`;

// Alabama West state plane feet: what a shapefile zip with no .prj, or a
// GeoJSON saved in the county's grid, hands over.
const statePlaneRing = [[1905123.4, 1712345.6], [1906123.4, 1712345.6], [1906123.4, 1713345.6], [1905123.4, 1712345.6]];
// Web Mercator meters for the same neighborhood.
const mercatorRing = [[-9719300.5, 4116200.2], [-9718300.5, 4116200.2], [-9718300.5, 4117200.2], [-9719300.5, 4116200.2]];

function positionsOf(g: unknown): number[][] {
  const out: number[][] = [];
  const walk = (c: unknown) => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === "number") out.push(c as number[]);
    else c.forEach(walk);
  };
  walk((g as { coordinates: unknown }).coordinates);
  return out;
}

// ---------------------------------------------------------------- tests

describe("parseGeoJson: altitudes", () => {
  it("cuts every position to [x, y]", () => {
    const parsed = parseGeoJson({
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { name: "North 80" }, geometry: { type: "Polygon", coordinates: [ring.map(([x, y]) => [x, y, 181.5])] } },
        { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[-87.31, 34.65, 0], [-87.3, 34.66, 0]] } },
        { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [-87.305, 34.652, 178] } },
      ],
    });
    expect(parsed.skipped).toEqual([]);
    expect(parsed.features.map((f) => f.kind)).toEqual(["polygon", "line", "point"]);
    expect(parsed.features[0].geometry).toEqual({ type: "MultiPolygon", coordinates: [[ring]] });
    expect(parsed.features[1].geometry).toEqual({ type: "MultiLineString", coordinates: [[[-87.31, 34.65], [-87.3, 34.66]]] });
    expect(parsed.features[2].geometry).toEqual({ type: "Point", coordinates: [-87.305, 34.652] });
  });
});

describe("parseGeoJson: coordinates that are not longitude/latitude", () => {
  it("refuses a file in state plane feet with the plain message", () => {
    expect(() =>
      parseGeoJson({ type: "Polygon", coordinates: [statePlaneRing] })
    ).toThrow(NOT_LAT_LON_MESSAGE);
  });
  it("refuses a file in Web Mercator meters", () => {
    expect(() =>
      parseGeoJson({
        type: "FeatureCollection",
        features: [
          { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [mercatorRing] } },
          { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [-9719300.5, 4116200.2] } },
        ],
      })
    ).toThrow(NOT_LAT_LON_MESSAGE);
  });
  it("refuses a shape with even one position off the globe", () => {
    const oneBad = ring.map((p, i) => (i === 2 ? [-87.30364, 3465572] : p));
    expect(() => parseGeoJson({ type: "Polygon", coordinates: [oneBad] })).toThrow(NOT_LAT_LON_MESSAGE);
  });
  it("keeps the good shapes of a mixed file and says how many were left out", () => {
    const mixed: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { name: "North 80" }, geometry: { type: "Polygon", coordinates: [ring] } },
        { type: "Feature", properties: { name: "Bad one" }, geometry: { type: "Polygon", coordinates: [statePlaneRing] } },
        { type: "Feature", properties: { name: "Bad two" }, geometry: { type: "Point", coordinates: [1905123.4, 1712345.6] } },
      ],
    };
    const parsed = parseGeoJson(mixed);
    expect(parsed.features.map((f) => f.suggestedName)).toEqual(["North 80"]);
    expect(parsed.skipped).toHaveLength(1);
    expect(parsed.skipped[0]).toMatch(/^2 shapes skipped: not in latitude and longitude\./);
  });
  it("still reports unusable geometry the old way", () => {
    const parsed = parseGeoJson({
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } },
        { type: "Feature", properties: {}, geometry: null as unknown as MultiPolygon },
      ],
    });
    expect(parsed.features).toHaveLength(1);
    expect(parsed.skipped).toEqual(["Feature 2: empty geometry is not usable, skipped."]);
  });
});

describe("parseBoundaryFile", () => {
  it("names the file when its coordinates are not longitude/latitude", async () => {
    const file = fileOf(
      "county-grid.geojson",
      JSON.stringify({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [statePlaneRing] } })
    );
    await expect(parseBoundaryFile(file)).rejects.toThrow(
      `Could not read county-grid.geojson: ${NOT_LAT_LON_MESSAGE}`
    );
  });

  it("reads a Google Earth KML and drops its altitudes", async () => {
    // The premise: the KML reader on its own keeps the third value.
    const raw = kmlToGeoJSON(parseXml(googleEarthKml) as unknown as Document);
    expect(positionsOf(raw.features[0].geometry)[0]).toEqual([-87.31, 34.65, 181.5]);

    const parsed = await parseBoundaryFile(fileOf("north80.kml", googleEarthKml));
    expect(parsed.skipped).toEqual([]);
    expect(parsed.features.map((f) => [f.kind, f.suggestedName])).toEqual([
      ["polygon", "North 80"],
      ["line", "Turnrow"],
      ["point", "Well 2"],
    ]);
    for (const f of parsed.features) {
      for (const p of positionsOf(f.geometry)) expect(p).toHaveLength(2);
    }
    expect(parsed.features[0].geometry).toEqual({ type: "MultiPolygon", coordinates: [[ring]] });
    expect(parsed.features[2].geometry).toEqual({ type: "Point", coordinates: [-87.305, 34.652] });
  });

  it("reads back this app's own KML export as two-dimensional shapes", async () => {
    const exported: ExportFeature[] = [
      {
        id: "f1",
        name: "North 80 <east half>",
        folder: "Ag fields",
        styleKey: "field",
        color: "#39b54a",
        description: "Ag field · 78.3 ac · Smith & Sons Place",
        data: { turnrow_type: "field", acres: 78.3, property: "Smith & Sons Place" },
        geometry: { type: "MultiPolygon", coordinates: [[ring, hole]] },
      },
      {
        id: "r1",
        name: "Turnrow",
        folder: "Roads",
        styleKey: "road",
        color: "#ffffff",
        description: "Road · 0.4 mi",
        data: { turnrow_type: "road" },
        geometry: { type: "MultiLineString", coordinates: [[[-87.31, 34.65], [-87.3, 34.66]]] },
      },
      {
        id: "w1",
        name: "Well 2",
        folder: "Assets",
        styleKey: "asset",
        color: "#bae6fd",
        description: "Well",
        data: { turnrow_type: "asset" },
        geometry: { type: "Point", coordinates: [-87.305, 34.652] },
      },
    ];
    const kml = buildKml(exported, { documentName: "Smith & Sons boundaries" });
    // The export writes ",0" on every point.
    expect(kml).toContain("-87.31,34.65,0");

    const parsed = await parseBoundaryFile(fileOf("smith-boundaries.kml", kml));
    expect(parsed.skipped).toEqual([]);
    expect(parsed.features.map((f) => f.suggestedName)).toEqual(["North 80 <east half>", "Turnrow", "Well 2"]);
    expect(parsed.features[0].geometry).toEqual(exported[0].geometry);
    expect(parsed.features[1].geometry).toEqual(exported[1].geometry);
    expect(parsed.features[2].geometry).toEqual(exported[2].geometry);
    expect(parsed.features[0].attributes).toMatchObject({ property: "Smith & Sons Place" });
  });
});
