import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/types/db";

// For server components inside the (app) group: ensures the visitor is
// logged in AND belongs to an organization, otherwise redirects them.
export async function requireOrg() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single<Profile>();

  if (!profile?.organization_id) redirect("/onboarding");

  // Admins see and manage everything; users see only the entities they
  // were granted and cannot create org-level records. Row level security
  // enforces this; isAdmin lets pages hide what would be refused.
  return { supabase, user, profile, isAdmin: profile.role === "admin" };
}

// For the few pages that only make sense for an admin (creating a lease,
// a timber sale, uploading tax statements): anyone else goes back to the
// list page, where they see what they have access to.
export async function requireAdmin(fallbackPath: string) {
  const session = await requireOrg();
  if (!session.isAdmin) redirect(fallbackPath);
  return session;
}
