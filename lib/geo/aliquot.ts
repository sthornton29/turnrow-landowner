// PLSS aliquot descriptions ("NW1/4 of SE1/4 of Section 12, T4S R8W"):
// parse the description, then subdivide a real section polygon into the
// described parts. Sections are rarely true squares, so subdivision uses
// bilinear interpolation within the section's four corners (the
// standard approximation; government lots and fractional sections are
// flagged). Pure math; unit tests in aliquot.test.ts.

import type { MultiPolygon, Polygon, Position, Feature } from "geojson";
import turfUnion from "@turf/union";
import turfDifference from "@turf/difference";
import turfArea from "@turf/area";

export type Quarter = "NE" | "NW" | "SE" | "SW";
export type Half = "N" | "S" | "E" | "W";
export type AliquotToken = Quarter | Half;

// A chain from SMALLEST to largest: "NW1/4 of SE1/4" => ["NW", "SE"].
export type AliquotPart = AliquotToken[];

export interface ParsedAliquot {
  parts: AliquotPart[];
  section: number | null;
  township: { num: number; dir: "N" | "S" } | null;
  range: { num: number; dir: "E" | "W" } | null;
  exceptions: string[];
  exceptionParts: AliquotPart[];
  lots: number[];
  warnings: string[];
}

const ACRES_PER_SQM = 1 / 4046.8564224;

// ---------------------------------------------------------------- parsing

const QUARTER_WORDS: Array<[RegExp, AliquotToken]> = [
  [/\bnorth\s*east\b|\bnortheast\b/i, "NE"],
  [/\bnorth\s*west\b|\bnorthwest\b/i, "NW"],
  [/\bsouth\s*east\b|\bsoutheast\b/i, "SE"],
  [/\bsouth\s*west\b|\bsouthwest\b/i, "SW"],
  [/\bnorth\b/i, "N"],
  [/\bsouth\b/i, "S"],
  [/\beast\b/i, "E"],
  [/\bwest\b/i, "W"],
];

// Normalize the many ways a quarter or half is written into a compact
// token stream: "NW1/4 of the SE1/4" -> "NW4 SE4", "N1/2" -> "N2".
function normalize(text: string): string {
  let t = text
    .replace(/¼/g, "1/4")
    .replace(/½/g, "1/2")
    .replace(/½/g, "1/2")
    .replace(/\bone[-\s]?quarter\b|\bquarter\b|\bqtr\.?\b/gi, "1/4")
    .replace(/\bone[-\s]?half\b|\bhalf\b/gi, "1/2")
    .replace(/[,;]/g, " , ")
    .replace(/\s+/g, " ");
  // Spelled-out directions -> letters (longest first).
  for (const [re, tok] of QUARTER_WORDS) t = t.replace(new RegExp(re.source, "gi"), tok);
  // "NW 1/4", "NW/4", "NW1/4" -> "NW4"; "N 1/2", "N/2" -> "N2"
  t = t.replace(/\b(NE|NW|SE|SW|N|S|E|W)\s*(?:1\s*\/\s*4|\/4)/g, "$14");
  t = t.replace(/\b(NE|NW|SE|SW|N|S|E|W)\s*(?:1\s*\/\s*2|\/2)/g, "$12");
  // Compact "NWSE", "NESW" (quarter-quarter shorthand) -> "NW4 SE4"
  t = t.replace(/\b(NE|NW|SE|SW)(NE|NW|SE|SW)\b(?!\d)/g, "$14 $24");
  return t.replace(/\bof the\b|\bof\b/gi, " ").replace(/\s+/g, " ").trim();
}

const TOKEN_RE = /\b(NE|NW|SE|SW|N|S|E|W)(4|2)\b/g;

// Split a normalized clause on "and" / commas into part strings.
function splitParts(norm: string): string[] {
  return norm
    .split(/\s*(?:\band\b|,|&)\s*/i)
    .map((s) => s.trim())
    .filter((s) => TOKEN_RE.test(s) && (TOKEN_RE.lastIndex = 0) === 0);
}

function tokensOf(part: string): AliquotPart {
  const out: AliquotPart = [];
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(part))) {
    const dir = m[1] as AliquotToken;
    const frac = m[2];
    if (frac === "4" && dir.length === 1) continue; // "N4" is not a thing
    if (frac === "2" && dir.length === 2) continue; // "NW2" is not a thing
    out.push(dir);
  }
  return out;
}

