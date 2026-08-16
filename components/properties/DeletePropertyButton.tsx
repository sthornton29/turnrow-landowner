"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Delete a property with an accurate confirmation of what goes with it.
// Everything under a property cascades (parcels, fields, timber stands,
// roads, assets) and lease land links are removed; leases, payments, and
// tax statements themselves are never deleted, though tax statements on
// deleted parcels become unmatched. Errors surface instead of silently
// redirecting.
export default function DeletePropertyButton({
  propertyId,
  propertyName,
  cascadeSummary,
  leaseLinkCount,
  redirectTo,
}: {
  propertyId: string;
  propertyName: string;
  cascadeSummary: string; // e.g. "4 parcels, 2 fields, 1 timber stand"
  leaseLinkCount: number;
  redirectTo?: string; // set on the detail page; the list just refreshes
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    const lines = [`Delete "${propertyName}"?`];
    if (cascadeSummary) {
      lines.push(`This also permanently deletes its ${cascadeSummary}.`);
    }
    if (leaseLinkCount > 0) {
      lines.push(
        `Warning: ${leaseLinkCount} lease land link${leaseLinkCount === 1 ? "" : "s"} will be removed (the leases themselves are kept).`
      );
    }
    lines.push("This cannot be undone.");
    if (!window.confirm(lines.join("\n\n"))) return;

    setBusy(true);
    setError(null);
    const { error: err } = await supabase
      .from("properties")
      .delete()
      .eq("id", propertyId);
    setBusy(false);
    if (err) {
      setError("Could not delete: " + err.message);
      return;
    }
    if (redirectTo) router.push(redirectTo);
    else router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={remove}
        disabled={busy}
        className="rounded-lg border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
      >
        {busy ? "Deleting..." : "Delete"}
      </button>
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </span>
  );
}
