import { requireOrg } from "@/lib/auth";
import { createInvite, deleteInvite } from "./actions";

export const metadata = { title: "Members" };

export default async function MembersPage() {
  const { supabase, profile } = await requireOrg();
  const isOwner = profile.role === "owner";

  const [{ data: members }, { data: invites }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, email, role")
      .eq("organization_id", profile.organization_id)
      .order("full_name"),
    supabase
      .from("invites")
      .select("id, email, role, accepted_at")
      .is("accepted_at", null)
      .order("created_at"),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Members</h1>
        <p className="mt-0.5 text-sm text-gray-600">
          People with access to your organization.
        </p>
      </div>

      <ul className="space-y-2">
        {(members ?? []).map((m) => (
          <li
            key={m.id}
            className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-3"
          >
            <div>
              <p className="font-medium text-gray-900">
                {m.full_name || m.email}
                {m.id === profile.id ? (
                  <span className="ml-1 text-sm font-normal text-gray-400">(you)</span>
                ) : null}
              </p>
              <p className="text-sm text-gray-500">{m.email}</p>
            </div>
            <span className="rounded-full bg-kelly-50 px-2.5 py-0.5 text-xs font-medium capitalize text-pine-900">
              {m.role}
            </span>
          </li>
        ))}
      </ul>

      {isOwner ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-gray-900">Invite someone</h2>
          <p className="text-sm text-gray-600">
            Add their email here, then have them sign up at this site with the
            same email address. They will be connected automatically.
          </p>
          <form action={createInvite} className="flex flex-wrap gap-2">
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
              <option value="member">Member</option>
              <option value="owner">Owner</option>
            </select>
            <button
              type="submit"
              className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600"
            >
              Invite
            </button>
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
                      <p className="text-xs capitalize text-gray-500">{inv.role}</p>
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
        </section>
      ) : (
        <p className="text-sm text-gray-500">
          Only organization owners can invite new members.
        </p>
      )}
    </div>
  );
}
