import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  GisError,
  buildEntityWheres,
  buildWhere,
  normalizeFeatures,
  queryLayerFeatures,
} from "@/lib/gisServer";
import { normalizeOwnerName, planEntityQuery } from "@/lib/ownerNames";
import type { CountyGisService, EntityParcelFeature } from "@/lib/gis";

const MAX_FEATURES = 200;
// Entity mode searches broad on purpose (one distinctive token catches
// every spelling of a name), so it gets a much higher cap.
const MAX_ENTITY_FEATURES = 1000;

// Search a registered county parcel service by owner name, parcel
// number, or entity (all parcels for an owner however the county wrote
// the name). Runs server-side (CORS, pagination, format fallback) and
// returns clean GeoJSON features with normalized attributes.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json();
  const serviceId = String(body.service_id ?? "");
  const searchType =
    body.search_type === "parcel"
      ? "parcel"
      : body.search_type === "entity"
        ? "entity"
        : "owner";
  const text = String(body.text ?? "").trim();
  if (!serviceId || text.length < 2) {
    return NextResponse.json(
      { error: "Enter at least two characters to search." },
      { status: 400 }
    );
  }

  const { data: service } = await supabase
    .from("county_gis_services")
    .select("*")
    .eq("id", serviceId)
    .single();
  if (!service) {
    return NextResponse.json({ error: "Unknown county service." }, { status: 404 });
  }

  try {
    if (searchType === "entity") {
      const features = await entitySearch(service, text);
      return NextResponse.json({ features, count: features.length });
    }

    const where = buildWhere(searchType, text, service.owner_field, service.parcel_field);
    const { features, truncated } = await queryLayerFeatures({
      serviceUrl: service.service_url,
      layerId: service.layer_id,
      where,
      maxFeatures: MAX_FEATURES,
    });
    const normalized = normalizeFeatures(features, service);
    return NextResponse.json({
      features: normalized,
      truncated,
      count: normalized.length,
    });
  } catch (err) {
    const status = err instanceof GisError ? err.status : 502;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Search failed." },
      { status }
    );
  }
}

// Broad entity search: query the county for every owner containing the
// seed's most distinctive token, falling back to narrower two-token
// patterns when that token alone is too common. Never silently
// truncates: overflow becomes a clear "add another word" error.
async function entitySearch(
  service: CountyGisService,
  text: string
): Promise<EntityParcelFeature[]> {
  const plan = planEntityQuery(text);
  if (!plan) {
    throw new GisError(
      "Enter at least one full word of the name; initials alone are not enough.",
      400
    );
  }
  const tooCommon = new GisError(
    `"${plan.distinctive}" is too common in ${service.display_name}. Add another word (a first name, or the company's second word) and search again.`,
    400
  );

  const { broad, narrowed } = buildEntityWheres(
    plan.distinctive,
    plan.others,
    service.owner_field
  );
  const query = (where: string) =>
    queryLayerFeatures({
      serviceUrl: service.service_url,
      layerId: service.layer_id,
      where,
      maxFeatures: MAX_ENTITY_FEATURES,
    });

  let collected = await query(broad).then((r) => (r.truncated ? null : r.features));
  if (!collected) {
    if (narrowed.length === 0) throw tooCommon;
    collected = [];
    for (const where of narrowed) {
      const result = await query(where);
      if (result.truncated) throw tooCommon;
      collected.push(...result.features);
    }
  }

  // Dedupe (the narrowed queries overlap) by parcel number, then attach
  // the canonical owner name so client and server agree on grouping.
  const seen = new Set<string>();
  const out: EntityParcelFeature[] = [];
  for (const feature of normalizeFeatures(collected, service)) {
    if (feature.parcel_number.length > 0) {
      if (seen.has(feature.parcel_number)) continue;
      seen.add(feature.parcel_number);
    }
    const { normalized, strippedTokens } = normalizeOwnerName(feature.owner_name);
    out.push({
      ...feature,
      owner_normalized: normalized,
      owner_stripped: strippedTokens,
    });
  }
  return out;
}
