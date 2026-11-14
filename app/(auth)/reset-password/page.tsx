import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import ResetPasswordForm from "./ResetPasswordForm";

export const metadata: Metadata = { title: "Choose a new password" };

// Step 2 of a password reset. The emailed link signs the person in (see
// app/auth/callback) and lands here. Someone already signed in can also
// come here from Settings to change their password. Without a session
// there is nothing to change, so the page says how to get a fresh link.
export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-pine-900">This link is no longer active</h1>
        <p className="text-sm text-gray-600">
          Reset links work once and expire after a while. They also only work
          in the same browser where you asked for them.
        </p>
        <Link
          href="/forgot-password"
          className="block w-full rounded-lg bg-kelly-500 px-4 py-2.5 text-center font-semibold text-white transition hover:bg-kelly-600"
        >
          Send me a new link
        </Link>
        <p className="text-center text-sm">
          <Link href="/login" className="font-medium text-kelly-700 hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  return <ResetPasswordForm email={user.email ?? "your account"} />;
}
