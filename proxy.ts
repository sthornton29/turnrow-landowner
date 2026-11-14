import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Public routes that never require a session. /api/farm/sync is public at
// the middleware level because the Vercel cron calls it; the route itself
// enforces CRON_SECRET (GET) or a user session (POST). /api/ops (the
// read-only ops API, 2026-11-08) is called with a bearer token by the
// morning brief and Turnrow Farm; its routes enforce OPS_TOKEN, and the
// ops actions under /api/ops/actions (2026-11-09) enforce OPS_WRITE_TOKEN.
// /forgot-password and /reset-password are the password reset pages: the
// first is used signed out by definition, and the second explains itself
// when the emailed link did not sign the person in.
const PUBLIC_PATHS = [
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/auth",
  "/api/farm/sync",
  "/api/ops",
];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refreshes the session cookie if expired; also tells us who is logged in.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + "/"));

  if (!user && !isPublic) {
    // A signed-out request to the API gets a plain 401 the caller can
    // read, not a redirect to an HTML page it would try to parse.
    if (path.startsWith("/api/")) {
      return NextResponse.json({ error: "Please sign in." }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    // Remember where they were headed (a link someone texted them) so
    // signing in takes them there instead of always to the map.
    const wanted = path + request.nextUrl.search;
    url.pathname = "/login";
    url.search = "";
    if (path !== "/" && wanted.length <= 500) url.searchParams.set("next", wanted);
    return NextResponse.redirect(url);
  }

  if (user && (path === "/login" || path === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/map";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Run on everything except static assets.
    "/((?!_next/static|_next/image|favicon.ico|favicon-32.png|brand/|icons/|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
