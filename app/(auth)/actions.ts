"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export type AuthFormState = { error: string | null; message?: string | null };

export async function login(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const supabase = await createClient();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { error: "Invalid email or password." };
  }
  redirect("/map");
}

export async function signup(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const supabase = await createClient();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("full_name") ?? "").trim();

  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  const headerList = await headers();
  const origin = headerList.get("origin") ?? "";

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: `${origin}/auth/callback`,
    },
  });
  if (error) {
    return { error: error.message };
  }

  // If email confirmation is disabled in Supabase, a session exists already.
  if (data.session) {
    redirect("/onboarding");
  }
  return {
    error: null,
    message: "Check your email for a confirmation link, then sign in.",
  };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
