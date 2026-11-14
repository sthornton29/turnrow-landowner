import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../actions";

export const metadata: Metadata = { title: "Almost there" };

// Runs after signup/login for users who do not belong to an organization
// yet. If a pending invite matches their email, accept_invite() attaches
// them and we send them to the map. Otherwise (invite-only product)
// they see what is missing and who can fix it.
export default async function OnboardingPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .single();

  if (profile?.organization_id) redirect("/map");

  const { data: accepted } = await supabase.rpc("accept_invite");
  if (accepted) redirect("/map");

  return (
    <div className="space-y-4">
      <h1 className="text-center text-xl font-semibold text-pine-900">Almost there</h1>
      <p className="text-sm text-gray-600">
        Your account is created, but it has not been connected to any land
        yet. You are signed in as:
      </p>
      <p className="break-all rounded-lg bg-gray-100 px-3 py-2 text-center text-sm font-medium text-gray-900">
        {user.email}
      </p>
      <div className="space-y-2 text-sm text-gray-600">
        <p>
          The person who invited you needs to add an invitation for exactly
          this email address. Ask them to open Settings, then Members, and
          invite the address shown above.
        </p>
        <p>
          If they invited a different address of yours, sign out and create
          your account with that one instead.
        </p>
      </div>
      {/* A plain link back to this page re-runs the check above. */}
      <Link
        href="/onboarding"
        prefetch={false}
        className="block w-full rounded-lg bg-kelly-500 px-4 py-2.5 text-center font-semibold text-white transition hover:bg-kelly-600"
      >
        I have been invited. Check again
      </Link>
      <form action={signOut}>
        <button
          type="submit"
          className="w-full rounded-lg border border-gray-300 px-4 py-2.5 font-medium text-gray-700 transition hover:bg-gray-50"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
