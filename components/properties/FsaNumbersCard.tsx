"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

// FSA farm numbers on a property: the key that lets a scanned 156EZ land
// its farms on the right land. A property can carry several; chips with
// add and remove, saved immediately to properties.fsa_numbers.
export default function FsaNumbersCard({
  propertyId,
  numbers,
}: {
  propertyId: string;
  numbers: string[];
}) {
  const supabase = createClient();
  const router = useRouter();
  const [list, setList] = useState<string[]>(numbers);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: string[]) {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase
      .from("properties")
      .update({ fsa_numbers: next.length > 0 ? next : null })
      .eq("id", propertyId);
    setBusy(false);
    if (err) {
      setError("Could not save. " + err.message);
      return;
    }
    setList(next);
    router.refresh();
  }

  function add() {
    const parts = draft
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    const next = [...new Set([...list, ...parts])];
    setDraft("");
    save(next);
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          FSA farm numbers
        </h2>
        <Link href="/gov-payments" className="text-xs font-medium text-kelly-700 hover:underline">
          Government Payments
        </Link>
      </div>
      <p className="mt-1 text-xs text-gray-500">
        Add every FSA farm number on this land. A scanned FSA-156EZ links its
        farms and base acres to the properties whose numbers match; when a
        farm spans several properties the base acres split pro rata by each
        property{"'"}s ag field acres.
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {list.map((n) => (
          <span
            key={n}
            className="flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700"
          >
            FSA {n}
            <button
              type="button"
              onClick={() => save(list.filter((x) => x !== n))}
              disabled={busy}
              aria-label={`Remove FSA ${n}`}
              className="text-gray-400 hover:text-red-600"
            >
              &times;
            </button>
          </span>
        ))}
        {list.length === 0 ? (
          <span className="text-xs text-gray-400">None yet</span>
        ) : null}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
        className="mt-2 flex gap-2"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          inputMode="numeric"
          placeholder="Farm number (several: 1234, 1235)"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-kelly-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || draft.trim() === ""}
          className="rounded-lg bg-kelly-500 px-3 py-2 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-60"
        >
          Add
        </button>
      </form>
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </section>
  );
}
