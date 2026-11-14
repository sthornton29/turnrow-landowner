"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyDbError } from "@/lib/dbErrors";

// Delete a property. Admins only (the property page renders this for
// admins and nobody else), and only after reading what goes with it and
// typing the property's name.
//
// Deleting a property cascades in the database: its parcels (with their
// tax identifiers and valuation history), ag fields (with their lease
// links), pastures, wetlands, pollinator habitats, timber stands, roads,
// assets, cemeteries, timber activities and costs, timber basis
// accounts, cost-share awards, Timber Scan results, and its FSA farm,
// document, and lease links all go. The page works out the exact lists
// (app/(app)/properties/[id]/page.tsx, from the foreign keys in
// supabase/migrations) and hands them in, so this never says less than
// what will happen.
export default function DeletePropertyButton({
  propertyId,
  propertyName,
  deleted,
  unlinked,
  redirectTo,
}: {
  propertyId: string;
  propertyName: string;
  // Each line is something that is permanently deleted with the property.
  deleted: string[];
  // Kept, but no longer tied to any property.
  unlinked: string[];
  redirectTo: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Typed on a phone: capitals and stray spaces are forgiven, the words
  // are not.
  const tidy = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const nameMatches = tidy(typed) !== "" && tidy(typed) === tidy(propertyName);

  async function remove() {
    if (!nameMatches) return;
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("properties")
      .delete()
      .eq("id", propertyId)
      .select("id");
    if (err || (data ?? []).length === 0) {
      setBusy(false);
      setError(
        err
          ? // A delete refused over a "required value" is a record still
            // linked from somewhere else, not a form with empty fields.
            err.code === "23502"
            ? "Something on this property is still linked to other records, so it could not be deleted. Nothing was removed."
            : friendlyDbError(err, "The property could not be deleted. Nothing was removed.")
          : "The property was not deleted. It may already be gone, or you may not have access to it."
      );
      return;
    }
    router.push(redirectTo);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
      >
        Delete this property...
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-gray-800">
      <h2 className="text-base font-semibold text-red-800">
        Delete {propertyName}?
      </h2>
      <div>
        <p className="font-medium">
          This permanently deletes the property and everything on it:
        </p>
        {deleted.length > 0 ? (
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {deleted.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-gray-600">Nothing else is recorded on it yet.</p>
        )}
      </div>
      {unlinked.length > 0 ? (
        <div>
          <p className="font-medium">
            These are kept, but will no longer belong to any property:
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {unlinked.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="mt-1 text-gray-600">
            Family members who are not admins will stop seeing them, because
            what they can see follows the property.
          </p>
        </div>
      ) : null}
      <p className="text-gray-700">
        Leases, payments, timber sales, tax statements, tax payments, and
        documents themselves are kept. A tax statement that lists a deleted
        parcel will show that line as not matched, and farm software fields
        matched to this property become unmatched.
      </p>
      <p className="font-medium text-red-800">
        This cannot be undone. Move anything you want to keep to another
        property first.
      </p>
      <label className="block">
        <span className="font-medium">
          Type the property{"'"}s name to confirm: {propertyName}
        </span>
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          className="mt-1 w-full max-w-sm rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-red-400 focus:outline-none"
        />
      </label>
      {error ? <p className="text-red-700">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={remove}
          disabled={!nameMatches || busy}
          className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
        >
          {busy ? "Deleting..." : "Delete this property and everything listed"}
        </button>
        <button
          onClick={() => {
            setOpen(false);
            setTyped("");
            setError(null);
          }}
          disabled={busy}
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
        >
          Keep the property
        </button>
      </div>
    </div>
  );
}
