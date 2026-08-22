import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildWhere, normalizeFeatures, queryLayerFeatures } from "@/lib/gisServer";
import { parcelsEqual } from "@/lib/parcelNumber";
import { harvestIdentifiers } from "@/lib/taxIdentifiers";
import type { CountyGisService } from "@/lib/gis";

export const maxDuration = 120;

// Fetch county attributes for parcels imported before attribute
// retention (migration 0030): query the county's registered service by
// parcel number, keep the matching feature's attribute set on the
// parcel, and harvest its identifiers. Body: { parcel_ids?: string[] }
// (default: every parcel with no attributes in a county that has an
// active service). Session client: RLS scopes the parcels.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { parcel_ids?: string[] };

  const { data: profile } = await supabase.from("profiles").select("organization_id").eq("id", user.id).single();
  const orgId = profile?.organization_id as string | undefined;
  if (!orgId) return NextResponse.json({ error: "No organization" }, { status: 400 });

  const { data: services } = await supabase.from("county_gis_services").select("*").eq("status", "active");
  const byCounty = new Map<string, CountyGisService>();
  for (const s of (services ?? []) as CountyGisService[]) byCounty.set(`${s.state}|${s.county}`.toLowerCase(), s);

  let q = supabase.from("parcels").select("id, parcel_number, county, attributes, properties(state)");
  if (Array.isArray(body.parcel_ids) && body.parcel_ids.length > 0) q = q.in("id", body.parcel_ids.slice(0, 500));
  else q = q.is("attributes", null);
  const { data: parcels, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const deadline = Date.now() + 100_000;
  let updated = 0;
  let skipped = 0;
  const failures: string[] = [];
  type Row = { id: string; parcel_number: string; county: string | null; properties: { state: string | null } | Array<{ state: string | null }> | null };
  const stateOf = (r: Row) => (Array.isArray(r.properties) ? r.properties[0]?.state : r.properties?.state) ?? "AL";
  for (const p of (parcels ?? []) as unknown as Row[]) {
    if (Date.now() > deadline) {
      failures.push(`${p.parcel_number}: ran out of time; run again`);
      continue;
    }
    const state = stateOf(p);
    const svc = p.county ? byCounty.get(`${state}|${p.county}`.toLowerCase()) : undefined;
    if (!svc || !p.parcel_number) {
      skipped++;
      continue;
    }
    try {
      const { features } = await queryLayerFeatures({
        serviceUrl: svc.service_url,
        layerId: svc.layer_id,
        where: buildWhere("parcel", p.parcel_number, svc.owner_field, svc.parcel_field),
        maxFeatures: 3,
        timeoutMs: 15000,
        serviceLabel: svc.display_name,
      });
      const hit = normalizeFeatures(features, svc, svc.display_name).find((f) => parcelsEqual(f.parcel_number, p.parcel_number));
      if (!hit) {
        skipped++;
        continue;
      }
      const now = new Date().toISOString();
      const { error: upErr } = await supabase
        .from("parcels")
        .update({ attributes: hit.attributes, attributes_source: svc.display_name, attributes_fetched_at: now })
        .eq("id", p.id);
      if (upErr) throw new Error(upErr.message);
      const ids = harvestIdentifiers(hit.attributes, { parcelField: svc.parcel_field });
      if (ids.length > 0) {
        await supabase.from("parcel_identifiers").upsert(
          ids.map((i) => ({
            organization_id: orgId,
            parcel_id: p.id,
            kind: i.kind,
            label: i.label,
            value: i.value,
            normalized: i.normalized,
            source: "county_import",
            source_ref: svc.id,
            last_seen_at: now,
          })),
          { onConflict: "parcel_id,kind,normalized" }
        );
      }
      updated++;
    } catch (err) {
      failures.push(`${p.parcel_number}: ${err instanceof Error ? err.message : "failed"}`);
    }
  }
  return NextResponse.json({ updated, skipped, failures });
}
