import { describe, expect, it } from "vitest";
import {
  groupOpenIssues,
  issueColor,
  issueGeometryKind,
  issueTitle,
  issueValid,
  toggleStatus,
} from "./maintenance";

describe("issueGeometryKind", () => {
  it("tells a pin, a line, and an area apart", () => {
    expect(issueGeometryKind({ type: "Point", coordinates: [0, 0] })).toBe("point");
    expect(issueGeometryKind({ type: "MultiPoint", coordinates: [[0, 0]] })).toBe("point");
    expect(issueGeometryKind({ type: "LineString", coordinates: [[0, 0], [1, 1]] })).toBe("line");
    expect(issueGeometryKind({ type: "MultiLineString", coordinates: [[[0, 0], [1, 1]]] })).toBe("line");
    expect(issueGeometryKind({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] })).toBe("area");
    expect(issueGeometryKind({ type: "MultiPolygon", coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]]] })).toBe("area");
    expect(issueGeometryKind(null)).toBeNull();
  });
});

describe("toggleStatus", () => {
  it("resolving stamps the time, reopening clears it", () => {
    const now = new Date("2026-08-22T12:00:00Z");
    expect(toggleStatus({ status: "open" }, now)).toEqual({ status: "resolved", resolved_at: "2026-08-22T12:00:00.000Z" });
    expect(toggleStatus({ status: "resolved" }, now)).toEqual({ status: "open", resolved_at: null });
  });
});

describe("issueValid and issueTitle", () => {
  it("requires a label for other and a known type", () => {
    expect(issueValid({ issue_type: "other", label: "" })).toBe("Give the issue a label.");
    expect(issueValid({ issue_type: "other", label: "Fence down" })).toBeNull();
    expect(issueValid({ issue_type: "sinkhole" })).toBeNull();
    expect(issueValid({ issue_type: "volcano" })).toBe("Pick an issue type.");
  });
  it("titles read type then label", () => {
    expect(issueTitle({ issue_type: "wash", label: null })).toBe("Wash");
    expect(issueTitle({ issue_type: "wash", label: "south end" })).toBe("Wash: south end");
    expect(issueTitle({ issue_type: "other", label: "Fence down" })).toBe("Fence down");
  });
});

describe("issueColor", () => {
  it("is amber open, red high, gray resolved", () => {
    expect(issueColor({ status: "open", severity: "low" }).fill).toBe("#f59e0b");
    expect(issueColor({ status: "open", severity: "high" }).fill).toBe("#dc2626");
    expect(issueColor({ status: "resolved", severity: "high" }).fill).toBe("#9ca3af");
  });
});

describe("groupOpenIssues", () => {
  const properties = [{ id: "p1", name: "River" }, { id: "p2", name: "Shop Area" }];
  const fields = [{ id: "f1", name: "North 40", property_id: "p1" }];
  const issues = [
    { id: "a", issue_type: "wash", label: null, severity: "low", status: "open", property_id: "p1", field_id: "f1", created_at: "2026-08-01" },
    { id: "b", issue_type: "sinkhole", label: null, severity: "high", status: "open", property_id: "p1", field_id: null, created_at: "2026-08-02" },
    { id: "c", issue_type: "road_washout", label: null, severity: null, status: "resolved", property_id: "p1", field_id: null, created_at: "2026-08-03" },
    { id: "d", issue_type: "other", label: "Gate", severity: "medium", status: "open", property_id: null, field_id: null, created_at: "2026-08-04" },
    { id: "e", issue_type: "broken_terrace", label: null, severity: "medium", status: "open", property_id: "p1", field_id: "f1", created_at: "2026-08-05" },
  ];
  it("groups open issues by property then field, severity first, resolved excluded", () => {
    const g = groupOpenIssues(issues, properties, fields);
    expect(g.map((x) => [x.propertyName, x.count])).toEqual([["River", 3], ["No property", 1]]);
    const river = g[0];
    expect(river.fields.map((f) => [f.fieldName, f.issues.map((i) => i.id)])).toEqual([
      [null, ["b"]],
      ["North 40", ["e", "a"]],
    ]);
  });
});
