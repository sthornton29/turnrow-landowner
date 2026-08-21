"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  DOC_TYPE_LABELS,
  canPlotBoundary,
  extractedHighlights,
  scanKindFor,
  type DocType,
  type ScanKind,
} from "@/lib/documents";
import { displayTitle } from "@/lib/documentTitle";
import type { DocumentRow, DocumentVersionRow } from "@/types/db";
import { ActionLink, RelatedSection, SummaryHeader } from "@/components/summary/Summary";
import DocumentPreview from "@/components/documents/DocumentPreview";
import DocTypeChip from "@/components/documents/DocTypeChip";
import { DocTypeSelect } from "@/components/documents/DocTypeSelect";
import PropertyMultiSelect, { type SelectableProperty } from "@/components/documents/PropertyMultiSelect";
import ScanDocumentButton from "@/components/documents/ScanDocumentButton";
import DocumentReview from "@/components/documents/DocumentReview";
import { SpatialEvidenceBlock } from "@/components/documents/intake/ConfirmScreen";
import type { SpatialEvidence } from "@/lib/documentMatch";
import {
  deleteDocumentEverywhere,
  openDocument,
  renameDocument,
  replaceDocumentFile,
  setDocumentProperties,
} from "@/components/documents/classify";

export interface PrimaryAttachment {
  label: string;
  href: string;
}

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-kelly-500 focus:outline-none";
const linkBtn = "text-xs font-medium text-kelly-700 hover:underline disabled:opacity-60";

