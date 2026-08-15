import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Supabase client for use in server components, server actions, and route
// handlers. Reads the auth session from cookies on every request.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a server component where cookies are read-only.
            // Safe to ignore: middleware refreshes the session instead.
          }
        },
      },
    }
  );
}
