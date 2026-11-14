import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/types/db";

// The gate for every route handler under /api that serves the signed-in
// app: the caller must be signed in AND belong to an organization.
//
// Signup is open (people who are invited register themselves), so anyone
// can hold a valid session without ever being attached to an
// organization. Such an account must not be able to spend the AI budget,
// use the county and USDA proxies, or fill the shared caches, so a
// session alone is never enough.
//
// Usage:
//   const session = await requireOrgApi();
//   if (session instanceof NextResponse) return session;
//   const { supabase, user, orgId, isAdmin } = session;

export type ApiSession = {
  supabase: SupabaseClient;
  user: User;
  orgId: string;
  role: Role;
  isAdmin: boolean;
  isPlatformAdmin: boolean;
};

export async function requireOrgApi(): Promise<ApiSession | NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id, role, is_platform_admin")
    .eq("id", user.id)
    .single();
  const orgId = (profile?.organization_id as string | null | undefined) ?? null;
  if (!orgId) {
    return NextResponse.json(
      { error: "Your account is not connected to an organization yet." },
      { status: 403 }
    );
  }
  const role: Role = profile?.role === "admin" ? "admin" : "user";
  return {
    supabase,
    user,
    orgId,
    role,
    isAdmin: role === "admin",
    isPlatformAdmin: profile?.is_platform_admin === true,
  };
}

// For the few actions only an admin may take (connecting a farm, for
// example). Returns a response to send back, or null when allowed.
export function adminOnly(session: ApiSession, what = "do this"): NextResponse | null {
  if (session.isAdmin) return null;
  return NextResponse.json(
    { error: `Only an admin on your account can ${what}.` },
    { status: 403 }
  );
}
