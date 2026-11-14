"use client";

import { useState } from "react";

// A password box with a Show / Hide switch. Most sign-in trouble on a
// phone is a mistyped password nobody could see.
export default function PasswordField({
  id,
  name,
  label,
  autoComplete,
  minLength,
  hint,
}: {
  id: string;
  name: string;
  label: string;
  autoComplete: "current-password" | "new-password";
  minLength?: number;
  hint?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-gray-700">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          minLength={minLength}
          className="w-full rounded-lg border border-gray-300 py-2 pl-3 pr-16 text-base focus:border-kelly-500 focus:outline-none focus:ring-2 focus:ring-kelly-100"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          aria-label={visible ? "Hide password" : "Show password"}
          className="absolute inset-y-0 right-0 flex items-center px-3 text-sm font-medium text-kelly-700 hover:underline"
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
      {hint ? <p className="mt-1 text-xs text-gray-500">{hint}</p> : null}
    </div>
  );
}
