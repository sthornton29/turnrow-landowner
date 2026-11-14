import Link from "next/link";
import { headers } from "next/headers";
import { requireOrg } from "@/lib/auth";
import { plural } from "@/lib/format";
import { signOut } from "@/app/(auth)/actions";
import AdminGisClient from "@/app/(app)/admin/gis/AdminGisClient";
import ParcelIdentifierTools from "@/components/admin/ParcelIdentifierTools";
import AdminProgramParams from "@/components/gov/AdminProgramParams";
import AccountPanel from "./AccountPanel";
import MembersPanel from "./MembersPanel";

export const metadata = { title: "Settings" };

// The address of this site, for the sign-up link an admin sends to the
// people they invite.
async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  if (!host) return "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

// One settings page: your own account, Members (roles, entity access,
// invites), Admin (the platform-admin GIS registry and program
// parameters), and Sign out. Admins see everything; users see only data
// of entities they are granted here (enforced in RLS by migration 0034,
// not by this UI).
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase, profile, user, isAdmin } = await requireOrg();
  const params = await searchParams;
  const notice = Array.isArray(params.notice) ? params.notice[0] : params.notice;
  const none = Promise.resolve({ data: null });

  const [
    { data: members },
    { data: invites },
    { data: entities },
    { data: access },
    // Records only an admin can see, so that is deliberate, not accidental.
    { data: unassignedProps },
    { data: orphanAssets },
    { data: orphanEasements },
    { data: leases },
    { data: leaseLands },
    { data: sales },
    { data: saleStands },
    { data: fsaFarms },
    { data: fsaLinks },
    { data: orphanIssues },
    { data: looseIncome },
    { data: orgDocs },
    { data: docLinks },
    { data: services },
    { data: configs },
    { data: commodities },
    { data: prices },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, email, role")
      .eq("organization_id", profile.organization_id)
      .order("full_name"),
    supabase
      .from("invites")
      .select("id, email, role, entity_ids, accepted_at")
      .is("accepted_at", null)
      .order("created_at"),
    supabase.from("entities").select("id, name").order("name"),
    isAdmin ? supabase.from("entity_access").select("user_id, entity_id") : none,
    isAdmin ? supabase.from("properties").select("id, name").is("entity_id", null).order("name") : none,
    isAdmin
      ? supabase.from("assets").select("id, name").is("property_id", null).eq("is_active", true).order("name")
      : none,
    isAdmin ? supabase.from("easements").select("id, name").is("property_id", null).order("name") : none,
    isAdmin ? supabase.from("leases").select("id, name").order("name") : none,
    isAdmin ? supabase.from("lease_lands").select("lease_id") : none,
    isAdmin ? supabase.from("timber_sales").select("id, sale_name").order("sale_name") : none,
    isAdmin ? supabase.from("timber_sale_stands").select("timber_sale_id") : none,
    isAdmin ? supabase.from("fsa_farms").select("id, farm_number").order("farm_number") : none,
    isAdmin ? supabase.from("fsa_farm_properties").select("fsa_farm_id") : none,
    isAdmin ? supabase.from("maintenance_issues").select("id").is("property_id", null).eq("status", "open") : none,
    isAdmin ? supabase.from("income_records").select("id").is("property_id", null).is("entity_id", null) : none,
    isAdmin ? supabase.from("documents").select("id").eq("entity_type", "organization") : none,
    isAdmin ? supabase.from("document_properties").select("document_id") : none,
    profile.is_platform_admin
      ? supabase.from("county_gis_services").select("*").order("state").order("county")
      : none,
    profile.is_platform_admin ? supabase.from("program_year_config").select("*").order("crop_year") : none,
    profile.is_platform_admin ? supabase.from("covered_commodities").select("*").order("name") : none,
    profile.is_platform_admin ? supabase.from("arc_plc_price_data").select("*") : none,
  ]);

  const accessByUser: Record<string, string[]> = {};
  for (const row of (access ?? []) as Array<{ user_id: string; entity_id: string }>) {
    (accessByUser[row.user_id] ??= []).push(row.entity_id);
  }

  // Parents that a user reaches only through their land: with no land
  // attached, nobody but an admin can see them.
  const landed = new Set(((leaseLands ?? []) as Array<{ lease_id: string }>).map((r) => r.lease_id));
  const leasesNoLand = ((leases ?? []) as Array<{ id: string; name: string }>).filter((l) => !landed.has(l.id));
  const stood = new Set(((saleStands ?? []) as Array<{ timber_sale_id: string }>).map((r) => r.timber_sale_id));
  const salesNoStands = ((sales ?? []) as Array<{ id: string; sale_name: string }>).filter((s) => !stood.has(s.id));
  const linkedFarms = new Set(((fsaLinks ?? []) as Array<{ fsa_farm_id: string }>).map((r) => r.fsa_farm_id));
  const farmsNoProperty = ((fsaFarms ?? []) as Array<{ id: string; farm_number: string | null }>).filter(
    (f) => !linkedFarms.has(f.id)
  );
  const linkedDocs = new Set(((docLinks ?? []) as Array<{ document_id: string }>).map((r) => r.document_id));
  const unfiledDocs = ((orgDocs ?? []) as Array<{ id: string }>).filter((d) => !linkedDocs.has(d.id)).length;
  const issuesNoProperty = (orphanIssues ?? []).length;
  const incomeNoHome = (looseIncome ?? []).length;

  const adminOnlyCount =
    (unassignedProps ?? []).length +
    (orphanAssets ?? []).length +
    (orphanEasements ?? []).length +
    leasesNoLand.length +
    salesNoStands.length +
    farmsNoProperty.length +
    issuesNoProperty +
    incomeNoHome +
    unfiledDocs;

  const origin = await siteOrigin();

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4 md:p-6">
      <h1 className="text-xl font-semibold text-gray-900">Settings</h1>

      {notice === "password_changed" ? (
        <p role="status" className="rounded-xl border border-kelly-500 bg-kelly-50 p-3 text-sm text-pine-900">
          Your new password is saved. Use it the next time you sign in.
        </p>
      ) : null}

      {/* ------------------------------------------------------ Your account */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">Your account</h2>
        <AccountPanel fullName={profile.full_name ?? ""} email={user.email ?? profile.email} />
      </section>

      {/* ------------------------------------------------------ Members */}
      <section className="space-y-4 border-t border-gray-200 pt-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Members</h2>
          <p className="mt-0.5 text-sm text-gray-600">
            Admins see and manage everything. Users see only the entities
            ticked for them here.
          </p>
        </div>

        <MembersPanel
          members={(members ?? []) as Array<{ id: string; full_name: string | null; email: string; role: string | null }>}
          invites={(invites ?? []) as Array<{ id: string; email: string; role: string; entity_ids: string[] | null }>}
          entities={(entities ?? []) as Array<{ id: string; name: string }>}
          access={accessByUser}
          selfId={profile.id}
          isAdmin={isAdmin}
          signupUrl={`${origin}/signup`}
        />

        {/* Records only admins can see: keep that deliberate, not
            accidental. Each kind says how to fix it. */}
        {isAdmin && adminOnlyCount > 0 ? (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
            <p className="text-sm font-semibold text-amber-900">
              {plural(adminOnlyCount, "record")} visible to admins only
            </p>
            <p className="mt-0.5 text-xs text-amber-800">
              A user sees a record through the entity that owns its land. These
              are not tied to any, so user-role members cannot see them. If that
              is what you want, leave them; otherwise follow the fix beside each.
            </p>
            <ul className="mt-2 space-y-1 text-sm text-amber-900">
              {(unassignedProps ?? []).map((p) => (
                <li key={p.id}>
                  <Link href={`/properties/${p.id}`} className="underline">
                    {p.name}
                  </Link>{" "}
                  <span className="text-xs text-amber-700">property with no entity: pick its entity</span>
                </li>
              ))}
              {(orphanAssets ?? []).map((a) => (
                <li key={a.id}>
                  <Link href={`/assets/${a.id}`} className="underline">
                    {a.name}
                  </Link>{" "}
                  <span className="text-xs text-amber-700">asset with no property: pick its property</span>
                </li>
              ))}
              {(orphanEasements ?? []).map((e) => (
                <li key={e.id}>
                  <Link href={`/easements/${e.id}`} className="underline">
                    {e.name}
                  </Link>{" "}
                  <span className="text-xs text-amber-700">easement with no property: pick its property</span>
                </li>
              ))}
              {leasesNoLand.map((l) => (
                <li key={l.id}>
                  <Link href={`/leases/${l.id}`} className="underline">
                    {l.name}
                  </Link>{" "}
                  <span className="text-xs text-amber-700">lease with no land listed: add the leased land</span>
                </li>
              ))}
              {salesNoStands.map((s) => (
                <li key={s.id}>
                  <Link href={`/timber-sales/${s.id}`} className="underline">
                    {s.sale_name}
                  </Link>{" "}
                  <span className="text-xs text-amber-700">timber sale with no stands: link its stands</span>
                </li>
              ))}
              {farmsNoProperty.map((f) => (
                <li key={f.id}>
                  <Link href="/gov-payments" className="underline">
                    FSA farm {f.farm_number ?? "(no number)"}
                  </Link>{" "}
                  <span className="text-xs text-amber-700">not linked to a property: link it under Government Payments</span>
                </li>
              ))}
              {issuesNoProperty > 0 ? (
                <li>
                  <Link href="/maintenance" className="underline">
                    {plural(issuesNoProperty, "open maintenance issue")}
                  </Link>{" "}
                  <span className="text-xs text-amber-700">with no property: pick a property on each</span>
                </li>
              ) : null}
              {incomeNoHome > 0 ? (
                <li>
                  <Link href="/income/records" className="underline">
                    {plural(incomeNoHome, "income record")}
                  </Link>{" "}
                  <span className="text-xs text-amber-700">with no property or entity: set one on each</span>
                </li>
              ) : null}
              {unfiledDocs > 0 ? (
                <li>
                  <Link href="/documents?filter=unfiled" className="underline">
                    {plural(unfiledDocs, "unfiled document")}
                  </Link>{" "}
                  <span className="text-xs text-amber-700">file each one to a property</span>
                </li>
              ) : null}
            </ul>
            <p className="mt-2 text-xs text-amber-800">
              Tenants and their documents are always admin-only.
            </p>
          </div>
        ) : null}
      </section>

      {/* ------------------------------------------------------ Admin */}
      {profile.is_platform_admin ? (
        <section className="space-y-4 border-t border-gray-200 pt-6">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Admin: county GIS services
            </h2>
          </div>
          <AdminGisClient initialServices={services ?? []} embedded />
          <ParcelIdentifierTools services={(services ?? []).map((s) => ({ id: s.id, county: s.county, state: s.state, display_name: s.display_name, status: s.status }))} />
        </section>
      ) : null}

      {profile.is_platform_admin ? (
        <section className="space-y-4 border-t border-gray-200 pt-6">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Admin: government payment program parameters
            </h2>
            <p className="mt-0.5 text-sm text-gray-600">
              Global OBBBA values, published effective reference prices, and MYA
              overrides used by every organization{"'"}s projections.
            </p>
          </div>
          <AdminProgramParams
            configs={configs ?? []}
            commodities={commodities ?? []}
            prices={prices ?? []}
          />
        </section>
      ) : null}

      {/* ------------------------------------------------------ Sign out */}
      <section className="border-t border-gray-200 pt-6">
        <form action={signOut}>
          <button
            type="submit"
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Sign out
          </button>
        </form>
      </section>
    </div>
  );
}
