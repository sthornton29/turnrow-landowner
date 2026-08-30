import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { signOut } from "@/app/(auth)/actions";
import AdminGisClient from "@/app/(app)/admin/gis/AdminGisClient";
import ParcelIdentifierTools from "@/components/admin/ParcelIdentifierTools";
import AdminProgramParams from "@/components/gov/AdminProgramParams";
import { createInvite, deleteInvite, saveEntityAccess, setMemberRole } from "./actions";

export const metadata = { title: "Settings" };

// One settings page: Members (roles, entity access, invites), Admin (the
// platform-admin GIS registry and program parameters), and Sign out.
// Admins see everything; users see only data of entities they are
// granted here (enforced in RLS by migration 0034, not by this UI).
export default async function SettingsPage() {
  const { supabase, profile } = await requireOrg();
  const isAdmin = profile.role === "admin";

  const [
    { data: members },
    { data: invites },
    { data: entities },
    { data: access },
    { data: unassignedProps },
    { data: orphanAssets },
    { data: orphanEasements },
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
    isAdmin
      ? supabase.from("entity_access").select("user_id, entity_id")
      : Promise.resolve({ data: null }),
    isAdmin
      ? supabase.from("properties").select("id, name").is("entity_id", null).order("name")
      : Promise.resolve({ data: null }),
    isAdmin
      ? supabase.from("assets").select("id, name").is("property_id", null).eq("is_active", true).order("name")
      : Promise.resolve({ data: null }),
    isAdmin
      ? supabase.from("easements").select("id, name").is("property_id", null).order("name")
      : Promise.resolve({ data: null }),
    profile.is_platform_admin
      ? supabase
          .from("county_gis_services")
          .select("*")
          .order("state")
          .order("county")
      : Promise.resolve({ data: null }),
    profile.is_platform_admin
      ? supabase.from("program_year_config").select("*").order("crop_year")
      : Promise.resolve({ data: null }),
    profile.is_platform_admin
      ? supabase.from("covered_commodities").select("*").order("name")
      : Promise.resolve({ data: null }),
    profile.is_platform_admin
      ? supabase.from("arc_plc_price_data").select("*")
      : Promise.resolve({ data: null }),
  ]);

  const entityName = new Map((entities ?? []).map((e) => [e.id, e.name]));
  const accessByUser = new Map<string, Set<string>>();
  for (const row of access ?? []) {
    if (!accessByUser.has(row.user_id)) accessByUser.set(row.user_id, new Set());
    accessByUser.get(row.user_id)!.add(row.entity_id);
  }
  const unassignedCount =
    (unassignedProps ?? []).length + (orphanAssets ?? []).length + (orphanEasements ?? []).length;

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4 md:p-6">
      <h1 className="text-xl font-semibold text-gray-900">Settings</h1>

      {/* ------------------------------------------------------ Members */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Members</h2>
          <p className="mt-0.5 text-sm text-gray-600">
            Admins see and manage everything. Users see only the entities
            granted to them here.
          </p>
        </div>

        <ul className="space-y-2">
          {(members ?? []).map((m) => {
            const granted = accessByUser.get(m.id) ?? new Set<string>();
            return (
              <li key={m.id} className="rounded-xl border border-gray-200 bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-gray-900">
                      {m.full_name || m.email}
                      {m.id === profile.id ? (
                        <span className="ml-1 text-sm font-normal text-gray-400">(you)</span>
                      ) : null}
                    </p>
                    <p className="text-sm text-gray-500">{m.email}</p>
                  </div>
                  {isAdmin && m.id !== profile.id ? (
                    <form action={setMemberRole} className="flex items-center gap-1.5">
                      <input type="hidden" name="target" value={m.id} />
                      <select
                        name="role"
                        defaultValue={m.role ?? "user"}
                        className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
                      >
                        <option value="admin">Admin</option>
                        <option value="user">User</option>
                      </select>
                      <button
                        type="submit"
                        className="rounded-lg border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Save
                      </button>
                    </form>
                  ) : (
                    <span className="rounded-full bg-kelly-50 px-2.5 py-0.5 text-xs font-medium capitalize text-pine-900">
                      {m.role}
                    </span>
                  )}
                </div>

                {/* Entity access: only meaningful for user-role members. */}
                {isAdmin && m.role === "user" ? (
                  (entities ?? []).length === 0 ? (
                    <p className="mt-2 text-xs text-amber-700">
                      No entities exist yet. Create entities and assign
                      properties to them, or this user sees nothing.
                    </p>
                  ) : (
                    <form action={saveEntityAccess} className="mt-2 border-t border-gray-100 pt-2">
                      <input type="hidden" name="user_id" value={m.id} />
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Can see
                      </p>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        {(entities ?? []).map((e) => (
                          <label
                            key={e.id}
                            className="flex cursor-pointer items-center gap-1.5 text-sm text-gray-800"
                          >
                            <input
                              type="checkbox"
                              name="entity_ids"
                              value={e.id}
                              defaultChecked={granted.has(e.id)}
                              className="h-4 w-4 accent-kelly-500"
                            />
                            {e.name}
                          </label>
                        ))}
                        <button
                          type="submit"
                          className="rounded-lg border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          Save access
                        </button>
                      </div>
                      {granted.size === 0 ? (
                        <p className="mt-1 text-xs text-amber-700">
                          No entities granted: this user currently sees no data.
                        </p>
                      ) : null}
                    </form>
                  )
                ) : null}
              </li>
            );
          })}
        </ul>

        {/* Unassigned records are visible to admins only; keep that
            deliberate, not accidental. */}
        {isAdmin && unassignedCount > 0 ? (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
            <p className="text-sm font-semibold text-amber-900">
              {unassignedCount} record{unassignedCount === 1 ? "" : "s"} visible to
              admins only
            </p>
            <p className="mt-0.5 text-xs text-amber-800">
              Records not tied to an entity are hidden from user-role members.
              Assign each property to an entity (and each asset or easement to a
              property) so the right people can see them.
            </p>
            <ul className="mt-1.5 space-y-0.5 text-sm">
              {(unassignedProps ?? []).map((p) => (
                <li key={p.id}>
                  <Link href={`/properties/${p.id}`} className="text-amber-900 underline">
                    {p.name}
                  </Link>{" "}
                  <span className="text-xs text-amber-700">property with no entity</span>
                </li>
              ))}
              {(orphanAssets ?? []).map((a) => (
                <li key={a.id}>
                  <Link href={`/assets/${a.id}`} className="text-amber-900 underline">
                    {a.name}
                  </Link>{" "}
                  <span className="text-xs text-amber-700">asset with no property</span>
                </li>
              ))}
              {(orphanEasements ?? []).map((e) => (
                <li key={e.id}>
                  <Link href={`/easements/${e.id}`} className="text-amber-900 underline">
                    {e.name}
                  </Link>{" "}
                  <span className="text-xs text-amber-700">easement with no property</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {isAdmin ? (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">Invite someone</h3>
            <p className="text-sm text-gray-600">
              Add their email here, then have them sign up at this site with the
              same email address. They will be connected automatically.
            </p>
            <form action={createInvite} className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <input
                  name="email"
                  type="email"
                  required
                  placeholder="email@example.com"
                  className="min-w-56 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <select
                  name="role"
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
                <button
                  type="submit"
                  className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600"
                >
                  Invite
                </button>
              </div>
              {(entities ?? []).length > 0 ? (
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    A user can see (ignored for admins)
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {(entities ?? []).map((e) => (
                      <label
                        key={e.id}
                        className="flex cursor-pointer items-center gap-1.5 text-sm text-gray-800"
                      >
                        <input
                          type="checkbox"
                          name="entity_ids"
                          value={e.id}
                          className="h-4 w-4 accent-kelly-500"
                        />
                        {e.name}
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}
            </form>

            {(invites ?? []).length > 0 ? (
              <div>
                <h3 className="mb-2 text-sm font-semibold text-gray-700">
                  Pending invites
                </h3>
                <ul className="space-y-2">
                  {(invites ?? []).map((inv) => (
                    <li
                      key={inv.id}
                      className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-3"
                    >
                      <div>
                        <p className="text-sm font-medium text-gray-900">{inv.email}</p>
                        <p className="text-xs capitalize text-gray-500">
                          {inv.role}
                          {inv.role === "user"
                            ? (inv.entity_ids ?? []).length > 0
                              ? ": " +
                                (inv.entity_ids as string[])
                                  .map((id) => entityName.get(id) ?? "?")
                                  .join(", ")
                              : ": no entities granted yet"
                            : null}
                        </p>
                      </div>
                      <form action={deleteInvite}>
                        <input type="hidden" name="id" value={inv.id} />
                        <button
                          type="submit"
                          className="text-sm font-medium text-red-600 hover:underline"
                        >
                          Revoke
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-gray-500">
            Only admins can invite new members or change access.
          </p>
        )}
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
          <ParcelIdentifierTools />
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
