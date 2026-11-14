import { describe, expect, it } from "vitest";
import { stripGeometry, toolResultText } from "./assistantResult";

const polygon = {
  type: "MultiPolygon",
  coordinates: [[[[-87.3, 34.6], [-87.2, 34.6], [-87.2, 34.7], [-87.3, 34.6]]]],
};

describe("stripGeometry", () => {
  it("drops boundary GeoJSON and keeps the attributes", () => {
    const row = { id: "p1", parcel_number: "02 04 18", acres: 82.7, boundary_geojson: polygon };
    expect(stripGeometry(row)).toEqual({ id: "p1", parcel_number: "02 04 18", acres: 82.7 });
  });
  it("drops geometry held under any key, at any depth", () => {
    const result = { rows: [{ name: "Blythe", shape: polygon, nested: { geom: polygon, acres: 5 } }] };
    expect(stripGeometry(result)).toEqual({ rows: [{ name: "Blythe", nested: { acres: 5 } }] });
  });
  it("leaves ordinary objects and text alone", () => {
    const row = { name: "Boundary Road", notes: "boundary surveyed 1988", type: "ag", details: { type: "pivot" } };
    expect(stripGeometry(row)).toEqual(row);
  });
});

describe("toolResultText", () => {
  it("returns the whole result when it fits", () => {
    const result = { rows: [{ a: 1 }, { a: 2 }], count: 2 };
    expect(JSON.parse(toolResultText(result))).toEqual(result);
  });

  it("never cuts a record in half: drops whole rows and says so", () => {
    const rows = Array.from({ length: 500 }, (_, i) => ({ id: i, name: "Parcel " + i, note: "x".repeat(100) }));
    const text = toolResultText({ rows }, 5_000);
    expect(text.length).toBeLessThanOrEqual(5_000);
    const parsed = JSON.parse(text); // valid JSON, not a slice
    expect(parsed.truncated).toBe(true);
    expect(parsed.rows_total).toBe(500);
    expect(parsed.rows_shown).toBe(parsed.rows.length);
    expect(parsed.rows.length).toBeGreaterThan(0);
    expect(parsed.rows.length).toBeLessThan(500);
    expect(parsed.rows[0]).toEqual(rows[0]);
    expect(parsed.note).toMatch(/Do not total/);
  });

  it("handles a bare array result", () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ id: i, pad: "y".repeat(50) }));
    const parsed = JSON.parse(toolResultText(rows, 2_000));
    expect(parsed.truncated).toBe(true);
    expect(parsed.rows_total).toBe(200);
    expect(Array.isArray(parsed.rows)).toBe(true);
  });

  it("keeps the other fields of the result when it shortens the list", () => {
    const rows = Array.from({ length: 300 }, (_, i) => ({ id: i, pad: "z".repeat(60) }));
    const parsed = JSON.parse(toolResultText({ year: 2026, total: 12345.67, items: rows }, 3_000));
    expect(parsed.year).toBe(2026);
    expect(parsed.total).toBe(12345.67);
    expect(parsed.items.length).toBeLessThan(300);
    expect(parsed.rows_total).toBe(300);
  });

  it("strips geometry first, so a list of parcels fits that would not have", () => {
    const big = { type: "MultiPolygon", coordinates: [[Array.from({ length: 2000 }, (_, i) => [i, i])]] };
    const rows = Array.from({ length: 83 }, (_, i) => ({ parcel_number: String(i), acres: i, boundary_geojson: big }));
    const parsed = JSON.parse(toolResultText({ rows }, 100_000));
    expect(parsed.truncated).toBeUndefined();
    expect(parsed.rows.length).toBe(83);
    expect(parsed.rows[0].boundary_geojson).toBeUndefined();
  });

  it("gives a clear note when even one row cannot fit", () => {
    const parsed = JSON.parse(toolResultText({ rows: [{ text: "q".repeat(10_000) }] }, 500));
    expect(parsed.truncated).toBe(true);
    expect(parsed.note).toMatch(/too large/);
  });
});
