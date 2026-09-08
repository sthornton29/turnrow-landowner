import { NextResponse } from "next/server";
import turfArea from "@turf/area";
import turfIntersect from "@turf/intersect";
import { createClient } from "@/lib/supabase/server";
import {
  GisError,
  buildIdentifierLikeWhere,
  buildIdentifierWhere,
  layerFieldTypes,
  queryLayerFeatures,
  trimAttributes,
} from "@/lib/gisServer";
import { identifierFieldsOf, type CountyGisService } from "@/lib/gis";
import { harvestIdentifiers, normalizeIdentifier, printedIdentifier, sameIdentifier, type IdentifierKind } from "@/lib/taxIdentifiers";
import type { CountyLookupHit } from "@/lib/taxMatch";
import { ensureWgs84 } from "@/lib/geo/spatialRef";

export const maxDuration = 60;

// The property tax matcher's live lookup tier (migration 0042): when a
// statement line's printed numbers match nothing in the organization's
// identifier store, ask the county's registered GIS service for the
// parcel BY that number through its mapped identifier fields, and
// report what the county said: its parcel number, the identifiers and
// attributes on the record, and how the record overlaps the
// organization's own parcels in that county (so a parcel whose number
// is recorded differently still resolves spatially). Nothing is saved
// here; the review screen matches and the user confirms.
//
// Body:  { county, state, lines: [{ key, identifiers: [{ kind, value }] }] }
// Reply: { service: { id, display_name } | null, reason?, results: [{ key, hits }] }
// Session client: the parcel overlap reads are scoped by RLS.

interface LineIn {
  key: string;
  identifiers: Array<{ kind: string; value: string; label?: string | null }>;
}

interface Feature {
  geometry: GeoJSON.Geometry | null;
  properties: Record<string, unknown>;
}

type Wanted = { kind: IdentifierKind; value: string; normalized: string; keys: Set<string> };

