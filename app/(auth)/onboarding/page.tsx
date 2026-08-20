import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../actions";

// Runs after signup/login for users who do not belong to an organization
// yet. If a pending invite matches their email, accept_invite() attaches
// them and we send them to the map. Otherwise (invite-only product)
// they see a "not set up yet" message.
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
    <div className="space-y-4 text-center">
      <h1 className="text-xl font-semibold text-pine-900">Almost there</h1>
      <p className="text-sm text-gray-600">
        Your account was created, but it is not connected to a landowner
        organization yet. If you were invited, make sure you signed up with
        the same email address the invitation was sent to.
      </p>
      <p className="text-sm text-gray-600">
        Otherwise, contact Turnrow to get your organization set up, then sign
        in again.
      </p>
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
