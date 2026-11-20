// LIVE test for migration 0054 (add_parcels_to_property_boundary): a
// parcel imported into a property that already has a boundary grows the
// boundary to take the parcel in. Provisions a scratch organization and
// admin in the REAL Supabase project, runs every case through that
// admin's own session (so RLS and the grants are what the app gets), and
// deletes everything it created. Opt in AFTER 0054 has been applied:
//   BOUNDARY_TEST=1 npx vitest run lib/propertyBoundary.live.test.ts
// Needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and
// SUPABASE_SERVICE_ROLE_KEY (.env.local).
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const live = process.env.BOUNDARY_TEST === "1";

function loadEnv() {
  for (const name of [".env.local", ".env.vercel.local"]) {
    const p = path.join(process.cwd(), name);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const i = line.indexOf("=");
      if (i < 0 || line.startsWith("#")) continue;
      const k = line.slice(0, i).trim();
      if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
    }
  }
}

async function insert(client: SupabaseClient, table: string, row: Record<string, unknown>): Promise<string> {
  const { data, error } = await client.from(table).insert(row).select("id").single();
  if (error || !data) throw new Error(`${table} insert failed: ${error?.message}`);
  return data.id as string;
}

// A box in north Alabama from its west, south, east, and north edges.
// Corners are written out (never added up) so two boxes that share an
// edge share it exactly. 0.002 degrees is roughly 180 by 220 meters,
// about 10 acres.
function box(west: number, south: number, east: number, north: number) {
  return {
    type: "Polygon",
    coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
  };
}

describe.skipIf(!live)("adding parcels to a property boundary (live, migration 0054)", () => {
  it("grows the boundary by parcels outside it and leaves it alone for parcels already inside", async () => {
    loadEnv();
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    expect(url && anon && serviceKey, "Supabase env missing").toBeTruthy();

    const service = createClient(url, serviceKey, { auth: { persistSession: false } });
    const stamp = Date.now();
    const email = `boundary-test-${stamp}@example.com`;
    const password = `Boundary-test-${stamp}!`;
    let orgId = "";
    let adminId = "";
    try {
      orgId = await insert(service, "organizations", { name: `Boundary test org ${stamp}` });
      const { data: made, error: userErr } = await service.auth.admin.createUser({ email, password, email_confirm: true });
      if (userErr || !made.user) throw new Error(`createUser failed: ${userErr?.message}`);
      adminId = made.user.id;
      const { error: attachErr } = await service.from("profiles").update({ organization_id: orgId, role: "admin" }).eq("id", adminId);
      if (attachErr) throw new Error(`profile attach failed: ${attachErr.message}`);
      const asAdmin = createClient(url, anon, { auth: { persistSession: false } });
      const { error: signErr } = await asAdmin.auth.signInWithPassword({ email, password });
      if (signErr) throw new Error(`sign in failed: ${signErr.message}`);

      const setGeometry = async (type: string, id: string, geojson: unknown) => {
        const { data, error } = await asAdmin.rpc("set_geometry", { p_entity_type: type, p_entity_id: id, p_geojson: geojson });
        if (error) throw new Error(`set_geometry failed: ${error.message}`);
        return Number(data);
      };
      const addToBoundary = async (propertyId: string, parcelIds: string[]) => {
        const { data, error } = await asAdmin.rpc("add_parcels_to_property_boundary", { p_property_id: propertyId, p_parcel_ids: parcelIds });
        if (error) throw new Error(`add_parcels_to_property_boundary failed: ${error.message}`);
        return Number(data);
      };
      const parcel = async (propertyId: string, number: string, geojson: unknown) => {
        const id = await insert(asAdmin, "parcels", { organization_id: orgId, property_id: propertyId, parcel_number: number, county: "Test" });
        const acres = await setGeometry("parcel", id, geojson);
        return { id, acres };
      };
      const boundaryOf = async (propertyId: string) => {
        const { data, error } = await asAdmin.from("properties_geo").select("acres, boundary_geojson").eq("id", propertyId).single();
        if (error || !data) throw new Error(`property read failed: ${error?.message}`);
        return { acres: Number(data.acres), geo: data.boundary_geojson as { type: string; coordinates: unknown[] } | null };
      };

      // A property drawn as one square (its "home" parcel), with:
      //   next    a parcel beside it, sharing an edge
      //   inside  a parcel wholly inside the boundary
      //   edge    the county's version of the home square, nudged a little
      //           (97% inside): land the boundary already holds
      //   away    a parcel a mile off
      const home = await insert(asAdmin, "properties", { organization_id: orgId, name: "Home Place" });
      const other = await insert(asAdmin, "properties", { organization_id: orgId, name: "Other Place" });
      const homeAcres = await setGeometry("property", home, box(-87.3, 34.5, -87.298, 34.502));
      const next = await parcel(home, "NEXT", box(-87.298, 34.5, -87.296, 34.502));
      const inside = await parcel(home, "INSIDE", box(-87.2995, 34.5005, -87.2985, 34.5015));
      const edge = await parcel(home, "EDGE", box(-87.29994, 34.5, -87.29794, 34.502));
      const away = await parcel(home, "AWAY", box(-87.28, 34.5, -87.278, 34.502));
      const notOurs = await parcel(other, "NOT OURS", box(-87.26, 34.5, -87.258, 34.502));
      expect(homeAcres).toBeGreaterThan(5);

      // A parcel already inside the boundary changes nothing, whether it
      // sits wholly inside or is the same land drawn a hair differently.
      expect(await addToBoundary(home, [inside.id, edge.id])).toBeCloseTo(homeAcres, 6);
      expect((await boundaryOf(home)).acres).toBeCloseTo(homeAcres, 6);

      // A parcel on ANOTHER property is never added, even when named.
      expect(await addToBoundary(home, [notOurs.id])).toBeCloseTo(homeAcres, 6);

      // The parcel beside it joins the boundary: the acres add up and the
      // shared edge disappears (still one polygon).
      const withNext = await addToBoundary(home, [next.id]);
      expect(withNext).toBeCloseTo(homeAcres + next.acres, 3);
      let b = await boundaryOf(home);
      expect(b.geo?.type).toBe("MultiPolygon");
      expect(b.geo?.coordinates.length).toBe(1);

      // Adding it again changes nothing (it is inside now).
      expect(await addToBoundary(home, [next.id])).toBeCloseTo(withNext, 6);

      // A parcel a mile off becomes a second piece of the boundary.
      const withAway = await addToBoundary(home, [away.id]);
      expect(withAway).toBeCloseTo(withNext + away.acres, 3);
      b = await boundaryOf(home);
      expect(b.geo?.coordinates.length).toBe(2);

      // A property with no boundary gets the named parcels as its boundary.
      expect((await boundaryOf(other)).geo).toBeNull();
      expect(await addToBoundary(other, [notOurs.id])).toBeCloseTo(notOurs.acres, 3);

      // Nothing named, or nothing with a boundary: the boundary stays.
      expect(await addToBoundary(home, [])).toBeCloseTo(withAway, 6);

      // A property that does not exist is an error, not a silent nothing.
      const missing = await asAdmin.rpc("add_parcels_to_property_boundary", {
        p_property_id: "00000000-0000-0000-0000-000000000000",
        p_parcel_ids: [next.id],
      });
      expect(missing.error?.message ?? "").toMatch(/Property not found/);
    } finally {
      if (orgId) await service.from("organizations").delete().eq("id", orgId);
      if (adminId) await service.auth.admin.deleteUser(adminId);
    }
  }, 120_000);
});
