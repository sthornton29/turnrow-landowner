"use client";

import { useActionState } from "react";
import Link from "next/link";
import { requestPasswordReset, type AuthFormState } from "../actions";

const initialState: AuthFormState = { error: null };

// Step 1 of a password reset: ask for the email, send a link.
export default function ForgotPasswordPage() {
  const [state, formAction, pending] = useActionState(requestPasswordReset, initialState);

  if (state.message) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-pine-900">Check your email</h1>
        <p role="status" className="rounded-lg bg-kelly-50 p-3 text-sm text-pine-900">
          {state.message}
        </p>
        <p className="text-sm text-gray-600">
          The link works once, and only in the browser you are using right
          now. It lets you choose a new password.
        </p>
        <Link
          href="/login"
          className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-center font-medium text-gray-700 transition hover:bg-gray-50"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <h1 className="text-xl font-semibold text-pine-900">Forgot your password?</h1>
      <p className="text-sm text-gray-600">
        Enter the email address you sign in with. We will send you a link to
        choose a new password.
      </p>

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
        {pending ? "Sending..." : "Email me a reset link"}
      </button>

      <p className="text-center text-sm">
        <Link href="/login" className="font-medium text-kelly-700 hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
