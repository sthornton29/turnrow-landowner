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

  return { supabase, user, profile };
}
