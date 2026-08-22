// Maintenance issues: problems on the land that need attention (a bad
// wash, a sinkhole, a broken terrace, a road washout, anything else
// with its own label). Their own map layer, not a land type: warning
// colors (amber, red for high severity, gray once resolved), a pin, a
// line, or an area per issue, and an open/resolved status that makes
// the map a lightweight to-do list. Pure; unit tested in
// maintenance.test.ts.

import type { Geometry } from "geojson";

export type IssueType = "wash" | "sinkhole" | "broken_terrace" | "road_washout" | "other";
export type IssueSeverity = "low" | "medium" | "high";
export type IssueStatus = "open" | "resolved";
export type IssueGeometryKind = "point" | "line" | "area";

export const ISSUE_TYPES: IssueType[] = ["wash", "sinkhole", "broken_terrace", "road_washout", "other"];

export const ISSUE_TYPE_LABELS: Record<IssueType, string> = {
  wash: "Wash",
  sinkhole: "Sinkhole",
  broken_terrace: "Broken terrace",
  road_washout: "Road washout",
  other: "Other",
};

export const ISSUE_TYPE_HINTS: Record<IssueType, string> = {
  wash: "Gully or eroded channel; usually an area",
  sinkhole: "Usually a pin",
  broken_terrace: "A failed section; usually a line",
  road_washout: "Usually an area on the road",
  other: "Anything else; give it a label",
};

// The natural shape for each type; the user can still pick any.
export const ISSUE_DEFAULT_KIND: Record<IssueType, IssueGeometryKind> = {
  wash: "area",
  sinkhole: "point",
  broken_terrace: "line",
  road_washout: "area",
  other: "point",
};

export const SEVERITY_LABELS: Record<IssueSeverity, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

export const STATUS_LABELS: Record<IssueStatus, string> = {
  open: "Open",
  resolved: "Resolved",
};

// Warning palette: amber for open, red for open and high, gray resolved.
export const ISSUE_COLORS = {
  open: { fill: "#f59e0b", line: "#b45309" },
  high: { fill: "#dc2626", line: "#991b1b" },
  resolved: { fill: "#9ca3af", line: "#6b7280" },
} as const;

export function issueColor(issue: { status: string; severity?: string | null }): { fill: string; line: string } {
  if (issue.status === "resolved") return ISSUE_COLORS.resolved;
  return issue.severity === "high" ? ISSUE_COLORS.high : ISSUE_COLORS.open;
}

// Tailwind classes for the chips in lists and panels.
export function severityClass(severity: IssueSeverity | null | undefined): string {
  switch (severity) {
    case "high":
      return "bg-red-50 text-red-700";
    case "medium":
      return "bg-amber-50 text-amber-800";
    case "low":
      return "bg-amber-50 text-amber-700";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

export function statusClass(status: IssueStatus | string): string {
  return status === "resolved" ? "bg-gray-100 text-gray-600" : "bg-amber-100 text-amber-900";
}

export function issueGeometryKind(geom: Geometry | null | undefined): IssueGeometryKind | null {
  if (!geom) return null;
  switch (geom.type) {
    case "Point":
    case "MultiPoint":
      return "point";
    case "LineString":
    case "MultiLineString":
      return "line";
    case "Polygon":
    case "MultiPolygon":
      return "area";
    default:
      return null;
  }
}

export const GEOMETRY_KIND_LABELS: Record<IssueGeometryKind, string> = {
  point: "Pin",
  line: "Line",
  area: "Area",
};

// The patch that flips an issue's status. Resolving stamps the time;
// reopening clears it.
export function toggleStatus(
  issue: { status: IssueStatus | string },
  now: Date = new Date()
): { status: IssueStatus; resolved_at: string | null } {
  return issue.status === "resolved"
    ? { status: "open", resolved_at: null }
    : { status: "resolved", resolved_at: now.toISOString() };
}

// "Other" needs a label so the list means something; every type needs
// a known type value.
export function issueValid(issue: { issue_type: string; label?: string | null }): string | null {
  if (!(ISSUE_TYPES as string[]).includes(issue.issue_type)) return "Pick an issue type.";
  if (issue.issue_type === "other" && !(issue.label ?? "").trim()) return "Give the issue a label.";
  return null;
}

export function issueTitle(issue: { issue_type: string; label?: string | null }): string {
  const type = ISSUE_TYPE_LABELS[issue.issue_type as IssueType] ?? issue.issue_type;
  const label = (issue.label ?? "").trim();
  if (issue.issue_type === "other") return label || type;
  return label ? `${type}: ${label}` : type;
}

export interface IssueLike {
  id: string;
  issue_type: string;
  label: string | null;
  severity: string | null;
  status: string;
  property_id: string | null;
  field_id: string | null;
  created_at: string;
}

export interface IssueGroup<T extends IssueLike> {
  propertyId: string | null;
  propertyName: string;
  fields: Array<{ fieldId: string | null; fieldName: string | null; issues: T[] }>;
  count: number;
}

const SEVERITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

// Open issues by property, then by ag field (issues without a field
// come first under their property), severity first then newest.
export function groupOpenIssues<T extends IssueLike>(
  issues: T[],
  properties: Array<{ id: string; name: string }>,
  fields: Array<{ id: string; name: string; property_id: string }>
): IssueGroup<T>[] {
  const propName = new Map(properties.map((p) => [p.id, p.name]));
  const fieldName = new Map(fields.map((f) => [f.id, f.name]));
  const open = issues
    .filter((i) => i.status === "open")
    .sort(
      (a, b) =>
        (SEVERITY_RANK[a.severity ?? ""] ?? 3) - (SEVERITY_RANK[b.severity ?? ""] ?? 3) ||
        b.created_at.localeCompare(a.created_at)
    );
  const byProp = new Map<string, T[]>();
  for (const i of open) {
    const k = i.property_id ?? "";
    byProp.set(k, [...(byProp.get(k) ?? []), i]);
  }
  const groups: IssueGroup<T>[] = [];
  const order = [...properties.map((p) => p.id), ""];
  for (const pid of order) {
    const list = byProp.get(pid);
    if (!list) continue;
    const byField = new Map<string, T[]>();
    for (const i of list) {
      const fk = i.field_id ?? "";
      byField.set(fk, [...(byField.get(fk) ?? []), i]);
    }
    const fieldKeys = [...byField.keys()].sort((a, b) => (a === "" ? -1 : b === "" ? 1 : (fieldName.get(a) ?? "").localeCompare(fieldName.get(b) ?? "")));
    groups.push({
      propertyId: pid || null,
      propertyName: pid ? (propName.get(pid) ?? "Property") : "No property",
      fields: fieldKeys.map((fk) => ({ fieldId: fk || null, fieldName: fk ? (fieldName.get(fk) ?? null) : null, issues: byField.get(fk)! })),
      count: list.length,
    });
  }
  return groups;
}