const MAX_LINES = 60;
const MAX_IDS_PER_LINE = 6;
const MAX_LIKE_RETRIES = 12;
// Every county query is sequential; stop asking before the platform
// kills the function so a slow county returns what it found so far.
const DEADLINE_MS = 40_000;
const QUERY_TIMEOUT_MS = 15_000;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { county?: string; state?: string | null; lines?: LineIn[] };
  const county = String(body.county ?? "").trim();
  const state = String(body.state ?? "AL").trim().toUpperCase() || "AL";
  const lines = (Array.isArray(body.lines) ? body.lines : []).slice(0, MAX_LINES);
  if (!county || lines.length === 0) return NextResponse.json({ error: "county and lines are required" }, { status: 400 });

  const { data: services } = await supabase
    .from("county_gis_services")
    .select("*")
    .eq("status", "active")
    .ilike("county", county)
    .ilike("state", state);
  const svc = ((services ?? []) as CountyGisService[])[0];
  if (!svc) return NextResponse.json({ service: null, reason: "no_service", results: [] });
  const mappings = identifierFieldsOf(svc);
  const serviceOut = { id: svc.id, display_name: svc.display_name };
  if (mappings.length === 0) return NextResponse.json({ service: serviceOut, reason: "no_mapping", results: [] });
  const serviceLabel = `${svc.county} County GIS`;

  // Every printed identifier across the lines, deduped, with the lines
  // that printed it.
  const wanted = new Map<string, Wanted>();
  for (const l of lines) {
    for (const raw of (l.identifiers ?? []).slice(0, MAX_IDS_PER_LINE)) {
      const id = printedIdentifier(raw.label ?? null, raw.kind, raw.value);
      if (!id || id.kind === "other") continue;
      const k = `${id.kind}|${id.normalized}`;
      const w = wanted.get(k) ?? { kind: id.kind, value: id.value, normalized: id.normalized, keys: new Set<string>() };
      w.keys.add(String(l.key));
      wanted.set(k, w);
    }
  }
  if (wanted.size === 0) return NextResponse.json({ service: serviceOut, results: [] });

  const started = Date.now();
  const outOfTime = () => Date.now() - started > DEADLINE_MS;
  try {
    const types = await layerFieldTypes(svc.service_url, svc.layer_id);
    // Hits keyed by the wanted identifier: the county records that
    // carry that number in a mapped column of the same kind (or, when
    // no column of that kind is mapped, any mapped column).
    const hitsByWanted = new Map<string, Feature[]>();
    const featureHas = (f: Feature, field: string, w: Wanted) => {
      const v = f.properties[field];
      if (v === null || v === undefined) return false;
      const s = String(v);
      return sameIdentifier({ value: s, normalized: normalizeIdentifier(s) }, { value: w.value, normalized: w.normalized });
    };
    const queryBatch = async (field: string, ws: Wanted[]) => {
      const where = buildIdentifierWhere(field, types.get(field), ws.map((w) => w.value));
      if (!where || outOfTime()) return;
      const { features } = await queryLayerFeatures({
        serviceUrl: svc.service_url,
        layerId: svc.layer_id,
        where,
        maxFeatures: Math.max(ws.length * 3, 10),
        timeoutMs: QUERY_TIMEOUT_MS,
        serviceLabel: svc.display_name,
      });
      for (const w of ws) {
        const k = `${w.kind}|${w.normalized}`;
        const mine = features.filter((f) => featureHas(f, field, w));
        if (mine.length) hitsByWanted.set(k, [...(hitsByWanted.get(k) ?? []), ...mine]);
      }
    };
    const unresolved = () => [...wanted.entries()].filter(([k]) => !hitsByWanted.has(k)).map(([, w]) => w);
    // Kind-aware pass: each mapped column against the values of its kind.
    for (const m of mappings) {
      const ws = [...wanted.values()].filter((w) => w.kind === m.kind);
      if (ws.length) await queryBatch(m.field, ws);
    }
    // Kind-agnostic pass for values still unresolved (counties relabel
    // the same number): every mapped column of another kind. Account
    // numbers stay out of it on both sides: a bill's account against a
    // PPIN column (or a PPIN against an account column) can only hit an
    // unrelated parcel by coincidence.
    const isAccount = (k: string) => k === "account_number";
    for (const m of mappings) {
      if (isAccount(m.kind)) continue;
      const ws = unresolved().filter((w) => w.kind !== m.kind && !isAccount(w.kind));
      if (ws.length) await queryBatch(m.field, ws);
    }
    // Looser LIKE retry, one value at a time, capped.
    let retries = 0;
    for (const w of unresolved()) {
      if (retries >= MAX_LIKE_RETRIES || outOfTime()) break;
      for (const m of mappings) {
        if (retries >= MAX_LIKE_RETRIES || outOfTime()) break;
        if (isAccount(m.kind) !== isAccount(w.kind)) continue;
        const where = buildIdentifierLikeWhere(m.field, types.get(m.field), w.value);
        if (!where) continue;
        retries++;
        const { features } = await queryLayerFeatures({
          serviceUrl: svc.service_url,
          layerId: svc.layer_id,
          where,
          maxFeatures: 5,
          timeoutMs: QUERY_TIMEOUT_MS,
          serviceLabel: svc.display_name,
        });
        const mine = features.filter((f) => featureHas(f, m.field, w));
        if (mine.length) {
          hitsByWanted.set(`${w.kind}|${w.normalized}`, mine);
          break;
        }
      }
    }

    // Overlap against the organization's parcels in this county (RLS
    // scoped), loaded once and only when some hit carries geometry.
    let ownParcels: Array<{ id: string; geometry: GeoJSON.Geometry }> | null = null;
    const loadOwn = async () => {
      if (ownParcels) return ownParcels;
      const { data } = await supabase.from("parcels_geo").select("id, boundary_geojson").ilike("county", svc.county);
      ownParcels = ((data ?? []) as Array<{ id: string; boundary_geojson: GeoJSON.Geometry | null }>)
        .filter((p) => p.boundary_geojson)
        .map((p) => ({ id: p.id, geometry: p.boundary_geojson as GeoJSON.Geometry }));
      return ownParcels;
    };
    type Poly = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
    const overlapsOf = async (geometry: GeoJSON.Geometry | null) => {
      if (!geometry || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) return [];
      const own = await loadOwn();
      const feature = { type: "Feature", properties: {}, geometry: ensureWgs84(geometry).geometry } as Poly;
      let base = 0;
      try {
        base = turfArea(feature);
      } catch {
        return [];
      }
      if (!(base > 0)) return [];
      const out: Array<{ parcel_id: string; share: number }> = [];
      for (const p of own) {
        if (p.geometry.type !== "Polygon" && p.geometry.type !== "MultiPolygon") continue;
        try {
          const inter = turfIntersect({
            type: "FeatureCollection",
            features: [feature, { type: "Feature", properties: {}, geometry: p.geometry } as Poly],
          });
          if (!inter) continue;
          const share = turfArea(inter) / base;
          if (share >= 0.05) out.push({ parcel_id: p.id, share: Math.round(share * 1000) / 1000 });
        } catch {
          // A malformed county ring never fails the lookup.
        }
      }
      return out.sort((a, b) => b.share - a.share);
    };

    const results: Array<{ key: string; hits: CountyLookupHit[] }> = lines.map((l) => ({ key: String(l.key), hits: [] }));
    const byKey = new Map(results.map((r) => [r.key, r]));
    for (const [k, w] of wanted) {
      const feats = hitsByWanted.get(k) ?? [];
      for (const f of feats.slice(0, 3)) {
        const attributes = trimAttributes(f.properties);
        const hit: CountyLookupHit = {
          kind: w.kind,
          value: w.value,
          parcel_number: String(f.properties[svc.parcel_field] ?? "").trim(),
          service_label: serviceLabel,
          service_display_name: svc.display_name,
          service_id: svc.id,
          identifiers: harvestIdentifiers(attributes, { parcelField: svc.parcel_field, identifierFields: mappings }),
          attributes,
          overlaps: await overlapsOf(f.geometry),
        };
        for (const key of w.keys) byKey.get(key)?.hits.push(hit);
      }
    }
    return NextResponse.json({ service: serviceOut, results });
  } catch (err) {
    const status = err instanceof GisError ? err.status : 502;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "County lookup failed.", service: serviceOut, results: [] },
      { status }
    );
  }
}
