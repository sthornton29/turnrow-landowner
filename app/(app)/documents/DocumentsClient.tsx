"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  DOC_GROUP_LABELS,
  DOC_TYPES_BY_GROUP,
  DOC_TYPE_GROUP,
  DOC_TYPE_LABELS,
  canPlotBoundary,
  extractedHighlights,
  type DocGroup,
  type DocType,
} from "@/lib/documents";
import type { DocumentEntityType, DocumentRow } from "@/types/db";
import DocTypeChip from "@/components/documents/DocTypeChip";
import ScanDocumentButton from "@/components/documents/ScanDocumentButton";
import { DocTypeSelect } from "@/components/documents/EntityDocuments";
import {
  classifyFile,
  openDocument,
  uploadDocument,
  type ClassifySuggestion,
} from "@/components/documents/classify";

export interface AttachTarget {
  entityType: DocumentEntityType;
  id: string;
  label: string;
  href: string;
  propertyId: string | null;
}

const ATTACH_TYPES: Array<{ key: DocumentEntityType; label: string }> = [
  { key: "property", label: "Property" },
  { key: "parcel", label: "Parcel" },
  { key: "field", label: "Ag field" },
  { key: "timber_stand", label: "Timber stand" },
  { key: "easement", label: "Easement" },
  { key: "asset", label: "Asset" },
  { key: "lease", label: "Lease" },
  { key: "timber_sale", label: "Timber sale" },
  { key: "entity", label: "Entity" },
];

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-kelly-500 focus:outline-none";

