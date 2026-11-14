"use client";

import { useActionState } from "react";
import Link from "next/link";
import PasswordField from "@/components/auth/PasswordField";
import { login, resendConfirmation, type AuthFormState } from "../actions";

const initialState: AuthFormState = { error: null };

// Messages for arriving here from an email link or a redirect.
const NOTICES: Record<string, { tone: "good" | "warn"; text: string }> = {
  link_expired: {
    tone: "warn",
    text: "That link has expired or was already used. Sign in if you already confirmed your email, or ask for a new link below.",
  },
  link_failed: {
    tone: "warn",
    text: "That link could not be used here. Email links only work in the same browser, on the same device, where you asked for them. Open the email on that device, or ask for a new link from this one.",
  },
  signed_out: { tone: "good", text: "You are signed out." },
};

export default function LoginForm({ notice, next }: { notice: string | null; next: string }) {
  const [state, formAction, pending] = useActionState(login, initialState);
  const [resendState, resendAction, resendPending] = useActionState(resendConfirmation, initialState);
  const banner = notice ? NOTICES[notice] : undefined;

  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-4">
        <h1 className="text-xl font-semibold text-pine-900">Sign in</h1>

        {banner ? (
          <p
            role="status"
            className={
              "rounded-lg p-3 text-sm " +
              (banner.tone === "good" ? "bg-kelly-50 text-pine-900" : "bg-amber-50 text-amber-900")
            }
          >
            {banner.text}
          </p>
        ) : null}

        <input type="hidden" name="next" value={next} />

        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium text-gray-700">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-kelly-500 focus:outline-none focus:ring-2 focus:ring-kelly-100"
          />
        </div>

        <PasswordField id="password" name="password" label="Password" autoComplete="current-password" />

        {state.error ? (
          <p role="alert" className="text-sm text-red-600">
            {state.error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-kelly-500 px-4 py-2.5 font-semibold text-white transition hover:bg-kelly-600 disabled:opacity-60"
        >
          {pending ? "Signing in..." : "Sign in"}
        </button>
      </form>

      {/* Offered only after a sign-in attempt found the email unconfirmed. */}
      {state.unconfirmedEmail || resendState.unconfirmedEmail ? (
        <form action={resendAction} className="rounded-lg bg-amber-50 p-3">
          <input
            type="hidden"
            name="email"
            value={state.unconfirmedEmail ?? resendState.unconfirmedEmail ?? ""}
          />
          <p className="text-sm text-amber-900">Cannot find the confirmation email?</p>
          <button
            type="submit"
            disabled={resendPending}
            className="mt-2 w-full rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-60"
          >
            {resendPending ? "Sending..." : "Send the confirmation email again"}
          </button>
          {resendState.error ? (
            <p role="alert" className="mt-2 text-sm text-red-600">
              {resendState.error}
            </p>
          ) : null}
        </form>
      ) : null}
      {resendState.message ? (
        <p role="status" className="rounded-lg bg-kelly-50 p-3 text-sm text-pine-900">
          {resendState.message}
        </p>
      ) : null}

      <p className="text-center text-sm">
        <Link href="/forgot-password" className="font-medium text-kelly-700 hover:underline">
          Forgot your password?
        </Link>
      </p>

      <p className="text-center text-sm text-gray-600">
        Invited to Turnrow?{" "}
        <Link href="/signup" className="font-medium text-kelly-700 hover:underline">
          Create your account
        </Link>
      </p>
    </div>
  );
}
