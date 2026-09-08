import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildWhere, normalizeFeatures, queryLayerFeatures } from "@/lib/gisServer";
import { parcelsEqual } from "@/lib/parcelNumber";
import { harvestIdentifiers } from "@/lib/taxIdentifiers";
import { identifierFieldsOf, type CountyGisService } from "@/lib/gis";

export const maxDuration = 120;

// Fetch county attributes for parcels by parcel number against the
// county's registered service, keep the matching feature's attribute
// set on the parcel, and harvest its identifiers (the registry's
// mapped identifier fields first, migration 0042, then the name
// heuristics). Three ways in, all session-scoped by RLS:
//   { parcel_ids: [...] }         these parcels (the parcel page's
//                                 Refresh from county records)
//   { county, state? }            every parcel in that county, whether
//                                 or not it already has attributes (the
//                                 per-county backfill in Settings > Admin)
//   {}                            every parcel with no attributes yet
//                                 (parcels imported before retention)
// Reports how many parcels gained a PPIN so the backfill's effect is
// visible, not inferred.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { parcel_ids?: string[]; county?: string; state?: string };

  const { data: profile } = await supabase.from("profiles").select("organization_id").eq("id", user.id).single();
  const orgId = profile?.organization_id as string | undefined;
  if (!orgId) return NextResponse.json({ error: "No organization" }, { status: 400 });

  const { data: services } = await supabase.from("county_gis_services").select("*").eq("status", "active");
  const byCounty = new Map<string, CountyGisService>();
  for (const s of (services ?? []) as CountyGisService[]) byCounty.set(`${s.state}|${s.county}`.toLowerCase(), s);

  let q = supabase.from("parcels").select("id, parcel_number, county, attributes, properties(state)");
  const county = String(body.county ?? "").trim();
  if (Array.isArray(body.parcel_ids) && body.parcel_ids.length > 0) q = q.in("id", body.parcel_ids.slice(0, 500));
  else if (county) q = q.ilike("county", county);
  else q = q.is("attributes", null);
  const { data: parcels, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Row = { id: string; parcel_number: string; county: string | null; properties: { state: string | null } | Array<{ state: string | null }> | null };
  const stateOf = (r: Row) => (Array.isArray(r.properties) ? r.properties[0]?.state : r.properties?.state) ?? "AL";
  const wantedState = String(body.state ?? "").trim().toUpperCase();
  const rows = ((parcels ?? []) as unknown as Row[]).filter((r) => !county || !wantedState || stateOf(r).toUpperCase() === wantedState);

  // Which parcels already carry a PPIN, so the report can say how many
  // GAINED one rather than how many rows were written.
  const hadPpin = new Set<string>();
  for (let i = 0; i < rows.length; i += 200) {
    const { data: existing, error: exErr } = await supabase
      .from("parcel_identifiers")
      .select("parcel_id")
      .eq("kind", "ppin")
      .in("parcel_id", rows.slice(i, i + 200).map((r) => r.id));
    if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 });
    for (const e of existing ?? []) hadPpin.add(e.parcel_id as string);
  }

  const deadline = Date.now() + 100_000;
  let updated = 0;
  let skipped = 0;
  let identifiers = 0;
  let gainedPpin = 0;
  const failures: string[] = [];
  for (const p of rows) {
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
      const ids = harvestIdentifiers(hit.attributes, { parcelField: svc.parcel_field, identifierFields: identifierFieldsOf(svc) });
      if (ids.length > 0) {
        const { error: idErr } = await supabase.from("parcel_identifiers").upsert(
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
        if (idErr) throw new Error(idErr.message);
        identifiers += ids.length;
        if (!hadPpin.has(p.id) && ids.some((i) => i.kind === "ppin")) gainedPpin++;
      }
      updated++;
    } catch (err) {
      failures.push(`${p.parcel_number}: ${err instanceof Error ? err.message : "failed"}`);
    }
  }
  return NextResponse.json({ updated, skipped, identifiers, gained_ppin: gainedPpin, failures });
}
