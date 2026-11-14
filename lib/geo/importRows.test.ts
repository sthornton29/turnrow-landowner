import { describe, expect, it } from "vitest";
import type { MultiPolygon } from "geojson";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildImportRows,
  defaultPolygonTypeFor,
  importValidationError,
  saveImportRows,
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

// A stand-in for the Supabase client that records what the save does:
// which rows went in, which shapes were set, and which rows were taken
// back out. geometryFails names the rows whose shape is refused.
function fakeSupabase(opts: { geometryFails?: string[]; deleteFails?: boolean } = {}) {
  const inserted: Array<{ table: string; id: string; name: string }> = [];
  const deleted: Array<{ table: string; id: string }> = [];
  let nextId = 1;
  const client = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          const id = `id-${nextId++}`;
          inserted.push({ table, id, name: String(row.name ?? row.parcel_number) });
          return { select: () => ({ single: async () => ({ data: { id }, error: null }) }) };
        },
        delete() {
          return {
            eq: async (_column: string, id: string) => {
              if (opts.deleteFails) return { error: { message: "permission denied for table" } };
              deleted.push({ table, id });
              return { error: null };
            },
          };
        },
      };
    },
    async rpc(_fn: string, args: { p_entity_id: string }) {
      const row = inserted.find((r) => r.id === args.p_entity_id);
      return opts.geometryFails?.includes(row?.name ?? "")
        ? { error: { code: "P0001", message: "Geometry contains no polygon" } }
        : { error: null };
    },
  };
  return { client: client as unknown as SupabaseClient, inserted, deleted };
}

describe("saveImportRows", () => {
  const row = (localId: string, name: string, patch: Partial<ImportRow> = {}): ImportRow => ({
    localId,
    include: true,
    kind: "polygon",
    entityType: "field",
    assetType: "other",
    name,
    propertyRef: "existing:p1",
    suggestedRef: null,
    geometry: fieldInside,
    acres: 10,
    sourceFile: "farm.kml",
    ...patch,
  });

  it("saves every included row and reports them as saved", async () => {
    const db = fakeSupabase();
    const result = await saveImportRows(db.client, "org1", [
      row("a", "North 80"),
      row("b", "South 40"),
      row("c", "Left out", { include: false }),
    ]);
    expect(result).toEqual({ saved: 2, failures: [], savedLocalIds: ["a", "b"] });
    expect(db.inserted.map((r) => r.name)).toEqual(["North 80", "South 40"]);
    expect(db.deleted).toEqual([]);
  });

  it("takes the row back out when its shape fails, so a retry starts clean", async () => {
    const db = fakeSupabase({ geometryFails: ["South 40"] });
    const result = await saveImportRows(db.client, "org1", [row("a", "North 80"), row("b", "South 40")]);
    expect(result.savedLocalIds).toEqual(["a"]);
    expect(result.saved).toBe(1);
    const south = db.inserted.find((r) => r.name === "South 40")!;
    expect(db.deleted).toEqual([{ table: "fields", id: south.id }]);
    expect(result.failures).toEqual(["South 40: nothing was saved. Its shape could not be stored."]);
    // No raw database text reaches the message.
    expect(result.failures[0]).not.toMatch(/Geometry contains/);
  });

  it("removes a new property whose boundary fails, and skips what belonged to it", async () => {
    const db = fakeSupabase({ geometryFails: ["Home Place"] });
    const result = await saveImportRows(db.client, "org1", [
      row("p", "Home Place", { entityType: "property", propertyRef: "" }),
      row("f", "North 80", { propertyRef: "new:p" }),
    ]);
    expect(result.saved).toBe(0);
    expect(db.deleted.map((d) => d.table)).toEqual(["properties"]);
    expect(db.inserted.map((r) => r.table)).toEqual(["properties"]);
    expect(result.failures).toEqual([
      "Home Place: nothing was saved. Its shape could not be stored.",
      "North 80: its property was not saved, skipped.",
    ]);
  });

  it("says so when the leftover row could not be removed", async () => {
    const db = fakeSupabase({ geometryFails: ["South 40"], deleteFails: true });
    const result = await saveImportRows(db.client, "org1", [row("b", "South 40")]);
    expect(result.saved).toBe(0);
    expect(result.failures).toEqual([
      'South 40: Its shape could not be stored. A record named "South 40" was left with no shape; delete it before trying again.',
    ]);
  });
});
