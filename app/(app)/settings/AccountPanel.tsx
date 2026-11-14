"use client";

import { useActionState } from "react";
import Link from "next/link";
import { updateOwnName, type SettingsFormState } from "./actions";

const initial: SettingsFormState = { error: null, message: null };

// Your own name, the email you sign in with, and your password.
export default function AccountPanel({ fullName, email }: { fullName: string; email: string }) {
  const [state, action, pending] = useActionState(updateOwnName, initial);
  return (
    <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-3">
      <form action={action}>
        <label htmlFor="full_name" className="mb-1 block text-sm font-medium text-gray-700">
          Your name
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="full_name"
            name="full_name"
            type="text"
            autoComplete="name"
            defaultValue={fullName}
            required
            maxLength={120}
            className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-base sm:text-sm"
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            {pending ? "Saving..." : "Save name"}
          </button>
        </div>
        {state.error ? (
          <p role="alert" className="mt-2 text-sm text-red-600">
            {state.error}
          </p>
        ) : null}
        {state.message ? (
          <p role="status" className="mt-2 text-sm text-pine-900">
            {state.message}
          </p>
        ) : null}
      </form>

      <div className="border-t border-gray-100 pt-3 text-sm">
        <p className="text-gray-500">You sign in with</p>
        <p className="break-all font-medium text-gray-900">{email}</p>
      </div>

      <div className="border-t border-gray-100 pt-3">
        <Link
          href="/reset-password"
          className="inline-block rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Change password
        </Link>
      </div>
    </div>
  );
}
