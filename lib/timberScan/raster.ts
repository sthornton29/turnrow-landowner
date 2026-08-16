// Timber Scan raster pipeline: pure functions from a CDL land cover
// grid to per-class stand polygons with composition readouts. Grid
// coordinates throughout: point (x, y) is the TOP-LEFT corner of pixel
// (x, y), y increases downward, one pixel = 30m x 30m (CDL/EPSG:5070).
// No IO here; unit tests in raster.test.ts drive a synthetic fixture.

export type TimberClass = "pine" | "hardwood" | "mixed" | "wetland";

export const TIMBER_CLASSES: TimberClass[] = [
  "pine",
  "hardwood",
  "mixed",
  "wetland",
];

// CDL class codes, live-verified 2026-08-16 by sampling CropScape
// GetCDLValue over known north Alabama forest (141 Deciduous Forest,
// 142 Evergreen Forest, 143 Mixed Forest returned by the service; 190
// Woody Wetlands is the standard NASS/NLCD-derived code). Woody
// wetlands map to hardwood-with-a-wetland-note in the UI: in the
// Southeast this is overwhelmingly bottomland hardwood.
export const CDL_TO_CLASS: Record<number, TimberClass> = {
  142: "pine",
  141: "hardwood",
  143: "mixed",
  190: "wetland",
};

// Internal grid encoding: 0 = not timber, 1..4 = TIMBER_CLASSES index + 1.
export function classIndex(cls: TimberClass): number {
  return TIMBER_CLASSES.indexOf(cls) + 1;
}

const PIXEL_M = 30;
const PIXEL_M2 = PIXEL_M * PIXEL_M;
export const ACRE_M2 = 4046.8564224;

export function classifyGrid(values: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const cls = CDL_TO_CLASS[values[i] as number];
    out[i] = cls ? classIndex(cls) : 0;
  }
  return out;
}

// Gentle despeckle: a pixel changes ONLY when none of its 8 neighbors
// shares its class (a lone misclassified pixel); it takes the modal
// neighbor class. One-pixel-wide drains have same-class neighbors along
// the line, so they survive untouched.
export function despeckle(
  grid: Uint8Array,
  width: number,
  height: number
): Uint8Array {
  const out = new Uint8Array(grid);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const self = grid[y * width + x];
      const counts = new Map<number, number>();
      let sameNeighbors = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const v = grid[ny * width + nx];
          if (v === self) sameNeighbors++;
          counts.set(v, (counts.get(v) ?? 0) + 1);
        }
      }
      if (sameNeighbors > 0) continue;
      let best = self;
      let bestCount = -1;
      for (const [v, c] of counts) {
        if (c > bestCount || (c === bestCount && v < best)) {
          best = v;
          bestCount = c;
        }
      }
      out[y * width + x] = best;
    }
  }
  return out;
}

export type GridPoint = [number, number];

export interface GridPolygon {
  outer: GridPoint[]; // closed ring (first point repeated last)
  holes: GridPoint[][];
}

