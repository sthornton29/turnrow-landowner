"use client";

import { useActionState } from "react";
import PasswordField from "@/components/auth/PasswordField";
import { updatePassword, type AuthFormState } from "../actions";

const initialState: AuthFormState = { error: null };

export default function ResetPasswordForm({ email }: { email: string }) {
  const [state, formAction, pending] = useActionState(updatePassword, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <h1 className="text-xl font-semibold text-pine-900">Choose a new password</h1>
      <p className="text-sm text-gray-600">
        For <span className="font-medium text-gray-800">{email}</span>. You will
        use the new password the next time you sign in.
      </p>

      <PasswordField
        id="password"
        name="password"
        label="New password"
        autoComplete="new-password"
        minLength={8}
        hint="At least 8 characters."
      />
      <PasswordField
        id="confirm"
        name="confirm"
        label="Type it again"
        autoComplete="new-password"
        minLength={8}
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
        {pending ? "Saving..." : "Save new password"}
      </button>
    </form>
  );
}
