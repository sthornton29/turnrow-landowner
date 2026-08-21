"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { displayTitle } from "@/lib/documentTitle";
import type { DocumentRow } from "@/types/db";
import DocTypeChip from "./DocTypeChip";
import DocTypeIcon from "./DocTypeIcon";
import { renameDocument } from "./classify";

// One calm row: the whole card is a single link to the document page.
// The only other control is the pencil (inline rename), which sits
// outside the link so a tap on it never navigates.
export default function DocumentCard({
  doc,
  propertyNames,
  attachedLabel,
  onRenamed,
}: {
  doc: DocumentRow;
  propertyNames: string[];
  // A non-property primary attachment ("Lease 2024 row crop", "Entity Smith Farms LLC").
  attachedLabel?: string | null;
  onRenamed?: (title: string) => void;
}) {
  const supabase = createClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [title, setTitle] = useState(displayTitle(doc));
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTitle(displayTitle(doc));
  }, [doc]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function startEdit(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDraft(title);
    setError(null);
    setEditing(true);
  }

  async function save() {
    const t = draft.trim();
    if (!t || t === title) {
      setEditing(false);
      return;
    }
    const err = await renameDocument(supabase, doc.id, t);
    if (err) {
      setError(err);
      return;
    }
    setTitle(t);
    setEditing(false);
    onRenamed?.(t);
  }

  const unfiled = doc.entity_type === "organization" && propertyNames.length === 0;
  const shown = propertyNames.slice(0, 2);
  const more = propertyNames.length - shown.length;

  const body = (
    <>
      <DocTypeIcon docType={doc.doc_type} />
      <div className="min-w-0 flex-1 space-y-1">
        {editing ? (
          <div onClick={(e) => e.preventDefault()}>
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  save();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setEditing(false);
                }
              }}
              onBlur={save}
              aria-label="Document title"
              className="w-full rounded-lg border border-kelly-500 px-2 py-1 text-sm font-medium text-gray-900 focus:outline-none"
            />
            {error ? <p className="mt-0.5 text-xs text-red-600">{error}</p> : null}
          </div>
        ) : (
          <p className="truncate text-sm font-medium text-gray-900">{title}</p>
        )}
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
          <DocTypeChip docType={doc.doc_type} />
          {shown.map((name) => (
            <span key={name} className="rounded-full bg-kelly-50 px-2 py-0.5 font-medium text-pine-900">
              {name}
            </span>
          ))}
          {more > 0 ? <span className="rounded-full bg-kelly-50 px-2 py-0.5 font-medium text-pine-900">+{more}</span> : null}
          {attachedLabel ? <span className="truncate">{attachedLabel}</span> : null}
          {unfiled ? <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-900">Unfiled</span> : null}
          <span className="ml-auto whitespace-nowrap">{new Date(doc.created_at).toLocaleDateString()}</span>
        </div>
      </div>
    </>
  );

  return (
    <li className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white px-3 py-3 hover:border-kelly-500/60">
      {editing ? (
        <div className="flex min-w-0 flex-1 items-start gap-3">{body}</div>
      ) : (
        <Link href={`/documents/${doc.id}`} className="flex min-w-0 flex-1 items-start gap-3">
          {body}
        </Link>
      )}
      <button
        type="button"
        onClick={startEdit}
        aria-label="Rename"
        title="Rename"
        className="shrink-0 rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <path d="M4 20l4-1 11-11-3-3L5 16z" />
          <path d="M13 7l3 3" />
        </svg>
      </button>
    </li>
  );
}
