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
import {
  isConfident,
  suggestProperties,
  type MatchableParcel,
  type MatchableProperty,
  type PropertySuggestion,
} from "@/lib/documentMatch";
import DocTypeChip from "@/components/documents/DocTypeChip";
import PropertyMultiSelect from "@/components/documents/PropertyMultiSelect";
import ScanDocumentButton from "@/components/documents/ScanDocumentButton";
import { DocTypeSelect } from "@/components/documents/EntityDocuments";
import {
  classifyFile,
  openDocument,
  setDocumentProperties,
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

// Non-property records a document can ALSO belong to (properties are a
// multi-select of their own).
const ATTACH_TYPES: Array<{ key: DocumentEntityType; label: string }> = [
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

export interface DocPropertyLink {
  document_id: string;
  property_id: string;
}

export default function DocumentsClient({
  orgId,
  docs,
  targets,
  properties,
  entities,
  links,
  matchProperties,
  matchParcels,
}: {
  orgId: string;
  docs: DocumentRow[];
  targets: AttachTarget[];
  properties: Array<{ id: string; name: string; entityId: string | null; county: string | null; state: string | null }>;
  entities: Array<{ id: string; name: string }>;
  links: DocPropertyLink[]; // document_properties (migration 0023)
  matchProperties: MatchableProperty[];
  matchParcels: MatchableParcel[];
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
  const propertyName = useMemo(() => new Map(properties.map((p) => [p.id, p.name])), [properties]);
  // Every property a document applies to: its links plus the property
  // its primary attachment sits on.
  const linkedProps = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const l of links) m.set(l.document_id, [...(m.get(l.document_id) ?? []), l.property_id]);
    return m;
  }, [links]);
  const propsFor = (d: DocumentRow): string[] => {
    const target = targetByKey.get(`${d.entity_type}:${d.entity_id}`);
    const ids = new Set(linkedProps.get(d.id) ?? []);
    if (target?.propertyId) ids.add(target.propertyId);
    return [...ids];
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return docs.filter((d) => {
      const target = targetByKey.get(`${d.entity_type}:${d.entity_id}`);
      const docProps = propsFor(d);
      if (propertyFilter && !docProps.includes(propertyFilter)) return false;
      if (entityFilter) {
        const ok =
          (d.entity_type === "entity" && d.entity_id === entityFilter) ||
          docProps.some((pid) => propertyEntity.get(pid) === entityFilter);
        if (!ok) return false;
      }
      if (typeFilter && (d.doc_type ?? "other") !== typeFilter) return false;
      if (q) {
        const hay = [
          d.file_name,
          d.title ?? "",
          d.search_text ?? "",
          target?.label ?? "",
          ...docProps.map((pid) => propertyName.get(pid) ?? ""),
          ...extractedHighlights((d.doc_type ?? "other") as DocType, (d.extracted ?? null) as Record<string, unknown> | null),
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs, search, propertyFilter, entityFilter, typeFilter, targetByKey, propertyEntity, linkedProps, propertyName]);

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
                    propertyIds={propsFor(d)}
                    properties={properties}
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
          properties={properties}
          matchProperties={matchProperties}
          matchParcels={matchParcels}
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
  propertyIds,
  properties,
  onChanged,
}: {
  doc: DocumentRow;
  target: AttachTarget | null;
  propertyIds: string[];
  properties: Array<{ id: string; name: string; county: string | null; state: string | null }>;
  onChanged: () => void;
}) {
  const supabase = createClient();
  const docType = (doc.doc_type ?? "other") as DocType;
  const highlights = extractedHighlights(docType, (doc.extracted ?? null) as Record<string, unknown> | null);
  const [changingType, setChangingType] = useState(false);
  const [editingProps, setEditingProps] = useState(false);
  const [draftProps, setDraftProps] = useState<string[]>(propertyIds);
  const [propError, setPropError] = useState<string | null>(null);
  const nameOf = (id: string) => properties.find((p) => p.id === id)?.name ?? "Property";

  async function setType(t: DocType) {
    await supabase.from("documents").update({ doc_type: t }).eq("id", doc.id);
    setChangingType(false);
    onChanged();
  }

  async function saveProps() {
    setPropError(null);
    if (draftProps.length === 0 && doc.entity_type === "property") {
      setPropError("Keep at least one property, or delete the document.");
      return;
    }
    const err = await setDocumentProperties(supabase, doc, draftProps);
    if (err) {
      setPropError(err);
      return;
    }
    setEditingProps(false);
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
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
            {propertyIds.map((pid) => (
              <Link
                key={pid}
                href={`/properties/${pid}`}
                className="rounded-full bg-kelly-50 px-2 py-0.5 font-medium text-pine-900 hover:bg-kelly-100"
              >
                {nameOf(pid)}
              </Link>
            ))}
            {target && target.entityType !== "property" ? (
              <Link href={target.href} className="hover:underline">
                {target.label}
              </Link>
            ) : null}
            {!target && propertyIds.length === 0 ? <span>Attached record not found</span> : null}
            <button
              onClick={() => {
                setDraftProps(propertyIds);
                setEditingProps((v) => !v);
              }}
              className="font-medium text-kelly-700 hover:underline"
            >
              {editingProps ? "Close" : "Edit properties"}
            </button>
            <span className="text-gray-300">|</span>
            <span>{new Date(doc.created_at).toLocaleDateString()}</span>
          </div>
          {editingProps ? (
            <div className="mt-1 max-w-md space-y-1.5 rounded-lg border border-gray-200 bg-gray-50 p-2">
              <PropertyMultiSelect
                properties={properties}
                selected={draftProps}
                onChange={setDraftProps}
                compact
              />
              {propError ? <p className="text-xs text-red-600">{propError}</p> : null}
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

type UploadMode = "ai" | "manual";

function UploadSheet({
  orgId,
  targets,
  properties,
  matchProperties,
  matchParcels,
  onClose,
  onUploaded,
}: {
  orgId: string;
  targets: AttachTarget[];
  properties: Array<{ id: string; name: string; county: string | null; state: string | null }>;
  matchProperties: MatchableProperty[];
  matchParcels: MatchableParcel[];
  onClose: () => void;
  onUploaded: () => void;
}) {
  const supabase = createClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<UploadMode>("ai");
  const [file, setFile] = useState<File | null>(null);
  const [propertyIds, setPropertyIds] = useState<string[]>([]);
  const [extraOn, setExtraOn] = useState(false);
  const [attachType, setAttachType] = useState<DocumentEntityType>("parcel");
  const [attachId, setAttachId] = useState("");
  const [docType, setDocType] = useState<DocType>("other");
  const [title, setTitle] = useState("");
  const [suggestion, setSuggestion] = useState<ClassifySuggestion | null>(null);
  const [propSuggestions, setPropSuggestions] = useState<PropertySuggestion[]>([]);
  const [classifying, setClassifying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = targets.filter((t) => t.entityType === attachType);

  async function pickFile(f: File | null) {
    setFile(f);
    setSuggestion(null);
    setPropSuggestions([]);
    if (!f || mode === "manual") return;
    setClassifying(true);
    const s = await classifyFile(f);
    setClassifying(false);
    if (s) {
      setSuggestion(s);
      if (!title && s.title) setTitle(s.title);
      const sugg = suggestProperties(s.property_hints, matchProperties, matchParcels);
      setPropSuggestions(sugg);
      // Confident matches come pre-checked; weaker ones are shown but
      // left for the user to tick.
      const confident = sugg.filter(isConfident).map((x) => x.propertyId);
      if (confident.length > 0) {
        setPropertyIds((cur) => [...new Set([...cur, ...confident])]);
      }
    }
  }

  const extraChosen = extraOn && attachId !== "";
  const canSave = !!file && (propertyIds.length > 0 || extraChosen);

  async function save() {
    if (!file || !canSave) return;
    setBusy(true);
    setError(null);
    // Primary attachment: the first chosen property unless a specific
    // non-property record was picked.
    const primary = extraChosen
      ? { entityType: attachType, entityId: attachId }
      : { entityType: "property" as DocumentEntityType, entityId: propertyIds[0] };
    const result = await uploadDocument(supabase, {
      orgId,
      entityType: primary.entityType,
      entityId: primary.entityId,
      file,
      docType,
      title: title.trim() || null,
      aiSuggestedType: suggestion?.doc_type ?? null,
      propertyIds,
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
      <div className="max-h-[90%] w-full overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl md:max-w-lg md:rounded-xl">
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Upload a document</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-1 text-gray-400 hover:bg-gray-100">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-1.5">
          {(
            [
              ["ai", "AI upload", "Reads the file to suggest the type and the properties it belongs to"],
              ["manual", "Manual upload", "No reading; you pick everything"],
            ] as Array<[UploadMode, string, string]>
          ).map(([m, label, hint]) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                if (m === "manual") {
                  setSuggestion(null);
                  setPropSuggestions([]);
                }
              }}
              className={
                "rounded-lg border px-3 py-2 text-left " +
                (mode === m
                  ? "border-kelly-500 bg-kelly-50 text-pine-900"
                  : "border-gray-300 text-gray-700 hover:bg-gray-50")
              }
            >
              <span className="block text-sm font-medium">{label}</span>
              <span className="block text-[11px] leading-tight text-gray-500">{hint}</span>
            </button>
          ))}
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
          {mode === "manual" ? (
            <p className="text-xs text-gray-500">Manual upload: the file is not read by AI.</p>
          ) : null}
          {classifying ? (
            <p className="text-xs text-gray-500">Reading the document to suggest a type and properties...</p>
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
          {suggestion && propSuggestions.length === 0 && mode === "ai" ? (
            <p className="text-xs text-gray-500">
              Nothing on the page matched a property by parcel, farm number, name, or county; pick the properties below.
            </p>
          ) : null}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Document type</label>
            <DocTypeSelect value={docType} onChange={setDocType} className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Title (optional)</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} placeholder="e.g. 2019 warranty deed, Smith to Jones" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Properties this document applies to
              {propertyIds.length > 0 ? (
                <span className="ml-1.5 text-xs font-normal text-gray-500">{propertyIds.length} selected</span>
              ) : null}
            </label>
            <PropertyMultiSelect
              properties={properties}
              selected={propertyIds}
              onChange={setPropertyIds}
              suggestions={propSuggestions}
            />
            {propSuggestions.length > 0 ? (
              <p className="mt-1 text-[11px] text-amber-900">
                Amber rows were suggested from the document. Confident matches are pre-checked; confirm or change them.
              </p>
            ) : null}
          </div>
          <div>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={extraOn}
                onChange={(e) => {
                  setExtraOn(e.target.checked);
                  if (!e.target.checked) setAttachId("");
                }}
                className="h-4 w-4 accent-kelly-500"
              />
              Also belongs to a specific record (parcel, lease, easement...)
            </label>
            {extraOn ? (
              <div className="mt-1.5 grid grid-cols-2 gap-2">
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
                <select value={attachId} onChange={(e) => setAttachId(e.target.value)} className={inputClass}>
                  <option value="">Choose...</option>
                  {options.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          {file && !canSave ? (
            <p className="text-xs text-gray-500">Pick at least one property or a specific record.</p>
          ) : null}
          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={busy || !canSave}
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
