"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/safeNext";

export type AuthFormState = {
  error: string | null;
  message?: string | null;
  // Set when sign-in failed because the email was never confirmed, so
  // the form can offer to send the confirmation link again.
  unconfirmedEmail?: string | null;
};

const CONNECTION_PROBLEM = "Could not reach the server. Check your connection and try again.";
const TOO_MANY_EMAILS =
  "Too many emails were just sent to this address. Wait a few minutes, check your inbox and spam folder, then try again.";

// The address this site is being served from, for links in emails.
async function siteOrigin(): Promise<string> {
  const headerList = await headers();
  const origin = headerList.get("origin");
  if (origin) return origin;
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "";
  if (!host) return "";
  const proto = headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

function errorCode(error: unknown): string {
  return (error as { code?: string } | null)?.code ?? "";
}

function isRateLimited(error: unknown): boolean {
  const code = errorCode(error);
  const status = (error as { status?: number } | null)?.status;
  return code === "over_email_send_rate_limit" || code === "over_request_rate_limit" || status === 429;
}

export async function login(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const supabase = await createClient();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNextPath(String(formData.get("next") ?? ""), "/map");

  let error: unknown = null;
  try {
    ({ error } = await supabase.auth.signInWithPassword({ email, password }));
  } catch {
    return { error: CONNECTION_PROBLEM };
  }
  if (error) {
    if (errorCode(error) === "email_not_confirmed") {
      return {
        error:
          "This email address has not been confirmed yet. Open the confirmation email we sent when you signed up and tap the link in it.",
        unconfirmedEmail: email,
      };
    }
    if (isRateLimited(error)) {
      return { error: "Too many sign-in attempts. Wait a minute and try again." };
    }
    return {
      error:
        "That email and password do not match an account. Check both, or use Forgot your password below.",
    };
  }
  redirect(next);
}

export async function signup(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const supabase = await createClient();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("full_name") ?? "").trim();

  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  const origin = await siteOrigin();

  let data: Awaited<ReturnType<typeof supabase.auth.signUp>>["data"] | null = null;
  let error: unknown = null;
  try {
    ({ data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: `${origin}/auth/callback`,
      },
    }));
  } catch {
    return { error: CONNECTION_PROBLEM };
  }
  if (error) {
    if (isRateLimited(error)) return { error: TOO_MANY_EMAILS };
    const code = errorCode(error);
    if (code === "user_already_exists" || code === "email_exists") {
      return {
        error: "An account with this email already exists. Sign in instead, or use Forgot your password on the sign-in page.",
      };
    }
    if (code === "weak_password") {
      return { error: "That password is too easy to guess. Use at least 8 characters with a mix of letters and numbers." };
    }
    if (code === "email_address_invalid" || code === "validation_failed") {
      return { error: "That email address does not look right. Check it and try again." };
    }
    console.error("signup failed", code, (error as { message?: string }).message);
    return { error: "We could not create the account just now. Try again in a few minutes." };
  }

  // If email confirmation is disabled in Supabase, a session exists already.
  if (data?.session) {
    redirect("/onboarding");
  }
  // With confirmation on, signing up again with an address that already
  // has an account returns no error and sends NO email (the reply is
  // deliberately vague). The giveaway is a user with no identities.
  if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    return {
      error: "An account with this email already exists. Sign in instead, or use Forgot your password on the sign-in page.",
    };
  }
  return {
    error: null,
    message: `We sent a confirmation link to ${email}. Open that email on this device and tap the link to finish. It can take a minute to arrive; check your spam folder if you do not see it.`,
  };
}

// Sends the signup confirmation email again (the first one expired, was
// lost, or went to spam).
export async function resendConfirmation(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const supabase = await createClient();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) return { error: "Enter your email address first." };
  const origin = await siteOrigin();
  try {
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: `${origin}/auth/callback` },
    });
    if (error) {
      if (isRateLimited(error)) return { error: TOO_MANY_EMAILS, unconfirmedEmail: email };
      console.error("resend confirmation failed", errorCode(error));
      return { error: "We could not send the email just now. Try again in a few minutes.", unconfirmedEmail: email };
    }
  } catch {
    return { error: CONNECTION_PROBLEM, unconfirmedEmail: email };
  }
  return {
    error: null,
    message: `A new confirmation link is on its way to ${email}. Open it on this device.`,
  };
}

// Step 1 of a password reset: email a link. The reply is the same
// whether or not the address has an account, so this form cannot be used
// to find out who has one.
export async function requestPasswordReset(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const supabase = await createClient();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) return { error: "Enter your email address." };
  const origin = await siteOrigin();
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/auth/callback?next=/reset-password`,
    });
    if (error) {
      if (isRateLimited(error)) return { error: TOO_MANY_EMAILS };
      console.error("password reset request failed", errorCode(error));
    }
  } catch {
    return { error: CONNECTION_PROBLEM };
  }
  return {
    error: null,
    message: `If ${email} has an account, a link to choose a new password is on its way. Open that email on this device and tap the link. Check your spam folder if you do not see it in a minute or two.`,
  };
}

// Step 2: the emailed link signed the person in; now they choose a new
// password. Also used from Settings to change a password while signed in.
export async function updatePassword(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const supabase = await createClient();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }
  if (password !== confirm) {
    return { error: "The two passwords do not match. Type the same password in both boxes." };
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      error: "This reset link is no longer active. Go back and ask for a new one.",
    };
  }
  try {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      const code = errorCode(error);
      if (code === "same_password") {
        return { error: "That is the password you already have. Choose a different one." };
      }
      if (code === "weak_password") {
        return { error: "That password is too easy to guess. Use at least 8 characters with a mix of letters and numbers." };
      }
      if (code === "reauthentication_needed" || code === "session_not_found") {
        return { error: "This reset link is no longer active. Go back and ask for a new one." };
      }
      console.error("password update failed", code);
      return { error: "We could not save the new password just now. Try again in a minute." };
    }
  } catch {
    return { error: CONNECTION_PROBLEM };
  }
  // Settings shows the confirmation. (Someone who is not connected to an
  // organization yet is passed on to the onboarding page from there.)
  redirect("/settings?notice=password_changed");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
