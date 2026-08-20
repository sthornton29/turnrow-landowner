"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  DOC_TYPES_BY_GROUP,
  DOC_GROUP_LABELS,
  DOC_TYPE_LABELS,
  canPlotBoundary,
  type DocGroup,
  type DocType,
} from "@/lib/documents";
import type { DocumentEntityType, DocumentRow } from "@/types/db";
import DocTypeChip from "./DocTypeChip";
import ScanDocumentButton from "./ScanDocumentButton";
import {
  classifyFile,
  deleteDocumentEverywhere,
  removeDocumentFromProperty,
  setDocumentProperties,
  uploadDocument,
  largeFileWarning,
  type ClassifySuggestion,
} from "./classify";
import PropertyMultiSelect, { type SelectableProperty } from "./PropertyMultiSelect";

function isImage(doc: DocumentRow): boolean {
  return (doc.content_type ?? "").startsWith("image/");
}

// Grouped <select> of every document type.
export function DocTypeSelect({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (t: DocType) => void;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as DocType)}
      className={
        className ??
        "rounded-lg border border-gray-300 px-2 py-1 text-xs focus:border-kelly-500 focus:outline-none"
      }
    >
      {(Object.keys(DOC_TYPES_BY_GROUP) as DocGroup[]).map((g) => (
        <optgroup key={g} label={DOC_GROUP_LABELS[g]}>
          {DOC_TYPES_BY_GROUP[g].map((t) => (
            <option key={t} value={t}>
              {DOC_TYPE_LABELS[t]}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

// Photos and documents for any entity, stored in the private "documents"
// bucket under <org>/<entity_type>/<uuid>-<filename>. Image files show as a
// gallery; everything else as a typed file list. Uploads get an AI type
// SUGGESTION (amber) that the user accepts or overrides; until then the
// row is saved as "other" so an unreviewed guess never becomes a fact.
export default function EntityDocuments({
  orgId,
  entityType,
  entityId,
}: {
  orgId: string;
  entityType: DocumentEntityType;
  entityId: string;
}) {
  const supabase = createClient();
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  // document id -> every property it is linked to (migration 0023).
  const [linksByDoc, setLinksByDoc] = useState<Record<string, string[]>>({});
  const [allProperties, setAllProperties] = useState<SelectableProperty[]>([]);
  // Upload-time "also attach to other properties" selection (property pages).
  const [alsoProps, setAlsoProps] = useState<string[]>([]);
  const [alsoOpen, setAlsoOpen] = useState(false);
  const [editingProps, setEditingProps] = useState<string | null>(null);
  const [draftProps, setDraftProps] = useState<string[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const isProperty = entityType === "property";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Unconfirmed AI suggestions by document id.
  const [suggestions, setSuggestions] = useState<Record<string, ClassifySuggestion>>({});
  const photoInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("documents")
      .select("*")
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .order("created_at", { ascending: false });
    let rows = (data as DocumentRow[]) ?? [];
    if (isProperty) {
      // Documents linked to this property through document_properties
      // (primary attachment elsewhere), merged and deduped.
      const { data: linkRows } = await supabase
        .from("document_properties")
        .select("document_id")
        .eq("property_id", entityId);
      const ids = (linkRows ?? []).map((l) => l.document_id as string).filter((id) => !rows.some((r) => r.id === id));
      if (ids.length > 0) {
        const { data: more } = await supabase.from("documents").select("*").in("id", ids);
        rows = [...rows, ...((more as DocumentRow[]) ?? [])].sort((a, b) =>
          b.created_at.localeCompare(a.created_at)
        );
      }
      const docIds = rows.map((r) => r.id);
      const [{ data: allLinks }, { data: props }] = await Promise.all([
        docIds.length > 0
          ? supabase.from("document_properties").select("document_id, property_id").in("document_id", docIds)
          : Promise.resolve({ data: [] as Array<{ document_id: string; property_id: string }> }),
        supabase.from("properties").select("id, name, county, state").order("name"),
      ]);
      const byDoc: Record<string, string[]> = {};
      for (const l of (allLinks ?? []) as Array<{ document_id: string; property_id: string }>) {
        byDoc[l.document_id] = [...(byDoc[l.document_id] ?? []), l.property_id];
      }
      for (const r of rows) {
        const set = new Set(byDoc[r.id] ?? []);
        if (r.entity_type === "property") set.add(r.entity_id);
        byDoc[r.id] = [...set];
      }
      setLinksByDoc(byDoc);
      setAllProperties((props as SelectableProperty[]) ?? []);
    }
    setDocs(rows);

    // Signed thumbnails for images (bucket is private)
    const images = rows.filter(isImage);
    if (images.length > 0) {
      const { data: signed } = await supabase.storage
        .from("documents")
        .createSignedUrls(images.map((d) => d.storage_path), 3600);
      const map: Record<string, string> = {};
      signed?.forEach((s, i) => {
        if (s.signedUrl) map[images[i].id] = s.signedUrl;
      });
      setThumbs(map);
    } else {
      setThumbs({});
    }
  }, [supabase, entityType, entityId, isProperty]);

  useEffect(() => {
    load();
  }, [load]);

  async function upload(files: FileList | null, photos: boolean) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    for (const file of Array.from(files)) {
      const big = largeFileWarning(file);
      if (big) setNotice(big);
      // Photos skip classification (they are photos); documents get a
      // suggestion that waits for the user.
      const suggestion = photos ? null : await classifyFile(file);
      const result = await uploadDocument(supabase, {
        orgId,
        entityType,
        entityId,
        file,
        docType: "other",
        title: suggestion?.title ?? null,
        aiSuggestedType: suggestion?.doc_type ?? null,
        propertyIds: isProperty ? alsoProps : [],
      });
      if ("error" in result) {
        setError(result.error);
        continue;
      }
      if (suggestion && suggestion.doc_type !== "other") {
        setSuggestions((s) => ({ ...s, [result.id]: suggestion }));
      }
    }
    setBusy(false);
    if (photoInputRef.current) photoInputRef.current.value = "";
    if (fileInputRef.current) fileInputRef.current.value = "";
    setAlsoProps([]);
    setAlsoOpen(false);
    load();
  }

  async function saveProps(doc: DocumentRow) {
    setError(null);
    if (draftProps.length === 0) {
      setError("Keep at least one property, or delete the document.");
      return;
    }
    const err = await setDocumentProperties(supabase, doc, draftProps);
    if (err) setError("Could not change the properties. " + err);
    setEditingProps(null);
    load();
  }

  async function setType(doc: DocumentRow, t: DocType) {
    setSuggestions((s) => {
      const next = { ...s };
      delete next[doc.id];
      return next;
    });
    const { error: err } = await supabase
      .from("documents")
      .update({ doc_type: t })
      .eq("id", doc.id);
    if (err) setError("Could not change the type. " + err.message);
    load();
  }

  async function open(doc: DocumentRow) {
    const { data } = await supabase.storage
      .from("documents")
      .createSignedUrl(doc.storage_path, 300);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  }

  async function remove(doc: DocumentRow) {
    const linked = linksByDoc[doc.id] ?? [];
    const others = isProperty ? linked.filter((p) => p !== entityId) : [];
    if (others.length > 0) {
      // Linked to other properties too: remove here, or delete for all.
      const choice = window.prompt(
        `${doc.file_name} is also attached to ${others.length} other propert${others.length === 1 ? "y" : "ies"}.\n` +
          `Type REMOVE to take it off this property only, or DELETE to delete the file for all ${linked.length} properties.`,
        "REMOVE"
      );
      if (!choice) return;
      if (choice.trim().toUpperCase() === "DELETE") {
        const err = await deleteDocumentEverywhere(supabase, doc);
        if (err) setError("Could not delete. " + err);
      } else if (choice.trim().toUpperCase() === "REMOVE") {
        const err = await removeDocumentFromProperty(supabase, doc, entityId, linked);
        if (err) setError("Could not remove. " + err);
      } else {
        return;
      }
      load();
      return;
    }
    if (!window.confirm(`Delete ${doc.file_name}?`)) return;
    const err = await deleteDocumentEverywhere(supabase, doc);
    if (err) setError("Could not delete. " + err);
    load();
  }

  const photos = docs.filter(isImage);
  const files = docs.filter((d) => !isImage(d));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => photoInputRef.current?.click()}
          disabled={busy}
          className="rounded-lg bg-kelly-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-kelly-600 disabled:opacity-60"
        >
          {busy ? "Uploading..." : "Add photo"}
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
        >
          Add document
        </button>
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="hidden"
          onChange={(e) => upload(e.target.files, true)}
        />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => upload(e.target.files, false)}
        />
        {busy ? (
          <span className="self-center text-xs text-gray-500">
            Uploading and reading the type...
          </span>
        ) : null}
        {isProperty && allProperties.length > 1 ? (
          <button
            onClick={() => setAlsoOpen((v) => !v)}
            className="self-center text-xs font-medium text-kelly-700 hover:underline"
          >
            {alsoProps.length > 0
              ? `Also attaching to ${alsoProps.length} other propert${alsoProps.length === 1 ? "y" : "ies"}`
              : "Also attach to other properties"}
          </button>
        ) : null}
      </div>
      {isProperty && alsoOpen ? (
        <div className="max-w-md rounded-lg border border-gray-200 bg-gray-50 p-2">
          <p className="mb-1 text-xs text-gray-600">
            The next upload attaches to this property and every property checked here.
          </p>
          <PropertyMultiSelect
            properties={allProperties.filter((p) => p.id !== entityId)}
            selected={alsoProps}
            onChange={setAlsoProps}
            compact
          />
        </div>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {notice ? <p className="text-xs text-amber-800">{notice}</p> : null}

      {photos.length > 0 ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
          {photos.map((doc) => (
            <div key={doc.id} className="group relative">
              <button onClick={() => open(doc)} className="block w-full">
                {thumbs[doc.id] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={thumbs[doc.id]}
                    alt={doc.file_name}
                    className="aspect-square w-full rounded-lg object-cover"
                  />
                ) : (
                  <div className="aspect-square w-full rounded-lg bg-gray-100" />
                )}
              </button>
              <button
                onClick={() => remove(doc)}
                aria-label="Delete photo"
                className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition group-hover:opacity-100"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {files.length > 0 ? (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
          {files.map((doc) => {
            const suggestion = suggestions[doc.id];
            const docType = (doc.doc_type ?? "other") as DocType;
            return (
              <li key={doc.id} className="space-y-1.5 px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <DocTypeChip docType={docType} />
                    <button
                      onClick={() => open(doc)}
                      className="truncate text-left text-sm font-medium text-kelly-700 hover:underline"
                    >
                      {doc.title || doc.file_name}
                    </button>
                    {doc.title && doc.title !== doc.file_name ? (
                      <span className="truncate text-xs text-gray-400">{doc.file_name}</span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <DocTypeSelect value={docType} onChange={(t) => setType(doc, t)} />
                    <button
                      onClick={() => remove(doc)}
                      className="shrink-0 text-xs font-medium text-red-600 hover:underline"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                {suggestion ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5">
                    <DocTypeChip docType={suggestion.doc_type} suggested />
                    <span className="text-xs text-amber-900">
                      AI suggests this type{suggestion.reason ? `: ${suggestion.reason}` : ""}.
                      Confirm, or pick another with the type menu.
                    </span>
                    <button
                      onClick={() => setType(doc, suggestion.doc_type)}
                      className="rounded bg-kelly-500 px-2 py-0.5 text-xs font-semibold text-white hover:bg-kelly-600"
                    >
                      Accept
                    </button>
                  </div>
                ) : null}
                {isProperty && (linksByDoc[doc.id]?.length ?? 0) > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    {(linksByDoc[doc.id] ?? []).map((pid) => (
                      <Link
                        key={pid}
                        href={`/properties/${pid}`}
                        className={
                          "rounded-full px-2 py-0.5 font-medium " +
                          (pid === entityId
                            ? "bg-kelly-100 text-pine-900"
                            : "bg-gray-100 text-gray-700 hover:bg-gray-200")
                        }
                      >
                        {allProperties.find((p) => p.id === pid)?.name ?? "Property"}
                      </Link>
                    ))}
                    <button
                      onClick={() => {
                        if (editingProps === doc.id) {
                          setEditingProps(null);
                        } else {
                          setDraftProps(linksByDoc[doc.id] ?? []);
                          setEditingProps(doc.id);
                        }
                      }}
                      className="font-medium text-kelly-700 hover:underline"
                    >
                      {editingProps === doc.id ? "Close" : "Edit properties"}
                    </button>
                  </div>
                ) : null}
                {editingProps === doc.id ? (
                  <div className="max-w-md space-y-1.5 rounded-lg border border-gray-200 bg-gray-50 p-2">
                    <PropertyMultiSelect
                      properties={allProperties}
                      selected={draftProps}
                      onChange={setDraftProps}
                      compact
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => saveProps(doc)}
                        className="rounded bg-kelly-500 px-2.5 py-1 text-xs font-semibold text-white hover:bg-kelly-600"
                      >
                        Save properties
                      </button>
                      <button
                        onClick={() => setEditingProps(null)}
                        className="rounded border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-white"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center gap-3">
                  <ScanDocumentButton doc={doc} onChanged={load} compact />
                  {canPlotBoundary(docType) ? (
                    <Link
                      href={`/documents/${doc.id}/plot`}
                      className="text-xs font-medium text-kelly-700 hover:underline"
                    >
                      Plot boundary from this document
                    </Link>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {photos.length === 0 && files.length === 0 ? (
        <p className="text-sm text-gray-500">No photos or documents yet.</p>
      ) : null}
    </div>
  );
}
