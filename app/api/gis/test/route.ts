import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  GisError,
  normalizeFeatures,
  queryLayerFeatures,
} from "@/lib/gisServer";

// Platform admin: run a one-record test query through proposed field
// mappings and return the normalized sample for verification.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_platform_admin")
    .eq("id", user.id)
    .single();
  if (!profile?.is_platform_admin) {
    return NextResponse.json({ error: "Platform admin only" }, { status: 403 });
  }

  const body = await request.json();
  const mapping = {
    parcel_field: String(body.parcel_field ?? ""),
    owner_field: String(body.owner_field ?? ""),
    acres_field: body.acres_field ? String(body.acres_field) : null,
    situs_field: body.situs_field ? String(body.situs_field) : null,
  };
  if (!mapping.parcel_field || !mapping.owner_field) {
    return NextResponse.json(
      { error: "Map the parcel number and owner fields first." },
      { status: 400 }
    );
  }

  try {
    const { features } = await queryLayerFeatures({
      serviceUrl: String(body.service_url ?? ""),
      layerId: Number(body.layer_id ?? 0),
      where: "1=1",
      maxFeatures: 1,
    });
    const normalized = normalizeFeatures(
      features,
      mapping,
      String(body.service_url ?? "county service")
    );
    if (normalized.length === 0) {
      return NextResponse.json(
        { error: "The query worked but returned no usable record; check the layer." },
        { status: 400 }
      );
    }
    const sample = normalized[0];
    return NextResponse.json({
      sample: {
        parcel_number: sample.parcel_number,
        owner_name: sample.owner_name,
        deeded_acres: sample.deeded_acres,
        computed_acres: sample.computed_acres,
        situs: sample.situs,
        has_geometry: !!sample.geometry,
      },
    });
  } catch (err) {
    const status = err instanceof GisError ? err.status : 502;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Test query failed." },
      { status }
    );
  }
}
