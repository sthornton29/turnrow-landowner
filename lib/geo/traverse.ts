// Metes and bounds traverse plotter: pure math from a calls table
// (bearing, distance, optional curve) to a local-coordinate figure, its
// error of closure, and a georeferenced polygon once the user pins the
// point of beginning. Nothing here touches the DOM or a map. Unit
// tests in traverse.test.ts.
//
// Conventions: local coordinates are FEET with the point of beginning at
// (0, 0), x east and y north. Bearings are compass azimuths (0 = north,
// clockwise) once parsed. Rotation in toGeoJSON is clockwise-positive
// to match a basis-of-bearing correction the user dials in.

import type { Polygon, Position } from "geojson";

export type Unit =
  | "feet"
  | "chains"
  | "poles"
  | "links"
  | "varas"
  | "meters"
  | "yards";

export const FEET_PER_UNIT: Record<Unit, number> = {
  feet: 1,
  chains: 66,
  poles: 16.5,
  links: 0.66,
  // Varas vary by state and era (Texas 33.333 ft, Spanish-era Florida
  // and California differ); not converted, flagged unsupported instead.
  varas: NaN,
  meters: 3.28084,
  yards: 3,
};

export interface ParsedBearing {
  azimuthDeg: number; // 0..360, 0 = north, clockwise
  quadrant: "NE" | "SE" | "SW" | "NW" | null;
  degrees: number;
  minutes: number;
  seconds: number;
}

export interface CurveSpec {
  radius?: number; // feet
  arcLength?: number; // feet
  chordBearing?: string | number;
  chordLength?: number; // feet
  direction: "left" | "right";
  // Central angle: degrees, or the text as the deed writes it
  // ("90°00'00\"", "12-30-15").
  delta?: number | string;
}

export interface Call {
  // Text or azimuth degrees. A curve may leave it out: it then starts
  // in the direction the course before it ended.
  bearing?: string | number;
  distance: number; // in `unit` (default feet)
  unit?: Unit;
  curve?: CurveSpec;
}

export interface TraverseResult {
  points: Array<[number, number]>; // local feet; first point is the POB
  closureDistanceFt: number;
  closureRatio: number; // the N in 1:N; Infinity when closed
  perimeterFt: number;
  areaSqFt: number;
  areaAcres: number;
  adjusted: boolean;
  warnings: string[];
  // Call numbers (1-based, as given) that could not be plotted and were
  // left out of the figure. Each one also has a warning.
  skippedCalls: number[];
}

const SQFT_PER_ACRE = 43560;
const DEG = Math.PI / 180;

// ---------------------------------------------------------------- bearings

const DIR_WORDS: Record<string, "N" | "S" | "E" | "W"> = {
  n: "N", north: "N", s: "S", south: "S", e: "E", east: "E", w: "W", west: "W",
};

