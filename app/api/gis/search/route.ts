import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  GisError,
  buildWhere,
  normalizeFeatures,
  queryLayerFeatures,
} from "@/lib/gisServer";

const MAX_FEATURES = 200;

// Search a registered county parcel service by owner name or parcel
// number. Runs server-side (CORS, pagination, format fallback) and
// returns clean GeoJSON features with normalized attributes.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json();
  const serviceId = String(body.service_id ?? "");
  const searchType = body.search_type === "parcel" ? "parcel" : "owner";
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
