import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  GisError,
  normalizeFeatures,
  queryLayerFeatures,
} from "@/lib/gisServer";
import {
  bboxesIntersect,
  serviceExtent,
  type CountyGisService,
  type LonLatBbox,
} from "@/lib/gis";
import { lookupCounty } from "@/lib/countyLookup";

// Neighbors overlay: surrounding tax parcels and owners from the
// county's public GIS service, for the map viewport. EPHEMERAL by
// design: rendered client-side, never persisted; nothing enters the
// database except through the deliberate import flow.
//
// Politeness toward county servers: the client debounces map movement
// and caches padded extents; here the bbox size is capped, the feature
// budget is capped and split across services when a viewport straddles
// two counties, only the mapped fields are requested, and a short
// in-process cache absorbs repeat pans on the same extent.

export const maxDuration = 60;

// Total features per refresh, split across covering services.
const TOTAL_FEATURE_CAP = 1500;
// At most this many services per viewport (a corner can touch 3).
const MAX_SERVICES = 3;
// Reject viewports wider/taller than this many degrees (the client's
// zoom gate keeps real requests far under it; this is the server-side
// backstop so a bad caller cannot sweep a whole state).
const MAX_BBOX_DEGREES = 0.6;

// Short-lived in-process cache, keyed per service + rounded bbox.
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 80;
const cache = new Map<string, { at: number; value: ServiceResult }>();

interface NeighborFeature {
  geometry: GeoJSON.Geometry;
  parcel_number: string;
  owner_name: string;
  deeded_acres: number | null;
  computed_acres: number | null;
  situs: string | null;
  service_id: string;
}

interface ServiceResult {
  features: NeighborFeature[];
  truncated: boolean;
}

function cacheGet(key: string): ServiceResult | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key: string, value: ServiceResult) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), value });
}

async function queryService(
  service: CountyGisService,
  bbox: LonLatBbox,
  budget: number
): Promise<ServiceResult> {
  const key = `${service.id}|${bbox.map((n) => n.toFixed(4)).join(",")}|${budget}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  const outFields = [
    service.parcel_field,
    service.owner_field,
    service.acres_field,
    service.situs_field,
  ]
    .filter(Boolean)
    .join(",");
  const { features, truncated } = await queryLayerFeatures({
    serviceUrl: service.service_url,
    layerId: service.layer_id,
    where: "1=1",
    maxFeatures: budget,
    geometry: bbox,
    spatialRel: "esriSpatialRelIntersects",
    outFields,
    serviceLabel: `the ${service.display_name} server`,
  });
  const normalized = normalizeFeatures(features, service, service.display_name);
  const result: ServiceResult = {
    // The overlay draws boundaries; a record without geometry has
    // nothing to show. Raw attributes are dropped to keep the payload
    // light (the import flow re-queries the county for the full record).
    features: normalized
      .filter((f) => f.geometry !== null)
      .map((f) => ({
        geometry: f.geometry as GeoJSON.Geometry,
        parcel_number: f.parcel_number,
        owner_name: f.owner_name,
        deeded_acres: f.deeded_acres,
        computed_acres: f.computed_acres,
        situs: f.situs,
        service_id: service.id,
      })),
    truncated,
  };
  cacheSet(key, result);
  return result;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const raw = Array.isArray(body.bbox) ? body.bbox.map(Number) : [];
  if (raw.length !== 4 || raw.some((n: number) => !Number.isFinite(n))) {
    return NextResponse.json({ error: "Send a [west, south, east, north] bbox." }, { status: 400 });
  }
  const bbox = raw as LonLatBbox;
  const [w, s, e, n] = bbox;
  if (w >= e || s >= n || w < -180 || e > 180 || s < -90 || n > 90) {
    return NextResponse.json({ error: "That bbox is not valid lon/lat." }, { status: 400 });
  }
  if (e - w > MAX_BBOX_DEGREES || n - s > MAX_BBOX_DEGREES) {
    return NextResponse.json(
      { error: "Zoom in further to load neighboring parcels." },
      { status: 400 }
    );
  }

  const { data: rows, error: dbError } = await supabase
    .from("county_gis_services")
    .select("*")
    .eq("status", "active");
  if (dbError) {
    return NextResponse.json({ error: "Could not read the county registry." }, { status: 500 });
  }
  const covering = ((rows as CountyGisService[]) ?? [])
    .filter((svc) => {
      const extent = serviceExtent(svc);
      return extent !== null && bboxesIntersect(extent, bbox);
    })
    .slice(0, MAX_SERVICES);

  if (covering.length === 0) {
    // Name the county so the Vercel logs say what to add to the registry.
    let uncovered: string | null = null;
    try {
      const hit = await lookupCounty((w + e) / 2, (s + n) / 2);
      if (hit) {
        uncovered = `${hit.countyFull}, ${hit.state}`;
        console.log(`[neighbors] no registered GIS service covers ${uncovered}`);
      }
    } catch {
      // The overlay message works without a county name.
    }
    return NextResponse.json({
      services: [],
      features: [],
      truncated: false,
      uncovered_county: uncovered,
    });
  }

  const budget = Math.floor(TOTAL_FEATURE_CAP / covering.length);
  const settled = await Promise.allSettled(
    covering.map((svc) => queryService(svc, bbox, budget))
  );

  const features: NeighborFeature[] = [];
  let truncated = false;
  const services: Array<{
    id: string;
    county: string;
    state: string;
    display_name: string;
    ok: boolean;
  }> = [];
  settled.forEach((result, i) => {
    const svc = covering[i];
    if (result.status === "fulfilled") {
      features.push(...result.value.features);
      truncated = truncated || result.value.truncated;
      services.push({
        id: svc.id,
        county: svc.county,
        state: svc.state,
        display_name: svc.display_name,
        ok: true,
      });
    } else {
      // One slow county must not blank the other half of the viewport.
      const message =
        result.reason instanceof GisError || result.reason instanceof Error
          ? result.reason.message
          : "query failed";
      console.warn(`[neighbors] ${svc.display_name}: ${message}`);
      services.push({
        id: svc.id,
        county: svc.county,
        state: svc.state,
        display_name: svc.display_name,
        ok: false,
      });
    }
  });

  return NextResponse.json({
    services,
    features,
    truncated,
    uncovered_county: null,
  });
}