function parseSectionTownshipRange(text: string): Pick<ParsedAliquot, "section" | "township" | "range"> {
  const sec = text.match(/\b(?:section|sec\.?)\s*(\d{1,2})\b/i);
  const twp = text.match(/\b(?:township|twp\.?|t\.?)\s*(\d{1,3})\s*[-]?\s*(north|south|n|s)\b\.?/i);
  const rng = text.match(/\b(?:range|rge\.?|r\.?)\s*(\d{1,3})\s*[-]?\s*(east|west|e|w)\b\.?/i);
  return {
    section: sec ? Number(sec[1]) : null,
    township: twp ? { num: Number(twp[1]), dir: twp[2][0].toUpperCase() as "N" | "S" } : null,
    range: rng ? { num: Number(rng[1]), dir: rng[2][0].toUpperCase() as "E" | "W" } : null,
  };
}

export function parseAliquot(text: string): ParsedAliquot {
  const warnings: string[] = [];
  const str = parseSectionTownshipRange(text);

  // Split off exception clauses.
  const exceptionRe = /\b(?:less\s+and\s+except|save\s+and\s+except|less\s+and\s+excepting|excepting|except|less)\b/i;
  const pieces = text.split(exceptionRe);
  const main = pieces[0];
  const exceptions = pieces.slice(1).map((s) => s.replace(/^[\s:,]+/, "").trim()).filter(Boolean);

  // Lots.
  const lots: number[] = [];
  const lotRe = /\blots?\s+((?:\d+\s*(?:,|and|&)?\s*)+)/gi;
  let lm: RegExpExecArray | null;
  while ((lm = lotRe.exec(main))) {
    for (const n of lm[1].match(/\d+/g) ?? []) lots.push(Number(n));
  }

  // Strip the section/township/range tail before reading parts.
  const body = main.split(/\b(?:section|sec\.?)\b/i)[0];
  const norm = normalize(body);
  const parts = splitParts(norm).map(tokensOf).filter((p) => p.length > 0);

  const exceptionParts: AliquotPart[] = [];
  for (const ex of exceptions) {
    const exBody = ex.split(/\b(?:section|sec\.?)\b/i)[0];
    for (const p of splitParts(normalize(exBody)).map(tokensOf)) {
      if (p.length > 0) exceptionParts.push(p);
    }
  }

  if (parts.length === 0 && lots.length === 0) {
    warnings.push("No aliquot parts (quarters, halves) or lots were recognized in the description.");
  }
  if (lots.length > 0) {
    warnings.push(
      `Government lot${lots.length > 1 ? "s" : ""} ${lots.join(", ")} cannot be placed exactly without the plat; verify against the original survey.`
    );
  }
  if (str.section === null) warnings.push("No section number found.");
  if (!str.township || !str.range) warnings.push("Township and range were not both found.");
  if (exceptions.length > exceptionParts.length) {
    warnings.push("An exception clause was not an aliquot part and must be cut by hand.");
  }

  return { parts, ...str, exceptions, exceptionParts, lots, warnings };
}

// ---------------------------------------------------------------- subdivision

// The [u0, u1, v0, v1] rectangle within the section (u west->east,
// v south->north) for a chain written smallest-first.
export function aliquotUV(chain: AliquotPart): [number, number, number, number] {
  let u0 = 0, u1 = 1, v0 = 0, v1 = 1;
  // Apply largest first.
  for (const tok of [...chain].reverse()) {
    const um = (u0 + u1) / 2;
    const vm = (v0 + v1) / 2;
    switch (tok) {
      case "N": v0 = vm; break;
      case "S": v1 = vm; break;
      case "E": u0 = um; break;
      case "W": u1 = um; break;
      case "NE": u0 = um; v0 = vm; break;
      case "NW": u1 = um; v0 = vm; break;
      case "SE": u0 = um; v1 = vm; break;
      case "SW": u1 = um; v1 = vm; break;
    }
  }
  return [u0, u1, v0, v1];
}

interface Corners {
  nw: Position;
  ne: Position;
  se: Position;
  sw: Position;
}

