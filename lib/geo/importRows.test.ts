import { describe, expect, it } from "vitest";
import type { MultiPolygon } from "geojson";
import {
  buildImportRows,
  defaultPolygonTypeFor,
  importValidationError,
  type ImportRow,
} from "./importRows";
import type { ParseResult } from "./parse";

// A property boundary near Courtland and a field well inside it.
const property: MultiPolygon = {
  type: "MultiPolygon",
  coordinates: [[[[-87.32, 34.64], [-87.28, 34.64], [-87.28, 34.67], [-87.32, 34.67], [-87.32, 34.64]]]],
};
const fieldInside: MultiPolygon = {
  type: "MultiPolygon",
  coordinates: [[[[-87.31, 34.65], [-87.30, 34.65], [-87.30, 34.66], [-87.31, 34.66], [-87.31, 34.65]]]],
};
const fieldElsewhere: MultiPolygon = {
  type: "MultiPolygon",
  coordinates: [[[[-86.0, 33.0], [-85.99, 33.0], [-85.99, 33.01], [-86.0, 33.01], [-86.0, 33.0]]]],
};

const parsed: ParseResult = {
  features: [
    { kind: "polygon", geometry: fieldInside, attributes: { name: "North 80" }, suggestedName: "North 80", sourceIndex: 0 },
    { kind: "polygon", geometry: fieldElsewhere, attributes: {}, suggestedName: "Feature 2", sourceIndex: 1 },
    { kind: "line", geometry: { type: "MultiLineString", coordinates: [[[-87.31, 34.65], [-87.305, 34.655]]] }, attributes: {}, suggestedName: "Feature 3", sourceIndex: 2 },
    { kind: "point", geometry: { type: "Point", coordinates: [-87.305, 34.655] }, attributes: { name: "Well" }, suggestedName: "Well", sourceIndex: 3 },
  ],
  skipped: [],
};

describe("buildImportRows", () => {
  const rows = buildImportRows("farm.kml", parsed, {
    defaultPolygonType: "field",
    matchableProperties: [{ id: "p1", boundary: property }],
    random: () => "abc123",
  });

  it("types polygons by the default, lines as roads, points as assets", () => {
    expect(rows.map((r) => r.entityType)).toEqual(["field", "field", "road", "asset"]);
    expect(rows[2].assetType).toBe("underground_pipe");
    expect(rows[3].assetType).toBe("other");
  });
  it("preassigns the containing property and leaves the rest unassigned", () => {
    expect(rows[0].propertyRef).toBe("existing:p1");
    expect(rows[0].suggestedRef).toBe("existing:p1");
    expect(rows[1].propertyRef).toBe("");
    expect(rows[1].suggestedRef).toBeNull();
    expect(rows[2].propertyRef).toBe("existing:p1");
    expect(rows[3].propertyRef).toBe("existing:p1");
  });
  it("keeps names, acres for polygons only, and the source file", () => {
    expect(rows[0].name).toBe("North 80");
    expect(rows[0].acres).toBeGreaterThan(200);
    expect(rows[2].acres).toBeNull();
    expect(rows.every((r) => r.sourceFile === "farm.kml" && r.include)).toBe(true);
    expect(rows[0].localId).toBe("farm.kml-0-abc123");
  });
  it("never preassigns a property to a new property boundary", () => {
    const asProps = buildImportRows("farm.kml", parsed, {
      defaultPolygonType: "property",
      matchableProperties: [{ id: "p1", boundary: property }],
    });
    expect(asProps[0].entityType).toBe("property");
    expect(asProps[0].propertyRef).toBe("");
    expect(asProps[0].suggestedRef).toBe("existing:p1"); // still known, for when the type changes
  });
});

describe("defaultPolygonTypeFor", () => {
  it("starts a new account with a property, an existing one with a field", () => {
    expect(defaultPolygonTypeFor(0)).toBe("property");
    expect(defaultPolygonTypeFor(3)).toBe("field");
  });
});

describe("importValidationError", () => {
  const base: ImportRow = {
    localId: "a",
    include: true,
    kind: "polygon",
    entityType: "field",
    assetType: "other",
    name: "North 80",
    propertyRef: "existing:p1",
    suggestedRef: null,
    geometry: fieldInside,
    acres: 10,
    sourceFile: "farm.kml",
  };
  it("passes clean rows and ignores excluded ones", () => {
    expect(importValidationError([base])).toBeNull();
    expect(importValidationError([{ ...base, include: false, name: "" }])).toBeNull();
  });
  it("needs a name on everything and a property on land", () => {
    expect(importValidationError([{ ...base, name: "  " }])).toMatch(/needs a name/);
    expect(importValidationError([{ ...base, propertyRef: "" }])).toMatch(/assigned to a property/);
    expect(importValidationError([{ ...base, entityType: "property", propertyRef: "" }])).toBeNull();
    expect(importValidationError([{ ...base, entityType: "asset", propertyRef: "" }])).toBeNull();
  });
});