export default function DocumentsClient({
  orgId,
  docs,
  targets,
  properties,
  entities,
}: {
  orgId: string;
  docs: DocumentRow[];
  targets: AttachTarget[];
  properties: Array<{ id: string; name: string; entityId: string | null }>;
  entities: Array<{ id: string; name: string }>;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [propertyFilter, setPropertyFilter] = useState("");
  const [entityFilter, setEntityFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [uploadOpen, setUploadOpen] = useState(false);

  const targetByKey = useMemo(() => {
    const m = new Map<string, AttachTarget>();
    for (const t of targets) m.set(`${t.entityType}:${t.id}`, t);
    return m;
  }, [targets]);
  const propertyEntity = useMemo(
    () => new Map(properties.map((p) => [p.id, p.entityId])),
    [properties]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return docs.filter((d) => {
      const target = targetByKey.get(`${d.entity_type}:${d.entity_id}`);
      const propertyId = target?.propertyId ?? null;
      if (propertyFilter && propertyId !== propertyFilter) return false;
      if (entityFilter) {
        const eid = d.entity_type === "entity" ? d.entity_id : propertyId ? propertyEntity.get(propertyId) : null;
        if (eid !== entityFilter) return false;
      }
      if (typeFilter && (d.doc_type ?? "other") !== typeFilter) return false;
      if (q) {
        const hay = [
          d.file_name,
          d.title ?? "",
          d.search_text ?? "",
          target?.label ?? "",
          ...extractedHighlights((d.doc_type ?? "other") as DocType, (d.extracted ?? null) as Record<string, unknown> | null),
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [docs, search, propertyFilter, entityFilter, typeFilter, targetByKey, propertyEntity]);

  const groups = (Object.keys(DOC_TYPES_BY_GROUP) as DocGroup[]).map((g) => ({
    key: g,
    label: DOC_GROUP_LABELS[g],
    docs: filtered.filter((d) => (DOC_TYPE_GROUP[(d.doc_type ?? "other") as DocType] ?? "other") === g),
  }));
  const untypedCount = docs.filter((d) => (d.doc_type ?? "other") === "other").length;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Documents</h1>
          <p className="text-sm text-gray-500">
            {docs.length} document{docs.length === 1 ? "" : "s"} across the organization.
            Deeds, surveys, FSA records, and everything else, findable by what they say.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {untypedCount > 0 ? (
            <Link
              href="/documents/retype"
              className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100"
            >
              Type {untypedCount} untyped
            </Link>
          ) : null}
          <button
            onClick={() => setUploadOpen(true)}
            className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600"
          >
            Upload
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search names and extracted fields"
          className={inputClass + " sm:col-span-1"}
        />
        <select value={propertyFilter} onChange={(e) => setPropertyFilter(e.target.value)} className={inputClass}>
          <option value="">All properties</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        {entities.length > 0 ? (
          <select value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)} className={inputClass}>
            <option value="">All entities</option>
            {entities.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        ) : <span className="hidden sm:block" />}
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={inputClass}>
          <option value="">All types</option>
          {(Object.keys(DOC_TYPES_BY_GROUP) as DocGroup[]).map((g) => (
            <optgroup key={g} label={DOC_GROUP_LABELS[g]}>
              {DOC_TYPES_BY_GROUP[g].map((t) => (
                <option key={t} value={t}>{DOC_TYPE_LABELS[t]}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {docs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center">
          <p className="text-sm font-medium text-gray-800">No documents yet</p>
          <p className="mt-1 text-xs text-gray-500">
            Upload a deed, survey, or FSA-156EZ here, or from any property, lease, or sale page.
          </p>
        </div>
      ) : null}

      {groups.map((g) => (
        <section key={g.key} className="rounded-xl border border-gray-200 bg-white">
          <button
            onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !c[g.key] }))}
            className="flex w-full items-center justify-between px-4 py-3 text-left"
          >
            <span className="text-sm font-semibold text-gray-900">
              {g.label}
              <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                {g.docs.length}
              </span>
            </span>
            <span className="text-xs text-gray-400">{collapsed[g.key] ? "Show" : "Hide"}</span>
          </button>
          {!collapsed[g.key] ? (
            g.docs.length === 0 ? (
              <p className="px-4 pb-3 text-xs text-gray-400">None{typeFilter || search || propertyFilter || entityFilter ? " matching" : ""}.</p>
            ) : (
              <ul className="divide-y divide-gray-100 border-t border-gray-100">
                {g.docs.map((d) => (
                  <DocumentRowView
                    key={d.id}
                    doc={d}
                    target={targetByKey.get(`${d.entity_type}:${d.entity_id}`) ?? null}
                    onChanged={() => router.refresh()}
                  />
                ))}
              </ul>
            )
          ) : null}
        </section>
      ))}

      {uploadOpen ? (
        <UploadSheet
          orgId={orgId}
          targets={targets}
          onClose={() => setUploadOpen(false)}
          onUploaded={() => {
            setUploadOpen(false);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function DocumentRowView({
  doc,
  target,
  onChanged,
}: {
  doc: DocumentRow;
  target: AttachTarget | null;
  onChanged: () => void;
}) {
  const supabase = createClient();
  const docType = (doc.doc_type ?? "other") as DocType;
  const highlights = extractedHighlights(docType, (doc.extracted ?? null) as Record<string, unknown> | null);
  const [changingType, setChangingType] = useState(false);

  async function setType(t: DocType) {
    await supabase.from("documents").update({ doc_type: t }).eq("id", doc.id);
    setChangingType(false);
    onChanged();
  }

  return (
    <li className="space-y-1.5 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            {changingType ? (
              <DocTypeSelect value={docType} onChange={setType} />
            ) : (
              <button onClick={() => setChangingType(true)} title="Change type">
                <DocTypeChip docType={docType} />
              </button>
            )}
            {doc.ai_suggested_type && docType === "other" && doc.ai_suggested_type !== "other" ? (
              <button
                onClick={() => setType(doc.ai_suggested_type as DocType)}
                title="Accept the AI suggestion"
              >
                <DocTypeChip docType={doc.ai_suggested_type} suggested />
              </button>
            ) : null}
            <button
              onClick={() => openDocument(supabase, doc.storage_path)}
              className="truncate text-left text-sm font-medium text-kelly-700 hover:underline"
            >
              {doc.title || doc.file_name}
            </button>
          </div>
          {highlights.length > 0 ? (
            <p className="text-xs text-gray-600">{highlights.join(" · ")}</p>
          ) : null}
          <p className="text-xs text-gray-500">
            {target ? (
              <Link href={target.href} className="hover:underline">
                {target.label}
              </Link>
            ) : (
              <span>Attached record not found</span>
            )}
            <span className="mx-1.5 text-gray-300">|</span>
            {new Date(doc.created_at).toLocaleDateString()}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <button
            onClick={() => openDocument(supabase, doc.storage_path)}
            className="font-medium text-gray-700 hover:underline"
          >
            Open
          </button>
          {canPlotBoundary(docType) ? (
            <Link href={`/documents/${doc.id}/plot`} className="font-medium text-kelly-700 hover:underline">
              Plot boundary
            </Link>
          ) : null}
        </div>
      </div>
      <ScanDocumentButton doc={doc} onChanged={onChanged} compact />
    </li>
  );
}

function UploadSheet({
  orgId,
  targets,
  onClose,
  onUploaded,
}: {
  orgId: string;
  targets: AttachTarget[];
  onClose: () => void;
  onUploaded: () => void;
}) {
  const supabase = createClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [attachType, setAttachType] = useState<DocumentEntityType>("property");
  const [attachId, setAttachId] = useState("");
  const [docType, setDocType] = useState<DocType>("other");
  const [title, setTitle] = useState("");
  const [suggestion, setSuggestion] = useState<ClassifySuggestion | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = targets.filter((t) => t.entityType === attachType);

  async function pickFile(f: File | null) {
    setFile(f);
    setSuggestion(null);
    if (!f) return;
    setClassifying(true);
    const s = await classifyFile(f);
    setClassifying(false);
    if (s) {
      setSuggestion(s);
      if (!title && s.title) setTitle(s.title);
    }
  }

  async function save() {
    if (!file || !attachId) return;
    setBusy(true);
    setError(null);
    const result = await uploadDocument(supabase, {
      orgId,
      entityType: attachType,
      entityId: attachId,
      file,
      docType,
      title: title.trim() || null,
      aiSuggestedType: suggestion?.doc_type ?? null,
    });
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    onUploaded();
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 md:items-center">
      <div className="max-h-[90%] w-full overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl md:max-w-md md:rounded-xl">
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Upload a document</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-1 text-gray-400 hover:bg-gray-100">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="mt-3 space-y-3">
          <div>
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full rounded-lg border border-dashed border-gray-300 px-3 py-4 text-sm text-gray-700 hover:bg-gray-50"
            >
              {file ? file.name : "Choose a PDF or photo"}
            </button>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
          </div>
          {classifying ? (
            <p className="text-xs text-gray-500">Reading the document to suggest a type...</p>
          ) : null}
          {suggestion && suggestion.doc_type !== docType ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5">
              <DocTypeChip docType={suggestion.doc_type} suggested />
              <span className="text-xs text-amber-900">
                AI suggests this type{suggestion.reason ? `: ${suggestion.reason}` : ""}.
              </span>
              <button
                onClick={() => setDocType(suggestion.doc_type)}
                className="rounded bg-kelly-500 px-2 py-0.5 text-xs font-semibold text-white hover:bg-kelly-600"
              >
                Use it
              </button>
            </div>
          ) : null}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Document type</label>
            <DocTypeSelect value={docType} onChange={setDocType} className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Title (optional)</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} placeholder="e.g. 2019 warranty deed, Smith to Jones" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Attach to</label>
              <select
                value={attachType}
                onChange={(e) => {
                  setAttachType(e.target.value as DocumentEntityType);
                  setAttachId("");
                }}
                className={inputClass}
              >
                {ATTACH_TYPES.map((t) => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Which one</label>
              <select value={attachId} onChange={(e) => setAttachId(e.target.value)} className={inputClass}>
                <option value="">Choose...</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={busy || !file || !attachId}
              className="rounded-lg bg-kelly-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-kelly-600 disabled:opacity-60"
            >
              {busy ? "Uploading..." : "Upload"}
            </button>
            <button onClick={onClose} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
