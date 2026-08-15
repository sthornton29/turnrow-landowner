"use client";

import { useActionState } from "react";
import Link from "next/link";
import { login, type AuthFormState } from "../actions";

const initialState: AuthFormState = { error: null };

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <h1 className="text-xl font-semibold text-pine-900">Sign in</h1>

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
          autoComplete="current-password"
          required
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-kelly-500 focus:outline-none focus:ring-2 focus:ring-kelly-100"
        />
      </div>

      {state.error ? (
        <p className="text-sm text-red-600">{state.error}</p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-kelly-500 px-4 py-2.5 font-semibold text-white transition hover:bg-kelly-600 disabled:opacity-60"
      >
        {pending ? "Signing in..." : "Sign in"}
      </button>

      <p className="text-center text-sm text-gray-600">
        Invited to Turnrow?{" "}
        <Link href="/signup" className="font-medium text-kelly-700 hover:underline">
          Create your account
        </Link>
      </p>
    </form>
  );
}