// Shoelace sum (y-down grid coordinates). Outer rings traced with
// interior-on-left come out NEGATIVE; holes positive.
function shoelace(ring: GridPoint[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return sum;
}

export function ringAreaM2(ring: GridPoint[]): number {
  return (Math.abs(shoelace(ring)) / 2) * PIXEL_M2;
}

export function ringPerimeterM(ring: GridPoint[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    sum += Math.hypot(
      ring[i + 1][0] - ring[i][0],
      ring[i + 1][1] - ring[i][1]
    );
  }
  return sum * PIXEL_M;
}

export function polygonAreaM2(poly: GridPolygon): number {
  return (
    ringAreaM2(poly.outer) -
    poly.holes.reduce((s, h) => s + ringAreaM2(h), 0)
  );
}

function pointInRing(point: GridPoint, ring: GridPoint[]): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length - 1; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// Drop collinear midpoints (lossless). Deliberately the ONLY
// simplification applied: anything lossy (Douglas-Peucker) would break
// the guarantee that a pine polygon and the hardwood polygon across the
// class line share exactly coincident borders, because each side would
// simplify independently. Stair-step edges are honest 30m data and stay
// editable; straight runs collapse to two vertices.
function mergeCollinear(ring: GridPoint[]): GridPoint[] {
  const open = ring.slice(0, -1);
  const out: GridPoint[] = [];
  for (let i = 0; i < open.length; i++) {
    const prev = open[(i - 1 + open.length) % open.length];
    const cur = open[i];
    const next = open[(i + 1) % open.length];
    const cross =
      (cur[0] - prev[0]) * (next[1] - cur[1]) -
      (cur[1] - prev[1]) * (next[0] - cur[0]);
    if (cross !== 0) out.push(cur);
  }
  if (out.length < 3) return ring;
  return [...out, out[0]];
}

// Trace a binary mask into polygons with holes, on exact pixel edges.
// Directed boundary edges keep the mask interior on the LEFT of travel;
// at saddle points (diagonally touching pixels) the walk prefers the
// left turn, which separates diagonal neighbors (4-connectivity).
// Because boundaries lie exactly on the shared pixel grid, two class
// masks polygonized by this function produce coincident borders where
// their pixels touch: the no-gaps/no-overlaps guarantee is structural.
export function maskToPolygons(
  isSet: (x: number, y: number) => boolean,
  width: number,
  height: number
): GridPolygon[] {
  const inMask = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && isSet(x, y);

  interface Edge {
    from: GridPoint;
    to: GridPoint;
    used: boolean;
  }
  const edges: Edge[] = [];
  const byStart = new Map<string, Edge[]>();
  const keyOf = (p: GridPoint) => `${p[0]},${p[1]}`;
  const addEdge = (from: GridPoint, to: GridPoint) => {
    const edge: Edge = { from, to, used: false };
    edges.push(edge);
    const k = keyOf(from);
    const list = byStart.get(k);
    if (list) list.push(edge);
    else byStart.set(k, [edge]);
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!inMask(x, y)) continue;
      if (!inMask(x, y - 1)) addEdge([x + 1, y], [x, y]); // top
      if (!inMask(x, y + 1)) addEdge([x, y + 1], [x + 1, y + 1]); // bottom
      if (!inMask(x - 1, y)) addEdge([x, y], [x, y + 1]); // left
      if (!inMask(x + 1, y)) addEdge([x + 1, y + 1], [x + 1, y]); // right
    }
  }

  const rings: GridPoint[][] = [];
  for (const start of edges) {
    if (start.used) continue;
    const ring: GridPoint[] = [start.from];
    let current = start;
    for (;;) {
      current.used = true;
      ring.push(current.to);
      if (current.to[0] === start.from[0] && current.to[1] === start.from[1]) {
        break;
      }
      const candidates = (byStart.get(keyOf(current.to)) ?? []).filter(
        (e) => !e.used
      );
      if (candidates.length === 0) break; // defensive; closed loops always continue
      let next = candidates[0];
      if (candidates.length > 1) {
        // Saddle point: prefer the left (counterclockwise on a y-down
        // grid, cross < 0) turn to keep the interior on the left.
        const dx = current.to[0] - current.from[0];
        const dy = current.to[1] - current.from[1];
        let bestScore = Infinity;
        for (const c of candidates) {
          const cdx = c.to[0] - c.from[0];
          const cdy = c.to[1] - c.from[1];
          const cross = dx * cdy - dy * cdx;
          if (cross < bestScore) {
            bestScore = cross;
            next = c;
          }
        }
      }
      current = next;
    }
    rings.push(mergeCollinear(ring));
  }

  // Negative shoelace = outer, positive = hole. Assign each hole to the
  // smallest containing outer, tested with a point nudged into the
  // foreground from the hole's first edge (hole vertices can touch an
  // outer at pinch points, edge midpoints cannot).
  const outers = rings.filter((r) => shoelace(r) < 0);
  const holes = rings.filter((r) => shoelace(r) > 0);
  const polygons: GridPolygon[] = outers.map((outer) => ({
    outer,
    holes: [],
  }));

  for (const hole of holes) {
    const [ax, ay] = hole[0];
    const [bx, by] = hole[1];
    const mid: GridPoint = [(ax + bx) / 2, (ay + by) / 2];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    // Left of travel (dy, -dx) points into the mask interior.
    const rep: GridPoint = [
      mid[0] + ((by - ay) / len) * 0.25,
      mid[1] - ((bx - ax) / len) * 0.25,
    ];
    let best: GridPolygon | null = null;
    let bestArea = Infinity;
    for (const poly of polygons) {
      if (!pointInRing(rep, poly.outer)) continue;
      const area = ringAreaM2(poly.outer);
      if (area < bestArea) {
        bestArea = area;
        best = poly;
      }
    }
    best?.holes.push(hole);
  }

  return polygons;
}

// Cleanup rules from the spec: fill holes under 1 acre; drop polygons
// under 2 acres UNLESS elongated (length more than ~5x width, the
// hardwood-drain shape). Length/width is approximated for thin shapes
// by L = perimeter / 2 and W = area / L, so L/W = (P/2)^2 / area.
export function cleanPolygons(polys: GridPolygon[]): GridPolygon[] {
  const out: GridPolygon[] = [];
  for (const poly of polys) {
    const holes = poly.holes.filter((h) => ringAreaM2(h) >= ACRE_M2);
    const area = ringAreaM2(poly.outer);
    if (area < 2 * ACRE_M2) {
      const perimeter = ringPerimeterM(poly.outer);
      const elongation = (perimeter / 2) ** 2 / Math.max(area, 1);
      if (elongation < 5) continue;
    }
    out.push({ outer: poly.outer, holes });
  }
  return out;
}

// Per-class pixel counts inside a polygon (pixel centers, hole-aware),
// for the composition readout ("92% pine, 8% hardwood") shown on
// proposal chips and the confirm form.
export function composition(
  grid: Uint8Array,
  width: number,
  height: number,
  poly: GridPolygon
): Record<TimberClass, number> {
  const counts: Record<TimberClass, number> = {
    pine: 0,
    hardwood: 0,
    mixed: 0,
    wetland: 0,
  };
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of poly.outer) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  for (let y = Math.max(0, Math.floor(minY)); y < Math.min(height, maxY); y++) {
    for (
      let x = Math.max(0, Math.floor(minX));
      x < Math.min(width, maxX);
      x++
    ) {
      const center: GridPoint = [x + 0.5, y + 0.5];
      if (!pointInRing(center, poly.outer)) continue;
      if (poly.holes.some((h) => pointInRing(center, h))) continue;
      const v = grid[y * width + x];
      if (v >= 1 && v <= TIMBER_CLASSES.length) {
        counts[TIMBER_CLASSES[v - 1]]++;
      }
    }
  }
  return counts;
}

// Percentages (to whole percent, largest first) and the dominant class.
export function compositionSummary(counts: Record<TimberClass, number>): {
  dominant: TimberClass | null;
  percents: Array<{ cls: TimberClass; percent: number }>;
} {
  const total = TIMBER_CLASSES.reduce((s, c) => s + counts[c], 0);
  if (total === 0) return { dominant: null, percents: [] };
  const percents = TIMBER_CLASSES.map((cls) => ({
    cls,
    percent: Math.round((counts[cls] / total) * 100),
  }))
    .filter((p) => p.percent > 0)
    .sort((a, b) => b.percent - a.percent);
  return { dominant: percents[0]?.cls ?? null, percents };
}
