"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// "Also called": the historical names a family uses for a tract ("View
// Celeste", "the Martin homeplace") that deeds print and the property
// record does not. Fed to the document reader's matching context
// (property_aliases, migration 0029). Small, inline, one tap to remove.
export default function PropertyAliases({
  orgId,
  propertyId,
  aliases,
}: {
  orgId: string;
  propertyId: string;
  aliases: Array<{ id: string; alias: string }>;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    const alias = draft.trim();
    if (!alias) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase
      .from("property_aliases")
      .insert({ organization_id: orgId, property_id: propertyId, alias });
    setBusy(false);
    if (err) {
      setError(err.message.includes("duplicate") ? "Already recorded." : err.message);
      return;
    }
    setDraft("");
    router.refresh();
  }

  async function remove(id: string) {
    await supabase.from("property_aliases").delete().eq("id", id);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-gray-500">Also called:</span>
      {aliases.map((a) => (
        <span key={a.id} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-700">
          {a.alias}
          <button
            type="button"
            onClick={() => remove(a.id)}
            aria-label={`Remove ${a.alias}`}
            className="text-gray-400 hover:text-gray-700"
          >
            x
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
        placeholder="Add a name deeds use"
        disabled={busy}
        className="w-44 rounded border border-gray-300 px-2 py-0.5 text-xs focus:border-kelly-500 focus:outline-none"
      />
      {error ? <span className="text-red-600">{error}</span> : null}
    </div>
  );
}
