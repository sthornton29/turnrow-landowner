"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signup, type AuthFormState } from "../actions";

const initialState: AuthFormState = { error: null };

export default function SignupPage() {
  const [state, formAction, pending] = useActionState(signup, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <h1 className="text-xl font-semibold text-pine-900">Create your account</h1>
      <p className="text-sm text-gray-600">
        Sign up with the email address your invitation was sent to.
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
          autoComplete="email"
          required
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-kelly-500 focus:outline-none focus:ring-2 focus:ring-kelly-100"
        />
      </div>

      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium text-gray-700">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-kelly-500 focus:outline-none focus:ring-2 focus:ring-kelly-100"
        />
      </div>

      {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
      {state.message ? (
        <p className="rounded-lg bg-kelly-50 p-3 text-sm text-pine-900">{state.message}</p>
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