// Pick the ring vertices nearest the bounding-box corners.
export function sectionCorners(section: Polygon): Corners {
  const ring = section.coordinates[0];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const nearest = (tx: number, ty: number): Position => {
    let best = ring[0];
    let bestD = Infinity;
    for (const p of ring) {
      const d = Math.hypot(p[0] - tx, p[1] - ty);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  };
  return {
    nw: nearest(minX, maxY),
    ne: nearest(maxX, maxY),
    se: nearest(maxX, minY),
    sw: nearest(minX, minY),
  };
}

function bilinear(c: Corners, u: number, v: number): Position {
  // v = 0 south edge (sw -> se), v = 1 north edge (nw -> ne)
  const south: Position = [
    c.sw[0] + (c.se[0] - c.sw[0]) * u,
    c.sw[1] + (c.se[1] - c.sw[1]) * u,
  ];
  const north: Position = [
    c.nw[0] + (c.ne[0] - c.nw[0]) * u,
    c.nw[1] + (c.ne[1] - c.nw[1]) * u,
  ];
  return [south[0] + (north[0] - south[0]) * v, south[1] + (north[1] - south[1]) * v];
}

export function subdivideSection(section: Polygon, chain: AliquotPart): Polygon {
  const c = sectionCorners(section);
  const [u0, u1, v0, v1] = aliquotUV(chain);
  const ring: Position[] = [
    bilinear(c, u0, v1), // nw
    bilinear(c, u1, v1), // ne
    bilinear(c, u1, v0), // se
    bilinear(c, u0, v0), // sw
  ];
  ring.push([ring[0][0], ring[0][1]]);
  return { type: "Polygon", coordinates: [ring] };
}

// Government lots: approximate as the quarter-quarter in the lot's
// usual position (lots number across the north tier east to west, then
// down the west side). Always flagged.
function lotChain(lot: number): AliquotPart {
  const tier: Record<number, AliquotPart> = {
    1: ["NE", "NE"], 2: ["NW", "NE"], 3: ["NE", "NW"], 4: ["NW", "NW"],
    5: ["SW", "NW"], 6: ["NW", "SW"], 7: ["SW", "SW"],
  };
  return tier[lot] ?? ["NW", "NW"];
}

function asFeature(g: Polygon | MultiPolygon): Feature<Polygon | MultiPolygon> {
  return { type: "Feature", properties: {}, geometry: g };
}

function toMulti(g: Polygon | MultiPolygon): MultiPolygon {
  return g.type === "MultiPolygon"
    ? g
    : { type: "MultiPolygon", coordinates: [g.coordinates] };
}

export function resolveDescription(
  parsed: ParsedAliquot,
  sectionPolygon: Polygon
): { polygon: MultiPolygon | null; acres: number; notes: string[] } {
  const notes: string[] = [...parsed.warnings];
  const pieces: Array<Polygon | MultiPolygon> = parsed.parts.map((p) =>
    subdivideSection(sectionPolygon, p)
  );
  for (const lot of parsed.lots) {
    const chain = lotChain(lot);
    pieces.push(subdivideSection(sectionPolygon, chain));
    notes.push(
      `Lot ${lot} approximated as the ${chain[0]} quarter-quarter of the ${chain[1]} quarter; verify against the plat.`
    );
  }
  if (pieces.length === 0) return { polygon: null, acres: 0, notes };

  let acc: Polygon | MultiPolygon | null = null;
  for (const g of pieces) {
    if (!acc) {
      acc = g;
      continue;
    }
    const merged: Feature<Polygon | MultiPolygon> | null = turfUnion({
      type: "FeatureCollection",
      features: [asFeature(acc), asFeature(g)],
    });
    if (merged) acc = merged.geometry;
  }
  for (const ex of parsed.exceptionParts) {
    if (!acc) break;
    const cut = subdivideSection(sectionPolygon, ex);
    const diff: Feature<Polygon | MultiPolygon> | null = turfDifference({
      type: "FeatureCollection",
      features: [asFeature(acc), asFeature(cut)],
    });
    acc = diff ? diff.geometry : null;
  }
  if (!acc) {
    notes.push("The exceptions removed the whole described tract.");
    return { polygon: null, acres: 0, notes };
  }
  const polygon = toMulti(acc);
  const acres = turfArea(asFeature(polygon)) * ACRES_PER_SQM;
  return { polygon, acres, notes };
}
