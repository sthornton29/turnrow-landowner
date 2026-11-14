import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/safeNext";

// Handles the redirect from Supabase email links (signup confirmation,
// password reset). Exchanges the one-time code for a session cookie,
// then sends the person on. When the link cannot be used, they land on
// the sign-in page WITH a reason, never a silent bounce:
//   link_expired  the link is old or was already used (mail scanners
//                 often open links before the person does)
//   link_failed   the code could not be exchanged; the usual cause is
//                 opening the email in a different browser or device
//                 from the one that asked for it
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // Only a path inside this app; anything else falls back.
  const next = safeNextPath(searchParams.get("next"), "/onboarding");

  // Supabase reports its own failures in the URL instead of a code.
  const linkError = searchParams.get("error_code") ?? searchParams.get("error");
  if (linkError) {
    const expired = /expired|otp/i.test(`${linkError} ${searchParams.get("error_description") ?? ""}`);
    return NextResponse.redirect(`${origin}/login?notice=${expired ? "link_expired" : "link_failed"}`);
  }

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    console.error("auth callback: code exchange failed", error.code ?? "", error.message);
    return NextResponse.redirect(`${origin}/login?notice=link_failed`);
  }

  return NextResponse.redirect(`${origin}/login`);
}
