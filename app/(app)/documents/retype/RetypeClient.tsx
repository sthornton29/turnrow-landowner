"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { DocType } from "@/lib/documents";
import { displayTitle } from "@/lib/documentTitle";
import type { DocumentRow } from "@/types/db";
import DocTypeChip from "@/components/documents/DocTypeChip";
import { DocTypeSelect } from "@/components/documents/DocTypeSelect";
import { classifyStored } from "@/components/documents/classify";

const ENTITY_LABEL: Record<string, string> = {
  property: "Property",
  parcel: "Parcel",
  field: "Ag field",
  pasture: "Pasture",
  wetland: "Wetland",
  timber_stand: "Timber stand",
  road: "Road",
  easement: "Easement",
  asset: "Asset",
  lease: "Lease",
  timber_sale: "Timber sale",
  tax_statement: "Tax statement",
  tenant: "Tenant",
  entity: "Entity",
};

export default function RetypeClient({ docs }: { docs: DocumentRow[] }) {
  const supabase = createClient();
  const router = useRouter();
  // Chosen type per document; starts from the stored AI suggestion.
  const [choice, setChoice] = useState<Record<string, DocType>>(() => {
    const c: Record<string, DocType> = {};
    for (const d of docs) {
      c[d.id] = (d.ai_suggested_type as DocType | null) ?? "other";
    }
    return c;
  });
  const [suggested, setSuggested] = useState<Record<string, { type: DocType; reason: string | null }>>(() => {
    const s: Record<string, { type: DocType; reason: string | null }> = {};
    for (const d of docs) {
      if (d.ai_suggested_type && d.ai_suggested_type !== "other") {
        s[d.id] = { type: d.ai_suggested_type as DocType, reason: null };
      }
    }
    return s;
  });
  const [progress, setProgress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function classifyAll() {
    setBusy(true);
    setError(null);
    const pending = docs.filter((d) => !suggested[d.id]);
    let i = 0;
    for (const d of pending) {
      i++;
      setProgress(`Reading ${i} of ${pending.length}: ${d.file_name}`);
      try {
        const s = await classifyStored(d);
        if (s && s.doc_type !== "other") {
          setSuggested((m) => ({ ...m, [d.id]: { type: s.doc_type, reason: s.reason } }));
          setChoice((c) => (c[d.id] === "other" ? { ...c, [d.id]: s.doc_type } : c));
          // Remember the suggestion on the row (still typed other until applied).
          await supabase.from("documents").update({ ai_suggested_type: s.doc_type }).eq("id", d.id);
        }
      } catch {
        // Skip unreadable files; the user can still pick a type by hand.
      }
    }
    setProgress(null);
    setBusy(false);
  }

  async function apply() {
    setBusy(true);
    setError(null);
    const updates = docs.filter((d) => choice[d.id] && choice[d.id] !== "other");
    for (const d of updates) {
      const { error: err } = await supabase
        .from("documents")
        .update({ doc_type: choice[d.id] })
        .eq("id", d.id);
      if (err) setError("Some updates failed: " + err.message);
    }
    setBusy(false);
    router.refresh();
  }

  const toApply = docs.filter((d) => choice[d.id] && choice[d.id] !== "other").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Type your documents</h1>
          <p className="text-sm text-gray-500">
            {docs.length} document{docs.length === 1 ? "" : "s"} still typed Other. Let the
            AI suggest types, check each one, then Apply. Nothing changes until you apply.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={classifyAll}
            disabled={busy || docs.length === 0}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            Classify all
          </button>
          <button
            onClick={apply}
            disabled={busy || toApply === 0}
            className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-60"
          >
            Apply {toApply > 0 ? `(${toApply})` : ""}
          </button>
        </div>
      </div>
      {progress ? <p className="text-xs text-gray-600">{progress}</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {docs.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
          Everything is typed.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
          {docs.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-4 py-2.5">
              <div className="min-w-0">
                <Link
                  href={`/documents/${d.id}`}
                  className="truncate text-left text-sm font-medium text-kelly-700 hover:underline"
                >
                  {displayTitle(d)}
                </Link>
                <p className="text-xs text-gray-500">
                  {ENTITY_LABEL[d.entity_type] ?? d.entity_type} · {new Date(d.created_at).toLocaleDateString()}
                  {suggested[d.id] ? (
                    <span className="ml-2 inline-flex items-center gap-1">
                      <DocTypeChip docType={suggested[d.id].type} suggested />
                      {suggested[d.id].reason ? <span className="text-amber-800">{suggested[d.id].reason}</span> : null}
                    </span>
                  ) : null}
                </p>
              </div>
              <DocTypeSelect
                value={choice[d.id] ?? "other"}
                onChange={(t) => setChoice((c) => ({ ...c, [d.id]: t }))}
                className={
                  "rounded-lg border px-2 py-1.5 text-sm focus:outline-none " +
                  (choice[d.id] && choice[d.id] !== "other" ? "border-kelly-500 bg-kelly-50" : "border-gray-300")
                }
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
