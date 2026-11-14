// Shapes a tool result for the Ask assistant so the model never sees a
// record cut in half.
//
// Before this, results were JSON-stringified and sliced at 100,000
// characters. Rows from the *_geo views carry whole boundaries as
// GeoJSON, so a list of parcels could hit the limit after a handful of
// rows and the model would answer, confidently, from the first few. Here
// boundary geometry is dropped (the assistant answers from acres and
// attributes, never from coordinates) and, when a result is still too
// large, whole rows are removed from the end and the result says so.

const GEOMETRY_KEY = /(^|_)(geojson|geometry|geom|boundary)$/i;

function isGeometryValue(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const v = value as { type?: unknown; coordinates?: unknown; geometries?: unknown; features?: unknown };
  return (
    typeof v.type === "string" &&
    ("coordinates" in v || "geometries" in v || "features" in v)
  );
}

// Removes boundary geometry anywhere in the value. A removed key is left
// out entirely so the model does not mistake it for missing data.
export function stripGeometry(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripGeometry);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (GEOMETRY_KEY.test(key) && (isGeometryValue(v) || typeof v === "string")) continue;
    if (isGeometryValue(v)) continue;
    out[key] = stripGeometry(v);
  }
  return out;
}

function longestArrayKey(obj: Record<string, unknown>): string | null {
  let best: string | null = null;
  let bestLength = 0;
  for (const [key, v] of Object.entries(obj)) {
    if (Array.isArray(v) && v.length > bestLength) {
      best = key;
      bestLength = v.length;
    }
  }
  return best;
}

// The JSON text to hand the model, at most maxChars long. When rows had
// to be dropped the result carries `truncated: true` with the counts and
// a plain note telling the model not to total or count from it.
export function toolResultText(result: unknown, maxChars = 100_000): string {
  const clean = stripGeometry(result);
  const full = JSON.stringify(clean) ?? "null";
  if (full.length <= maxChars) return full;

  // Find the list to shorten: the result itself, or its longest array.
  const wrap = (rows: unknown[], total: number, rest: Record<string, unknown> | null, key: string) =>
    JSON.stringify({
      ...(rest ?? {}),
      [key]: rows,
      truncated: true,
      rows_shown: rows.length,
      rows_total: total,
      note: `Only the first ${rows.length} of ${total} rows are shown because the full result is too large. Do not total, count, or rank from this partial list; narrow the question (one property, one year, fewer columns) and run it again.`,
    });

  let rows: unknown[] | null = null;
  let rest: Record<string, unknown> | null = null;
  let key = "rows";
  if (Array.isArray(clean)) {
    rows = clean;
  } else if (clean && typeof clean === "object") {
    const k = longestArrayKey(clean as Record<string, unknown>);
    if (k) {
      key = k;
      rows = (clean as Record<string, unknown>)[k] as unknown[];
      rest = { ...(clean as Record<string, unknown>) };
      delete rest[k];
    }
  }
  if (!rows) {
    return JSON.stringify({
      truncated: true,
      note: "The result was too large to show. Narrow the question and run it again.",
    });
  }

  // Binary search for the most rows that fit.
  const total = rows.length;
  let lo = 0;
  let hi = total;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (wrap(rows.slice(0, mid), total, rest, key).length <= maxChars) lo = mid;
    else hi = mid - 1;
  }
  const text = wrap(rows.slice(0, lo), total, rest, key);
  if (text.length <= maxChars) return text;
  return JSON.stringify({
    truncated: true,
    rows_total: total,
    note: "The result was too large to show. Narrow the question and run it again.",
  });
}
