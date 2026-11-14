"use client";

import { useActionState } from "react";
import Link from "next/link";
import PasswordField from "@/components/auth/PasswordField";
import { signup, type AuthFormState } from "../actions";

const initialState: AuthFormState = { error: null };

export default function SignupPage() {
  const [state, formAction, pending] = useActionState(signup, initialState);

  // Once the confirmation email is on its way the form has done its job:
  // show only what to do next, so nobody submits it twice.
  if (state.message) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-pine-900">Check your email</h1>
        <p role="status" className="rounded-lg bg-kelly-50 p-3 text-sm text-pine-900">
          {state.message}
        </p>
        <p className="text-sm text-gray-600">
          After you tap the link you will be signed in and taken to your land.
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
      <h1 className="text-xl font-semibold text-pine-900">Create your account</h1>
      <p className="text-sm text-gray-600">
        Use the same email address the person who invited you has on file
        for you. That is how your account is connected to the land.
      </p>

      <div>
        <label htmlFor="full_name" className="mb-1 block text-sm font-medium text-gray-700">
          Full name
        </label>
        <input
          id="full_name"
          name="full_name"
          type="text"
          autoComplete="name"
          required
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-kelly-500 focus:outline-none focus:ring-2 focus:ring-kelly-100"
        />
      </div>

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

      <PasswordField
        id="password"
        name="password"
        label="Password"
        autoComplete="new-password"
        minLength={8}
        hint="At least 8 characters. Tap Show to check what you typed."
      />

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
        {pending ? "Creating account..." : "Create account"}
      </button>

      <p className="text-center text-sm text-gray-600">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-kelly-700 hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
