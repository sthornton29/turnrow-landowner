import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchLayerInfo, GisError } from "@/lib/gisServer";
import { guessFields, parseLayerUrl } from "@/lib/gis";

// Platform admin: fetch an ArcGIS layer's metadata so field mappings can
// be picked from real field lists instead of guessed.
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
  const raw = String(body.url ?? "");
  if (!/^https?:\/\//i.test(raw)) {
    return NextResponse.json({ error: "Paste a full http(s) ArcGIS REST URL." }, { status: 400 });
  }
  const { serviceUrl, layerId } = parseLayerUrl(raw);
  const layer = layerId ?? Number(body.layer_id ?? 0);

  try {
    const info = await fetchLayerInfo(serviceUrl, layer);
    if (info.fields.length === 0) {
      return NextResponse.json(
        { error: "That URL responded but lists no fields; check that it points at a layer (ends in /FeatureServer/0 or similar)." },
        { status: 400 }
      );
    }
    return NextResponse.json({
      service_url: serviceUrl,
      layer_id: layer,
      name: info.name,
      geometry_type: info.geometryType,
      max_record_count: info.maxRecordCount,
      fields: info.fields,
      guesses: guessFields(info.fields),
    });
  } catch (err) {
    const status = err instanceof GisError ? err.status : 502;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not read the layer." },
      { status }
    );
  }
}