function normalizeBearingText(raw: string): string {
  return raw
    .replace(/[°º˚]/g, "d") // degree signs
    .replace(/[′’']/g, "m") // minute marks
    .replace(/[″”"]/g, "s") // second marks
    .replace(/\bdegrees?\b|\bdeg\b/gi, "d")
    .replace(/\bminutes?\b|\bmin\b/gi, "m")
    .replace(/\bseconds?\b|\bsec\b/gi, "s")
    .replace(/\s+/g, " ")
    .trim();
}

// Parse "45d30m15s", "45-30-15", "45 30 15", "45.5", "45d30m" into degrees.
function parseDms(body: string): { deg: number; d: number; m: number; s: number } | null {
  const t = body.replace(/,/g, " ").replace(/\s*-\s*/g, " ").trim();
  if (t === "") return null;
  // Letter-tagged form: 45d30m15s (tags optional after the first)
  const tagged = t.match(/^(\d+(?:\.\d+)?)\s*d?\s*(?:(\d+(?:\.\d+)?)\s*m?)?\s*(?:(\d+(?:\.\d+)?)\s*s?)?$/i);
  if (!tagged) return null;
  const d = Number(tagged[1]);
  const m = tagged[2] !== undefined ? Number(tagged[2]) : 0;
  const s = tagged[3] !== undefined ? Number(tagged[3]) : 0;
  if (![d, m, s].every(Number.isFinite)) return null;
  return { deg: d + m / 60 + s / 3600, d, m, s };
}

export function parseBearing(input: string | number): ParsedBearing | null {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    const az = ((input % 360) + 360) % 360;
    return { azimuthDeg: az, quadrant: null, degrees: az, minutes: 0, seconds: 0 };
  }
  const text = normalizeBearingText(input);
  if (text === "") return null;

  // "due north" etc.
  const due = text.match(/^(?:due\s+)?(north|south|east|west|n|s|e|w)$/i);
  if (due) {
    const dir = DIR_WORDS[due[1].toLowerCase()];
    const az = { N: 0, E: 90, S: 180, W: 270 }[dir];
    return { azimuthDeg: az, quadrant: null, degrees: az, minutes: 0, seconds: 0 };
  }

  // Quadrant form: <N|S> <dms> <E|W>
  const quad = text.match(
    /^(north|south|n|s)\s*([0-9][0-9.\s\-dms]*?)\s*(east|west|e|w)$/i
  );
  if (quad) {
    const ns = DIR_WORDS[quad[1].toLowerCase()];
    const ew = DIR_WORDS[quad[3].toLowerCase()];
    const dms = parseDms(quad[2]);
    if (!dms || dms.deg < 0 || dms.deg > 90) return null;
    const b = dms.deg;
    const quadrant = (ns + ew) as ParsedBearing["quadrant"];
    let az: number;
    if (quadrant === "NE") az = b;
    else if (quadrant === "SE") az = 180 - b;
    else if (quadrant === "SW") az = 180 + b;
    else az = 360 - b;
    az = ((az % 360) + 360) % 360;
    return { azimuthDeg: az, quadrant, degrees: dms.d, minutes: dms.m, seconds: dms.s };
  }

  // Azimuth form: "Az 123.5", "azimuth 123d30m", "123d30m"
  const azm = text.match(/^(?:az(?:imuth)?\.?\s*)?([0-9][0-9.\s\-dms]*)$/i);
  if (azm) {
    const dms = parseDms(azm[1]);
    if (!dms || dms.deg < 0 || dms.deg > 360) return null;
    const az = ((dms.deg % 360) + 360) % 360;
    return { azimuthDeg: az, quadrant: null, degrees: dms.d, minutes: dms.m, seconds: dms.s };
  }
  return null;
}

function azimuthOf(b: string | number | undefined): number | null {
  if (b === undefined) return null;
  return parseBearing(b)?.azimuthDeg ?? null;
}

// A plain angle the way deeds write a curve's central angle
// ("90°00'00\"", "12-30-15", "45.5", "Delta = 12°30'"), read with the
// same degrees-minutes-seconds parser the bearings use. Degrees, or null.
export function parseAngle(input: string | number): number | null {
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  const dms = parseDms(normalizeBearingText(input).replace(/^[^0-9]+/, ""));
  return dms ? dms.deg : null;
}

// "1,234.5": one decimal with commas, for feet in messages.
function oneDecimal(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

// ---------------------------------------------------------------- distances

const UNIT_WORDS: Array<[RegExp, Unit]> = [
  [/\b(feet|foot|ft)\b|'/i, "feet"],
  [/\b(chains?|chs?)\b/i, "chains"],
  [/\b(poles?|rods?|perch(?:es)?|rd)\b/i, "poles"],
  [/\b(links?|lks?)\b/i, "links"],
  [/\b(varas?|vrs?)\b/i, "varas"],
  [/\b(meters?|metres?|m)\b/i, "meters"],
  [/\b(yards?|yds?)\b/i, "yards"],
];

export function parseDistance(input: string | number, defaultUnit: Unit = "feet"): number | null {
  if (typeof input === "number") {
    return Number.isFinite(input) && Number.isFinite(FEET_PER_UNIT[defaultUnit])
      ? input * FEET_PER_UNIT[defaultUnit]
      : null;
  }
  const text = input.replace(/,/g, "").trim();
  const num = text.match(/-?\d+(?:\.\d+)?/);
  if (!num) return null;
  const value = Number(num[0]);
  if (!Number.isFinite(value)) return null;
  const rest = text.slice(num.index! + num[0].length);
  let unit: Unit = defaultUnit;
  for (const [re, u] of UNIT_WORDS) {
    if (re.test(rest)) {
      unit = u;
      break;
    }
  }
  // Unsupported unit (varas): no silent conversion.
  if (!Number.isFinite(FEET_PER_UNIT[unit])) return null;
  return value * FEET_PER_UNIT[unit];
}

export function unitSupported(unit: Unit): boolean {
  return Number.isFinite(FEET_PER_UNIT[unit]);
}

// ---------------------------------------------------------------- traverse

interface Course {
  azimuthDeg: number; // direction of travel for this course (chord for curves)
  lengthFt: number; // straight-line length (chord for curves)
  weightFt: number; // length used for compass-rule weighting (arc for curves)
  // The direction the line is heading where this course ENDS: its own
  // bearing for a straight course; for a curve the outgoing tangent,
  // which is not the chord bearing. A curve after it with no bearing of
  // its own starts in this direction.
  endTangentAz: number;
  // False when a curve gave only a chord, so its outgoing tangent is not
  // known and the chord bearing stands in for it.
  endTangentKnown: boolean;
}

const wrap360 = (az: number) => ((az % 360) + 360) % 360;

function hasText(v: string | number | undefined): boolean {
  return v !== undefined && String(v).trim() !== "";
}

// A curve figure that was left out is fine. One that was given but is
// not a usable number is ignored, with a warning that names the call.
function curveFigure(
  value: number | undefined,
  label: string,
  index: number,
  warnings: string[]
): number | null {
  if (value === undefined) return null;
  if (!Number.isFinite(value) || value <= 0) {
    warnings.push(`Call ${index + 1}: the curve's ${label} is not a usable number, so it was ignored.`);
    return null;
  }
  return value;
}

function courseFor(
  call: Call,
  prev: { az: number; known: boolean } | null,
  index: number,
  warnings: string[]
): Course | null {
  const unitFactor = FEET_PER_UNIT[call.unit ?? "feet"];
  if (!Number.isFinite(unitFactor)) {
    warnings.push(
      `Call ${index + 1}: distances in ${call.unit} are not supported (the vara differs by state and era); convert to feet and re-enter.`
    );
    return null;
  }
  const curve = call.curve;
  if (!curve) {
    const az = azimuthOf(call.bearing);
    if (az === null) {
      warnings.push(
        hasText(call.bearing)
          ? `Call ${index + 1}: could not read the bearing "${call.bearing}".`
          : `Call ${index + 1}: no bearing was given.`
      );
      return null;
    }
    const len = call.distance * unitFactor;
    if (!Number.isFinite(len) || len <= 0) {
      warnings.push(`Call ${index + 1}: distance must be a positive number.`);
      return null;
    }
    return { azimuthDeg: az, lengthFt: len, weightFt: len, endTangentAz: az, endTangentKnown: true };
  }

  // Curve: prefer the chord when given outright.
  const sign = curve.direction === "right" ? 1 : -1;
  const radiusIn = curveFigure(curve.radius, "radius", index, warnings);
  const arcIn = curveFigure(curve.arcLength, "arc length", index, warnings);
  const chordIn = curveFigure(curve.chordLength, "chord length", index, warnings);
  const radius = radiusIn === null ? null : radiusIn * unitFactor;
  const arc = arcIn === null ? null : arcIn * unitFactor;
  let chordLen = chordIn === null ? null : chordIn * unitFactor;

  let deltaDeg: number | null = null;
  if (hasText(curve.delta)) {
    const d = parseAngle(curve.delta as string | number);
    if (d === null || !(d > 0) || !(d < 360)) {
      warnings.push(
        `Call ${index + 1}: could not read the curve's delta angle "${curve.delta}", so it was ignored.`
      );
    } else {
      deltaDeg = d;
    }
  }

  let chordAz: number | null = null;
  if (hasText(curve.chordBearing)) {
    chordAz = azimuthOf(curve.chordBearing);
    if (chordAz === null) {
      warnings.push(`Call ${index + 1}: could not read the chord bearing "${curve.chordBearing}".`);
    }
  }

  if (deltaDeg === null && radius !== null && arc !== null) deltaDeg = (arc / radius) / DEG;
  // A chord and a radius fix the central angle too (the shorter arc).
  if (deltaDeg === null && radius !== null && chordLen !== null && chordLen <= 2 * radius) {
    deltaDeg = (2 * Math.asin(chordLen / (2 * radius))) / DEG;
  }
  if (chordLen === null && radius !== null && deltaDeg !== null) {
    chordLen = 2 * radius * Math.sin((deltaDeg * DEG) / 2);
  }

  let endTangentAz: number;
  let endTangentKnown = true;
  if (chordAz === null) {
    // Tangent curve: it starts in the direction the course before it
    // ended (or along this call's own bearing when one is given), and
    // the chord is that direction deflected by half the central angle.
    const own = hasText(call.bearing) ? azimuthOf(call.bearing) : null;
    if (hasText(call.bearing) && own === null) {
      warnings.push(
        `Call ${index + 1}: could not read the bearing "${call.bearing}"; the curve was started from the course before it.`
      );
    }
    const tangentAz = own ?? prev?.az ?? null;
    if (tangentAz === null || deltaDeg === null) {
      warnings.push(
        `Call ${index + 1}: curve needs a chord bearing and length, or a radius and arc length (with a tangent to follow).`
      );
      return null;
    }
    if (own === null && prev && !prev.known) {
      warnings.push(
        `Call ${index + 1}: the curve before it gives only a chord, so the direction this curve starts in is approximate. Enter its chord bearing to place it exactly.`
      );
    }
    chordAz = wrap360(tangentAz + (sign * deltaDeg) / 2);
    endTangentAz = wrap360(tangentAz + sign * deltaDeg);
  } else if (deltaDeg !== null) {
    endTangentAz = wrap360(chordAz + (sign * deltaDeg) / 2);
  } else {
    endTangentAz = chordAz;
    endTangentKnown = false;
  }
  if (chordLen === null || !(chordLen > 0)) {
    warnings.push(`Call ${index + 1}: curve chord length could not be determined.`);
    return null;
  }
  return { azimuthDeg: chordAz, lengthFt: chordLen, weightFt: arc ?? chordLen, endTangentAz, endTangentKnown };
}

function shoelace(points: Array<[number, number]>): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

export function traverse(calls: Call[], opts: { forceClose?: boolean } = {}): TraverseResult {
  const warnings: string[] = [];
  const courses: Course[] = [];
  const skippedCalls: number[] = [];
  let prev: { az: number; known: boolean } | null = null;
  calls.forEach((call, i) => {
    const c = courseFor(call, prev, i, warnings);
    if (!c) {
      skippedCalls.push(i + 1);
      return;
    }
    // Never let a figure that does not work out reach the map: one
    // non-finite course would turn every later point into NaN.
    if (![c.azimuthDeg, c.lengthFt, c.weightFt, c.endTangentAz].every(Number.isFinite)) {
      warnings.push(`Call ${i + 1}: its figures do not work out, so it was skipped.`);
      skippedCalls.push(i + 1);
      return;
    }
    courses.push(c);
    // A curve leaves in its outgoing tangent (chord bearing plus half
    // the central angle), not along its chord.
    prev = { az: c.endTangentAz, known: c.endTangentKnown };
  });

  const points: Array<[number, number]> = [[0, 0]];
  let x = 0;
  let y = 0;
  let perimeter = 0;
  for (const c of courses) {
    const rad = c.azimuthDeg * DEG;
    x += c.lengthFt * Math.sin(rad);
    y += c.lengthFt * Math.cos(rad);
    perimeter += c.weightFt;
    points.push([x, y]);
  }

  const closureDistanceFt = Math.hypot(x, y);
  const closed = closureDistanceFt < 0.005;
  const closureRatio = closed ? Infinity : perimeter / closureDistanceFt;

  let figure = points;
  let adjusted = false;
  if (opts.forceClose && !closed && courses.length > 0 && perimeter > 0) {
    // Compass (Bowditch) rule: each course absorbs a share of the
    // misclosure proportional to its length.
    const adj: Array<[number, number]> = [[0, 0]];
    let ax = 0;
    let ay = 0;
    let run = 0;
    for (const c of courses) {
      run += c.weightFt;
      const rad = c.azimuthDeg * DEG;
      ax += c.lengthFt * Math.sin(rad);
      ay += c.lengthFt * Math.cos(rad);
      adj.push([ax - (x * run) / perimeter, ay - (y * run) / perimeter]);
    }
    // Snap the final point exactly onto the POB.
    adj[adj.length - 1] = [0, 0];
    figure = adj;
    adjusted = true;
  }

  // Area: the figure closed back to the POB (drop a duplicate end point).
  const ring = figure.slice();
  if (ring.length > 1) {
    const last = ring[ring.length - 1];
    if (Math.hypot(last[0], last[1]) < 0.005) ring.pop();
  }
  const areaSqFt = ring.length >= 3 ? shoelace(ring) : 0;

  if (courses.length < 3) warnings.push("Fewer than three courses; no area to compute.");
  if (!closed && !opts.forceClose && courses.length >= 3) {
    if (closureRatio < 5000) {
      warnings.push(
        `Closure error ${oneDecimal(closureDistanceFt)} ft (1:${Math.round(closureRatio).toLocaleString("en-US")}) is poor; check the calls or force close.`
      );
    }
  }

  return {
    points: figure,
    closureDistanceFt,
    closureRatio,
    perimeterFt: perimeter,
    areaSqFt,
    areaAcres: areaSqFt / SQFT_PER_ACRE,
    adjusted,
    warnings,
    skippedCalls,
  };
}

export function formatClosure(result: TraverseResult): string {
  if (result.closureRatio === Infinity) return "Closes exactly";
  const ratio = Math.round(result.closureRatio).toLocaleString("en-US");
  return `Closure ${oneDecimal(result.closureDistanceFt)} ft, 1:${ratio}`;
}

// ---------------------------------------------------------------- georeference

const FT_TO_M = 0.3048;

// WGS84 ellipsoid. A degree is not the same length everywhere: a degree
// of latitude is about 110,574 m at the equator and 110,904 m at 33
// north. Using the equator figure in Alabama put a one-mile call about
// 16 ft long and made saved acreage about 0.4 percent high.
const WGS84_A = 6378137;
const WGS84_E2 = 0.00669437999014;

// Meters in one degree of latitude and of longitude at a latitude.
export function metersPerDegree(latDeg: number): { lat: number; lon: number } {
  const phi = latDeg * DEG;
  const w = 1 - WGS84_E2 * Math.sin(phi) ** 2;
  return {
    lat: (DEG * WGS84_A * (1 - WGS84_E2)) / Math.pow(w, 1.5),
    lon: (DEG * WGS84_A * Math.cos(phi)) / Math.sqrt(w),
  };
}

// Local feet -> WGS84 polygon on a tangent plane at the POB. rotationDeg
// turns the whole figure about the POB, clockwise positive (a basis-of-
// bearing correction).
export function toGeoJSON(
  points: Array<[number, number]>,
  pob: [number, number],
  rotationDeg = 0
): Polygon {
  const rot = rotationDeg * DEG;
  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);
  // Degree lengths at the point of beginning's own latitude.
  const m = metersPerDegree(pob[1]);
  const ring: Position[] = points.map(([x, y]) => {
    // Clockwise rotation in an x-east, y-north frame.
    const rx = x * cosR + y * sinR;
    const ry = -x * sinR + y * cosR;
    return [
      pob[0] + (rx * FT_TO_M) / m.lon,
      pob[1] + (ry * FT_TO_M) / m.lat,
    ];
  });
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (!last || first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
  return { type: "Polygon", coordinates: [ring] };
}
