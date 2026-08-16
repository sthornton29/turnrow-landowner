import { NextResponse } from "next/server";
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import area from "@turf/area";
import difference from "@turf/difference";
import intersect from "@turf/intersect";
import union from "@turf/union";
import { createClient } from "@/lib/supabase/server";
import { bboxOf, toMultiPolygon } from "@/lib/geo/normalize";
import { pointInMultiPolygon } from "@/lib/geo/propertyMatch";
import { CdlError, fetchCdlGrid, gridPointToLonLat, type CdlGrid } from "@/lib/timberScan/cdl";
import {
  ACRE_M2,
  TIMBER_CLASSES,
  classIndex,
  classifyGrid,
  cleanPolygons,
  composition,
  compositionSummary,
  despeckle,
  maskToPolygons,
  type GridPolygon,
  type TimberClass,
} from "@/lib/timberScan/raster";
import type { ScanProposal, ScanResult } from "@/lib/timberScan/types";

// CropScape clips the national raster on demand: two sequential slow
// fetches. Give the function room.
export const maxDuration = 60;

type AreaFeature = Feature<Polygon | MultiPolygon>;

const feat = (geometry: Polygon | MultiPolygon): AreaFeature => ({
  type: "Feature",
  properties: {},
  geometry,
});
const fc = (features: AreaFeature[]): FeatureCollection<Polygon | MultiPolygon> => ({
  type: "FeatureCollection",
  features,
});

const round1 = (n: number) => Math.round(n * 10) / 10;

// Propose timber stand boundaries for a property from the USDA CDL land
// cover raster: geometry AND the pine/hardwood/mixed/wetland breakout
// both come from the raster (class separation happens at the pixel
// level, before polygonization). Results cache per (property, year).
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json();
  const propertyId = String(body.property_id ?? "");
  const requestedYear = body.year ? Number(body.year) : undefined;
  const force = Boolean(body.force);
  if (!propertyId) {
    return NextResponse.json({ error: "Missing property." }, { status: 400 });
  }

  const { data: property } = await supabase
    .from("properties_geo")
    .select("id, organization_id, name, boundary_geojson")
    .eq("id", propertyId)
    .single();
  if (!property) {
    return NextResponse.json({ error: "Property not found." }, { status: 404 });
  }
  const boundary = toMultiPolygon(property.boundary_geojson);
  if (!boundary) {
    return NextResponse.json(
      { error: "This property has no boundary yet. Draw or import one first; the scan needs it." },
      { status: 400 }
    );
  }

  // Cached scan (Rescan sends force to refresh).
  if (!force) {
    let query = supabase
      .from("timber_scans")
      .select("result, cdl_year")
      .eq("property_id", propertyId)
      .order("cdl_year", { ascending: false })
      .limit(1);
    if (requestedYear) query = query.eq("cdl_year", requestedYear);
    const { data: cached } = await query;
    if (cached && cached.length > 0) {
      return NextResponse.json({ ...(cached[0].result as ScanResult), cached: true });
    }
  }

  const [{ data: stands }, { data: fields }] = await Promise.all([
    supabase
      .from("timber_stands_geo")
      .select("boundary_geojson")
      .eq("property_id", propertyId),
    supabase
      .from("fields_geo")
      .select("id, name, boundary_geojson")
      .eq("property_id", propertyId),
  ]);

  try {
    const bbox = bboxOf([boundary]);
    if (!bbox) throw new CdlError("The property boundary is empty.", 400);
    const grid = await fetchCdlGrid(bbox, requestedYear);

    // Classify, despeckle with full raster context, THEN zero out
    // pixels outside the property (pixel centers tested against the
    // real boundary) so composition and acreage are property-scoped.
    const classified = despeckle(classifyGrid(grid.values), grid.width, grid.height);
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        if (classified[y * grid.width + x] === 0) continue;
        const lonLat = gridPointToLonLat(grid, x + 0.5, y + 0.5);
        if (!pointInMultiPolygon(lonLat, boundary)) {
          classified[y * grid.width + x] = 0;
        }
      }
    }

    const standShapes = (stands ?? [])
      .map((s) => toMultiPolygon(s.boundary_geojson))
      .filter((s): s is MultiPolygon => s !== null);
    const standsUnion =
      standShapes.length === 0
        ? null
        : standShapes.length === 1
          ? feat(standShapes[0])
          : union(fc(standShapes.map(feat)));

    const fieldShapes = (fields ?? [])
      .map((f) => toMultiPolygon(f.boundary_geojson))
      .filter((f): f is MultiPolygon => f !== null);

    const propertyFeature = feat(boundary);
    const proposals: ScanProposal[] = [];

    for (const cls of TIMBER_CLASSES) {
      const idx = classIndex(cls);
      const polys = cleanPolygons(
        maskToPolygons(
          (x, y) => classified[y * grid.width + x] === idx,
          grid.width,
          grid.height
        )
      );
      for (const poly of polys) {
        const counts = composition(classified, grid.width, grid.height, poly);
        const summary = compositionSummary(counts);
        const geometry = gridPolygonToGeoJson(grid, poly);

        // Exact vector clip to the property line, then remove anything
        // already mapped as a saved stand (never propose what exists).
        let clipped: AreaFeature | null = intersect(
          fc([feat(geometry), propertyFeature])
        );
        if (clipped && standsUnion) {
          clipped = difference(fc([clipped, standsUnion]));
        }
        if (!clipped) continue;
        const acres = round1(area(clipped) / ACRE_M2);
        if (acres < 0.2) continue;

        let agOverlapM2 = 0;
        for (const field of fieldShapes) {
          const overlap = intersect(fc([clipped, feat(field)]));
          if (overlap) agOverlapM2 += area(overlap);
        }

        proposals.push({
          id: crypto.randomUUID(),
          cls,
          geometry: clipped.geometry,
          acres,
          percents: summary.percents,
          dominant: summary.dominant ?? cls,
          agOverlapAcres: round1(agOverlapM2 / ACRE_M2),
        });
      }
    }

    proposals.sort((a, b) => b.acres - a.acres);
    const byClass = { pine: 0, hardwood: 0, mixed: 0, wetland: 0 } as Record<
      TimberClass,
      number
    >;
    for (const p of proposals) byClass[p.cls] = round1(byClass[p.cls] + p.acres);
    const result: ScanResult = {
      year: grid.year,
      generated_at: new Date().toISOString(),
      summary: {
        woodedAcres: round1(proposals.reduce((s, p) => s + p.acres, 0)),
        byClass,
      },
      proposals,
    };

    await supabase.from("timber_scans").upsert(
      {
        organization_id: property.organization_id,
        property_id: propertyId,
        cdl_year: grid.year,
        result,
      },
      { onConflict: "property_id,cdl_year" }
    );

    return NextResponse.json({ ...result, cached: false });
  } catch (err) {
    const status = err instanceof CdlError ? err.status : 502;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "The scan failed." },
      { status }
    );
  }
}

function gridPolygonToGeoJson(grid: CdlGrid, poly: GridPolygon): Polygon {
  const ring = (points: Array<[number, number]>) =>
    points.map(([x, y]) => gridPointToLonLat(grid, x, y));
  return {
    type: "Polygon",
    coordinates: [ring(poly.outer), ...poly.holes.map(ring)],
  };
}
