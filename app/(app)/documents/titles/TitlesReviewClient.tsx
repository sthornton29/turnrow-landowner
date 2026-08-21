"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { displayTitle, proposeTitle } from "@/lib/documentTitle";
import type { DocType } from "@/lib/documents";
import type { DocumentRow } from "@/types/db";
import DocTypeChip from "@/components/documents/DocTypeChip";
import { renameDocument } from "@/components/documents/classify";

const inputClass =
  "w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:border-kelly-500 focus:outline-none";

// Keyboard-first bulk review: Tab between inputs, Enter saves the row
// and moves down, Escape puts the proposal back. Apply saves every row.
export default function TitlesReviewClient({
  docs,
  firstProperty,
}: {
  docs: DocumentRow[];
  firstProperty: Record<string, string>;
}) {
  const supabase = createClient();
  const proposals = useMemo(() => {
    const p: Record<string, string> = {};
    for (const d of docs) {
      p[d.id] = proposeTitle((d.doc_type ?? "other") as DocType, d.extracted, d.file_name, {
        uploadedAt: d.created_at,
        propertyName: firstProperty[d.id] ?? null,
      });
    }
    return p;
  }, [docs, firstProperty]);
  const [drafts, setDrafts] = useState<Record<string, string>>(() => ({ ...proposals }));
  const [done, setDone] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  const pending = docs.filter((d) => !done[d.id]);

  async function saveOne(d: DocumentRow, title: string): Promise<boolean> {
    const err = await renameDocument(supabase, d.id, title);
    if (err) {
      setErrors((e) => ({ ...e, [d.id]: err }));
      return false;
    }
    setErrors((e) => {
      const n = { ...e };
      delete n[d.id];
      return n;
    });
    setDone((x) => ({ ...x, [d.id]: title }));
    return true;
  }

  async function saveAndNext(d: DocumentRow, index: number) {
    const ok = await saveOne(d, drafts[d.id] ?? "");
    if (!ok) return;
    const next = inputs.current.slice(index + 1).find((el) => el && !el.disabled);
    next?.focus();
    next?.select();
  }

  async function applyAll() {
    setBusy(true);
    let i = 0;
    for (const d of pending) {
      i++;
      setProgress(`Saving ${i} of ${pending.length}`);
      await saveOne(d, drafts[d.id] ?? "");
    }
    setProgress(null);
    setBusy(false);
  }

  if (docs.length === 0 || pending.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
        <p className="text-sm font-medium text-gray-900">All titles reviewed</p>
        <p className="mt-1 text-xs text-gray-500">
          Every document now shows a title.{" "}
          <Link href="/documents" className="font-medium text-kelly-700 hover:underline">Back to Documents</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Review document titles</h1>
          <p className="text-sm text-gray-500">
            Documents now show a title instead of a file name; here is a proposed title for each older document, built
            from what was read out of it. Edit any, press Enter to save and move down, or apply them all.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setDrafts({ ...proposals })}
            disabled={busy}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            Use proposed for all
          </button>
          <button
            type="button"
            onClick={applyAll}
            disabled={busy}
            className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-60"
          >
            {progress ?? `Apply ${pending.length}`}
          </button>
        </div>
      </div>

      <ul className="space-y-2">
        {docs.map((d, i) => {
          const saved = done[d.id];
          return (
            <li
              key={d.id}
              className={
                "rounded-xl border bg-white px-3 py-3 " + (saved ? "border-kelly-100 opacity-70" : "border-gray-200")
              }
            >
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                <DocTypeChip docType={d.doc_type} />
                <span className="truncate">
                  Current: <span className="font-medium text-gray-800">{saved ?? displayTitle(d)}</span>
                </span>
                <span className="ml-auto truncate text-[11px] text-gray-400" title={d.file_name}>{d.file_name}</span>
              </div>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  ref={(el) => {
                    inputs.current[i] = el;
                  }}
                  value={saved ?? drafts[d.id] ?? ""}
                  disabled={Boolean(saved) || busy}
                  onChange={(e) => setDrafts((x) => ({ ...x, [d.id]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      saveAndNext(d, i);
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setDrafts((x) => ({ ...x, [d.id]: proposals[d.id] }));
                    }
                  }}
                  aria-label={`Title for ${displayTitle(d)}`}
                  className={inputClass + " sm:flex-1"}
                />
                {saved ? (
                  <span className="text-xs font-medium text-pine-900">Saved</span>
                ) : (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => saveAndNext(d, i)}
                      disabled={busy}
                      className="rounded-lg bg-kelly-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-kelly-600 disabled:opacity-60"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => saveOne(d, displayTitle(d))}
                      disabled={busy}
                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                      title="Keep the current title as is"
                    >
                      Keep current
                    </button>
                  </div>
                )}
              </div>
              {errors[d.id] ? <p className="mt-1 text-xs text-red-600">{errors[d.id]}</p> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