function formatSize(bytes: number | null | undefined): string {
  if (!bytes) return "";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function DocumentPageClient({
  doc,
  links,
  versions,
  properties,
  uploadedBy,
  primary,
  fsaFarm,
}: {
  doc: DocumentRow;
  links: Array<{ property_id: string; evidence: string | null }>;
  versions: DocumentVersionRow[];
  properties: SelectableProperty[];
  uploadedBy: string | null;
  primary: PrimaryAttachment | null;
  fsaFarm: { id: string; farmNumber: string } | null;
  orgId: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const docType = (doc.doc_type ?? "other") as DocType;
  const title = displayTitle(doc);
  const [error, setError] = useState<string | null>(null);

  // ---- title
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(title);
  async function saveTitle() {
    const err = await renameDocument(supabase, doc.id, titleDraft);
    if (err) {
      setError(err);
      return;
    }
    setEditingTitle(false);
    router.refresh();
  }

  // ---- type (a change offers a rescan with the new type's schema)
  const [rescanOffer, setRescanOffer] = useState<DocType | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [review, setReview] = useState<{ kind: ScanKind; extraction: Record<string, unknown> } | null>(null);
  async function changeType(t: DocType) {
    if (t === docType) return;
    const { error: err } = await supabase.from("documents").update({ doc_type: t }).eq("id", doc.id);
    if (err) {
      setError("Could not change the type. " + err.message);
      return;
    }
    setRescanOffer(scanKindFor(t) ? t : null);
    router.refresh();
  }
  async function rescanAs(t: DocType) {
    const kind = scanKindFor(t);
    if (!kind) return;
    setScanBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("storage_path", doc.storage_path);
      fd.append("file_name", doc.file_name);
      fd.append("content_type", doc.content_type ?? "application/pdf");
      fd.append("kind", kind);
      const res = await fetch("/api/extract", { method: "POST", body: fd });
      const body = (await res.json()) as { extraction?: Record<string, unknown>; error?: string };
      if (!res.ok || !body.extraction) throw new Error(body.error ?? "Extraction failed.");
      setReview({ kind, extraction: body.extraction });
      setRescanOffer(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extraction failed.");
    } finally {
      setScanBusy(false);
    }
  }

  // ---- properties
  const linkedIds = useMemo(() => {
    const ids = new Set(links.map((l) => l.property_id));
    if (doc.entity_type === "property") ids.add(doc.entity_id);
    return [...ids];
  }, [links, doc]);
  const evidenceFor = (pid: string) => links.find((l) => l.property_id === pid)?.evidence ?? null;

  // Spatial evidence saved with the document, re-runnable without a
  // model call (/api/spatial-match merges into documents.extracted).
  const spatial = ((doc.extracted ?? {}) as { spatial?: SpatialEvidence | null }).spatial ?? null;
  const [rechecking, setRechecking] = useState(false);
  const [recheckError, setRecheckError] = useState<string | null>(null);
  async function recheckDescription() {
    setRechecking(true);
    setRecheckError(null);
    try {
      const res = await fetch("/api/spatial-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extraction: doc.extracted ?? {} }),
      });
      const body = (await res.json().catch(() => ({}))) as { spatial?: SpatialEvidence; error?: string };
      if (!res.ok || !body.spatial) throw new Error(body.error ?? "The check did not finish.");
      const { error } = await supabase
        .from("documents")
        .update({ extracted: { ...(doc.extracted ?? {}), spatial: body.spatial } })
        .eq("id", doc.id);
      if (error) throw new Error(error.message);
      router.refresh();
    } catch (e) {
      setRecheckError(e instanceof Error ? e.message : "The check did not finish.");
    } finally {
      setRechecking(false);
    }
  }
  const [editingProps, setEditingProps] = useState(false);
  const [draftProps, setDraftProps] = useState<string[]>(linkedIds);
  async function saveProps() {
    const err = await setDocumentProperties(supabase, doc, draftProps);
    if (err) {
      setError(err);
      return;
    }
    setEditingProps(false);
    router.refresh();
  }

  // ---- notes
  const [notes, setNotes] = useState(doc.notes ?? "");
  const [notesDirty, setNotesDirty] = useState(false);
  async function saveNotes() {
    const { error: err } = await supabase
      .from("documents")
      .update({ notes: notes.trim() || null })
      .eq("id", doc.id);
    if (err) {
      setError("Could not save notes. " + err.message);
      return;
    }
    setNotesDirty(false);
    router.refresh();
  }

  // ---- utilities
  const replaceRef = useRef<HTMLInputElement>(null);
  const [replacing, setReplacing] = useState(false);
  async function replaceFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setReplacing(true);
    setError(null);
    const err = await replaceDocumentFile(supabase, doc, file);
    setReplacing(false);
    if (replaceRef.current) replaceRef.current.value = "";
    if (err) {
      setError(err);
      return;
    }
    router.refresh();
  }
  async function remove() {
    const where = linkedIds.length > 1 ? ` It is attached to ${linkedIds.length} properties; this removes it everywhere.` : "";
    if (!window.confirm(`Delete ${title}?${where} This cannot be undone.`)) return;
    const err = await deleteDocumentEverywhere(supabase, doc);
    if (err) {
      setError("Could not delete. " + err);
      return;
    }
    router.push("/documents");
    router.refresh();
  }
  async function downloadVersion(path: string) {
    await openDocument(supabase, path);
  }

  const highlights = extractedHighlights(docType, (doc.extracted ?? null) as Record<string, unknown> | null);
  const extractionDates = (doc.extraction_history ?? []).map((h) => h.at);
  if (extractionDates.length === 0 && doc.extracted_at) extractionDates.push(doc.extracted_at);
  const nameOf = (id: string) => properties.find((p) => p.id === id)?.name ?? "Property";

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <SummaryHeader
        typeLabel={DOC_TYPE_LABELS[docType]}
        name={title}
        keyFigure={highlights[0] ?? null}
        breadcrumb={[
          { href: "/documents", label: "Documents" },
          { href: `/documents/${doc.id}`, label: title },
        ]}
        actions={
          <>
            {canPlotBoundary(docType) ? (
              <ActionLink href={`/documents/${doc.id}/plot`} primary>
                Plot boundary
              </ActionLink>
            ) : null}
            {docType === "fsa_156ez" ? (
              <ActionLink href="/gov-payments">{fsaFarm ? `View FSA farm ${fsaFarm.farmNumber}` : "View FSA farms"}</ActionLink>
            ) : null}
            {doc.linked_easement_id ? (
              <ActionLink href={`/easements/${doc.linked_easement_id}`}>View easement</ActionLink>
            ) : null}
            {doc.produced_boundary_type && doc.produced_boundary_id ? (
              <ActionLink href={`/map?focus=${doc.produced_boundary_type}:${doc.produced_boundary_id}`}>
                View boundary
              </ActionLink>
            ) : null}
          </>
        }
      />

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="md:sticky md:top-4 md:self-start">
          <DocumentPreview storagePath={doc.storage_path} fileName={doc.file_name} contentType={doc.content_type} />
        </div>

        <div className="space-y-4">
          {/* Title */}
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-500">Title</h2>
            {editingTitle ? (
              <div className="flex gap-2">
                <input
                  autoFocus
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveTitle();
                    if (e.key === "Escape") {
                      setTitleDraft(title);
                      setEditingTitle(false);
                    }
                  }}
                  className={inputClass}
                />
                <button
                  onClick={saveTitle}
                  className="rounded-lg bg-kelly-500 px-3 py-2 text-sm font-semibold text-white hover:bg-kelly-600"
                >
                  Save
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 text-sm font-medium text-gray-900">{title}</p>
                <button
                  onClick={() => {
                    setTitleDraft(title);
                    setEditingTitle(true);
                  }}
                  aria-label="Rename"
                  title="Rename"
                  className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                >
                  <PencilIcon />
                </button>
              </div>
            )}
          </section>

          {/* Type */}
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-500">Type</h2>
            <div className="flex flex-wrap items-center gap-2">
              <DocTypeChip docType={docType} />
              <DocTypeSelect value={docType} onChange={changeType} />
            </div>
            {rescanOffer ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <span>Rescan as {DOC_TYPE_LABELS[rescanOffer].toLowerCase()}? The fields for that type will be read and shown for review.</span>
                <button
                  onClick={() => rescanAs(rescanOffer)}
                  disabled={scanBusy}
                  className="rounded-lg bg-amber-600 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
                >
                  {scanBusy ? "Reading..." : "Rescan"}
                </button>
                <button onClick={() => setRescanOffer(null)} className="text-xs font-medium text-amber-900 hover:underline">
                  Not now
                </button>
              </div>
            ) : null}
            {review ? (
              <div className="mt-3">
                <DocumentReview
                  documentId={doc.id}
                  scanKind={review.kind}
                  extraction={review.extraction}
                  onSaved={() => {
                    setReview(null);
                    router.refresh();
                  }}
                  onCancel={() => setReview(null)}
                />
              </div>
            ) : null}
          </section>

          {/* Attached to */}
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Attached to</h2>
              <button
                onClick={() => {
                  setDraftProps(linkedIds);
                  setEditingProps((v) => !v);
                }}
                className={linkBtn}
              >
                {editingProps ? "Close" : "Edit properties"}
              </button>
            </div>
            {primary ? (
              <p className="text-sm">
                <Link href={primary.href} className="font-medium text-kelly-700 hover:underline">
                  {primary.label}
                </Link>
              </p>
            ) : null}
            {linkedIds.length === 0 && !primary ? (
              <p className="text-sm text-gray-500">Unfiled. Not yet assigned to a property.</p>
            ) : null}
            {linkedIds.length > 0 ? (
              <ul className="mt-1 space-y-1">
                {linkedIds.map((pid) => (
                  <li key={pid} className="text-sm">
                    <Link
                      href={`/properties/${pid}`}
                      className="rounded-full bg-kelly-50 px-2 py-0.5 text-xs font-medium text-pine-900 hover:bg-kelly-100"
                    >
                      {nameOf(pid)}
                    </Link>
                    {evidenceFor(pid) ? (
                      <span className="ml-2 text-xs text-gray-500">{evidenceFor(pid)}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {editingProps ? (
              <div className="mt-2 space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-2">
                <PropertyMultiSelect properties={properties} selected={draftProps} onChange={setDraftProps} compact />
                <div className="flex gap-2">
                  <button
                    onClick={saveProps}
                    className="rounded bg-kelly-500 px-2.5 py-1 text-xs font-semibold text-white hover:bg-kelly-600"
                  >
                    Save properties
                  </button>
                  <button
                    onClick={() => setEditingProps(false)}
                    className="rounded border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-white"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
          </section>

          {/* Evidence from the description (the intake's spatial tier) */}
          {spatial ? (
            <section className="space-y-2">
              <SpatialEvidenceBlock spatial={spatial} properties={properties} conflict={false} compact />
              <div className="flex items-center gap-3">
                <button type="button" onClick={recheckDescription} disabled={rechecking} className={linkBtn}>
                  {rechecking ? "Checking..." : "Check the description again"}
                </button>
                {recheckError ? <span className="text-xs text-red-600">{recheckError}</span> : null}
              </div>
            </section>
          ) : null}

          {/* Extracted fields */}
          {scanKindFor(docType) || doc.extracted ? (
            <section className="rounded-xl border border-gray-200 bg-white p-4">
              <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-500">What was read</h2>
              {!doc.extracted ? (
                <p className="mb-2 text-sm text-gray-500">Nothing read yet. Scan to pull this type's key fields for review.</p>
              ) : null}
              <ScanDocumentButton doc={doc} onChanged={() => router.refresh()} />
            </section>
          ) : null}

          {/* Notes */}
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-500">Notes</h2>
            <textarea
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                setNotesDirty(true);
              }}
              rows={3}
              placeholder="Anything worth remembering about this document"
              className={inputClass}
            />
            {notesDirty ? (
              <button
                onClick={saveNotes}
                className="mt-2 rounded-lg bg-kelly-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-kelly-600"
              >
                Save notes
              </button>
            ) : null}
          </section>

          {/* Utilities */}
          <section className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm">
            <button onClick={() => openDocument(supabase, doc.storage_path)} className="font-medium text-gray-800 hover:underline">
              Download
            </button>
            <button onClick={() => replaceRef.current?.click()} disabled={replacing} className="font-medium text-gray-800 hover:underline disabled:opacity-60">
              {replacing ? "Replacing..." : "Replace file"}
            </button>
            <input ref={replaceRef} type="file" className="hidden" onChange={(e) => replaceFile(e.target.files)} />
            <button onClick={remove} className="ml-auto font-medium text-red-600 hover:underline">
              Delete
            </button>
          </section>

          {versions.length > 0 ? (
            <RelatedSection title="Previous versions" subtitle={`${versions.length}`}>
              <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
                {versions.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate text-gray-800">{v.file_name}</span>
                    <span className="text-xs text-gray-500">
                      {formatSize(v.size_bytes)} · replaced {new Date(v.replaced_at).toLocaleDateString()}
                    </span>
                    <button onClick={() => downloadVersion(v.storage_path)} className={linkBtn}>
                      Download
                    </button>
                  </li>
                ))}
              </ul>
            </RelatedSection>
          ) : null}

          <footer className="space-y-0.5 px-1 text-xs text-gray-500">
            <p>
              Uploaded {uploadedBy ? `by ${uploadedBy} ` : ""}on {new Date(doc.created_at).toLocaleDateString()}
            </p>
            <p>
              Original file: {doc.file_name}
              {doc.size_bytes ? ` (${formatSize(doc.size_bytes)})` : ""}
            </p>
            {extractionDates.length > 0 ? (
              <p>Read on {extractionDates.map((d) => new Date(d).toLocaleDateString()).join(", ")}</p>
            ) : null}
          </footer>
        </div>
      </div>
    </div>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z"
      />
    </svg>
  );
}
