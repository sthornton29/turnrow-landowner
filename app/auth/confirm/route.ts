import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/safeNext";

// The email-link handler that works on ANY device.
//
// The default Supabase email links go through /auth/callback, which can
// only finish in the same browser that asked for the email (the browser
// holds half of a one-time key pair). Family members will often sign up
// on a computer and open the email on a phone, and that fails.
//
// This route verifies the token that is IN the link, so it does not care
// which device opens it. It is used once the email templates in the
// Supabase dashboard (Authentication > Emails) point here:
//   Confirm signup:
//     {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
//   Reset password:
//     {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password
// Until then nothing links here and /auth/callback keeps working as
// before.

const TYPES: readonly EmailOtpType[] = ["email", "signup", "recovery", "invite", "magiclink", "email_change"];

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const fallback = type === "recovery" ? "/reset-password" : "/onboarding";
  const next = safeNextPath(searchParams.get("next"), fallback);

  if (!tokenHash || !type || !TYPES.includes(type)) {
    return NextResponse.redirect(`${origin}/login?notice=link_failed`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) {
    console.error("auth confirm: verify failed", error.code ?? "", error.message);
    return NextResponse.redirect(`${origin}/login?notice=link_expired`);
  }
  return NextResponse.redirect(`${origin}${next}`);
}
