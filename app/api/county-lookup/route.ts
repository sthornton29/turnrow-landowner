import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { GisError } from "@/lib/gisServer";
import { lookupCounty } from "@/lib/countyLookup";

// Which county is this point in? Used by the plotting flow's county
// gate (resolved section centroid, point of beginning pin). Session
// required; the Census service is public and the result is cached
// in-process per rounded point.
export const maxDuration = 30;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { lon?: unknown; lat?: unknown };
  const lon = Number(body.lon);
  const lat = Number(body.lat);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return NextResponse.json({ error: "Give a lon and lat." }, { status: 400 });
  }
  try {
    const hit = await lookupCounty(lon, lat);
    return NextResponse.json({ county: hit });
  } catch (err) {
    const status = err instanceof GisError ? err.status : 502;
    return NextResponse.json(
      { error: "Could not look up the county right now.", county: null },
      { status }
    );
  }
}
