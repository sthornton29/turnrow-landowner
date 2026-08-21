import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { queryLayerFeatures } from "@/lib/gisServer";
import {
  PLSS_SECTION_LAYER,
  PLSS_SERVICE_LABEL,
  PLSS_SERVICE_URL,
  cacheKey,
  normalizePlssFeature,
  type PlssCandidate,
} from "@/lib/plss";

export const maxDuration = 120;

// Build or refresh the caller's LAND INDEX (migration 0029): for every
// property whose boundary changed since it was last indexed, fetch the
// BLM PLSS sections in its bounding box, cache them globally
// (plss_cache, service role), and record which sections the property
// and its parcels overlap and by how much (match_boundaries RPC on the
// session client, RLS). Idempotent and cheap when nothing changed.
// Body: { force?: boolean }. Returns counts.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { force?: boolean };

  const { data: profile } = await supabase.from("profiles").select("organization_id").eq("id", user.id).single();
  const orgId = profile?.organization_id as string | undefined;
  if (!orgId) return NextResponse.json({ error: "No organization" }, { status: 400 });

  const [{ data: properties }, { data: parcels }, { data: existing }] = await Promise.all([
    supabase.from("properties").select("id, name, updated_at"),
    supabase.from("parcels").select("id, property_id, updated_at"),
    supabase.from("land_sections").select("property_id, indexed_at"),
  ]);
  const indexedAt = new Map<string, string>();
  for (const row of existing ?? []) {
    const cur = indexedAt.get(row.property_id as string);
    if (!cur || String(row.indexed_at) < cur) indexedAt.set(row.property_id as string, String(row.indexed_at));
  }
  const parcelsByProperty = new Map<string, Array<{ id: string; updated_at: string }>>();
  for (const pc of parcels ?? []) {
    const list = parcelsByProperty.get(pc.property_id as string) ?? [];
    list.push({ id: pc.id as string, updated_at: String(pc.updated_at) });
    parcelsByProperty.set(pc.property_id as string, list);
  }

  const svc =
    process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL
      ? createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
          auth: { persistSession: false },
        })
      : null;

  const deadline = Date.now() + 100_000;
  let indexed = 0;
  let skipped = 0;
  let sections = 0;
  const failures: string[] = [];

  for (const p of properties ?? []) {
    const pid = p.id as string;
    const since = indexedAt.get(pid);
    const newest = [String(p.updated_at), ...(parcelsByProperty.get(pid) ?? []).map((x) => x.updated_at)].sort().pop()!;
    if (!body.force && since && newest <= since) {
      skipped++;
      continue;
    }
    if (Date.now() > deadline) {
      failures.push(`${p.name}: ran out of time; run again`);
      continue;
    }
    try {
      const { data: bbox } = await supabase.rpc("boundary_bbox", { p_entity_type: "property", p_entity_id: pid });
      const b = (bbox as Array<{ xmin: number; ymin: number; xmax: number; ymax: number }> | null)?.[0];
      if (!b) {
        skipped++;
        continue;
      }
      const { features } = await queryLayerFeatures({
        serviceUrl: PLSS_SERVICE_URL,
        layerId: PLSS_SECTION_LAYER,
        where: "FRSTDIVTYP = 'SN'",
        geometry: [b.xmin, b.ymin, b.xmax, b.ymax],
        maxFeatures: 60,
        outFields: "PLSSID,FRSTDIVNO,FRSTDIVDUP,FRSTDIVTYP",
        timeoutMs: 25000,
        serviceLabel: PLSS_SERVICE_LABEL,
      });
      const candidates = features
        .map((f) => normalizePlssFeature(f as { geometry: PlssCandidate["polygon"] | null; properties: Record<string, unknown> }))
        .filter((c): c is PlssCandidate => c !== null);
      if (svc && candidates.length > 0) {
        await svc.from("plss_cache").upsert(
          candidates.map((c) => ({
            key: cacheKey(c.attrs.state, c.attrs.township, c.attrs.range, c.attrs.section, c.attrs.meridian),
            state: c.attrs.state,
            township: c.attrs.township,
            range: c.attrs.range,
            section: c.attrs.section,
            meridian: c.attrs.meridian,
            geojson: c.polygon,
            attrs: { ...c.attrs, acres: c.acres },
            fetched_at: new Date().toISOString(),
          })),
          { onConflict: "key" }
        );
      }
      const now = new Date().toISOString();
      const rows: Array<Record<string, unknown>> = [];
      const parcelIds = new Set((parcelsByProperty.get(pid) ?? []).map((x) => x.id));
      for (const c of candidates) {
        const { data: hits } = await supabase.rpc("match_boundaries", { p_geojson: c.polygon });
        for (const h of (hits as Array<Record<string, unknown>> | null) ?? []) {
          const et = String(h.entity_type);
          const id = String(h.id);
          if (!((et === "property" && id === pid) || (et === "parcel" && parcelIds.has(id)))) continue;
          rows.push({
            organization_id: orgId,
            entity_type: et,
            entity_id: id,
            property_id: pid,
            section_key: cacheKey(c.attrs.state, c.attrs.township, c.attrs.range, c.attrs.section, c.attrs.meridian),
            state: c.attrs.state,
            township: c.attrs.township,
            range: c.attrs.range,
            section: c.attrs.section,
            meridian: c.attrs.meridian,
            overlap_acres: Number(h.overlap_acres) || 0,
            pct_of_section: Number(h.pct_of_described) || 0,
            pct_of_boundary: h.pct_of_boundary === null ? null : Number(h.pct_of_boundary),
            indexed_at: now,
          });
        }
      }
      await supabase.from("land_sections").delete().eq("property_id", pid);
      if (rows.length > 0) {
        const { error } = await supabase.from("land_sections").insert(rows);
        if (error) throw new Error(error.message);
      }
      sections += rows.filter((r) => r.entity_type === "property").length;
      indexed++;
    } catch (err) {
      failures.push(`${p.name}: ${err instanceof Error ? err.message : "failed"}`);
    }
  }
  return NextResponse.json({ indexed, skipped, sections, failures });
}
