"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { STARTER_QUESTIONS } from "./AssistantChat";

// Dashboard entry point for the data assistant: one question box that
// hands off to /ask with the question in the URL.
export default function AskEntryCard() {
  const router = useRouter();
  const [q, setQ] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim()) router.push(`/ask?q=${encodeURIComponent(q.trim())}`);
      }}
      className="rounded-xl border border-kelly-100 bg-white p-4"
    >
      <p className="font-medium text-gray-900">Ask about your land</p>
      <p className="mt-0.5 text-sm text-gray-500">
        Acres, leases, taxes, timber, easements, payments: answered from your
        records.
      </p>
      <div className="mt-2 flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={STARTER_QUESTIONS[0]}
          className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-kelly-500 focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-lg bg-kelly-500 px-3 py-2 text-sm font-semibold text-white hover:bg-kelly-600"
        >
          Ask
        </button>
      </div>
    </form>
  );
}
