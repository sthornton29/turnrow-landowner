import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { harvestIdentifiers } from "@/lib/taxIdentifiers";

export const maxDuration = 60;

// Re-run identifier harvesting over every parcel that has stored county
// attributes (after the harvest patterns improve, or after a backfill).
// Session client; RLS scopes the parcels.
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("organization_id").eq("id", user.id).single();
  const orgId = profile?.organization_id as string | undefined;
  if (!orgId) return NextResponse.json({ error: "No organization" }, { status: 400 });

  const [{ data: parcels }, { data: services }] = await Promise.all([
    supabase.from("parcels").select("id, county, attributes, properties(state)").not("attributes", "is", null),
    supabase.from("county_gis_services").select("id, state, county, parcel_field"),
  ]);
  const parcelField = new Map<string, { id: string; field: string }>();
  for (const s of services ?? []) parcelField.set(`${s.state}|${s.county}`.toLowerCase(), { id: s.id as string, field: s.parcel_field as string });

  let parcelsScanned = 0;
  let identifiers = 0;
  const failures: string[] = [];
  const now = new Date().toISOString();
  type Row = { id: string; county: string | null; attributes: Record<string, unknown> | null; properties: { state: string | null } | Array<{ state: string | null }> | null };
  const stateOf = (r: Row) => (Array.isArray(r.properties) ? r.properties[0]?.state : r.properties?.state) ?? "AL";
  for (const p of (parcels ?? []) as unknown as Row[]) {
    parcelsScanned++;
    const svc = p.county ? parcelField.get(`${stateOf(p)}|${p.county}`.toLowerCase()) : undefined;
    const ids = harvestIdentifiers(p.attributes, { parcelField: svc?.field ?? null });
    if (ids.length === 0) continue;
    const { error } = await supabase.from("parcel_identifiers").upsert(
      ids.map((i) => ({
        organization_id: orgId,
        parcel_id: p.id,
        kind: i.kind,
        label: i.label,
        value: i.value,
        normalized: i.normalized,
        source: "county_import",
        source_ref: svc?.id ?? null,
        last_seen_at: now,
      })),
      { onConflict: "parcel_id,kind,normalized" }
    );
    if (error) failures.push(`${p.id}: ${error.message}`);
    else identifiers += ids.length;
  }
  return NextResponse.json({ parcels: parcelsScanned, identifiers, failures });
}
