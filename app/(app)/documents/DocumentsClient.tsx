"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
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
import type { MatchableParcel, MatchableProperty } from "@/lib/documentMatch";
import DocTypeChip from "@/components/documents/DocTypeChip";
import PropertyMultiSelect from "@/components/documents/PropertyMultiSelect";
import ScanDocumentButton from "@/components/documents/ScanDocumentButton";
import { DocTypeSelect } from "@/components/documents/DocTypeSelect";
import IntakeFlow from "@/components/documents/intake/IntakeFlow";
import {
  deleteDocumentEverywhere,
  openDocument,
  removeDocumentFromProperty,
  setDocumentProperties,
} from "@/components/documents/classify";

export interface AttachTarget {
  entityType: DocumentEntityType;
  id: string;
  label: string;
  href: string;
  propertyId: string | null;
}

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-kelly-500 focus:outline-none";

// Property filter value for documents not yet filed to any property.
const UNFILED_FILTER = "__unfiled";

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
}: {
  orgId: string;
  docs: DocumentRow[];
  targets: AttachTarget[];
  properties: Array<{ id: string; name: string; entityId: string | null; county: string | null; state: string | null }>;
  entities: Array<{ id: string; name: string }>;
  links: DocPropertyLink[]; // document_properties (migration 0023)
  // Kept for the page's props shape; the intake flow loads its own
  // matching context.
  matchProperties?: MatchableProperty[];
  matchParcels?: MatchableParcel[];
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
      const unfiled = d.entity_type === "organization" && docProps.length === 0;
      if (propertyFilter === UNFILED_FILTER) {
        if (!unfiled) return false;
      } else if (propertyFilter && !docProps.includes(propertyFilter)) return false;
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

  const isUnfiled = (d: DocumentRow) => d.entity_type === "organization" && propsFor(d).length === 0;
  const unfiledDocs = filtered.filter(isUnfiled);
  const groups = (Object.keys(DOC_TYPES_BY_GROUP) as DocGroup[]).map((g) => ({
    key: g,
    label: DOC_GROUP_LABELS[g],
    docs: filtered.filter(
      (d) => !isUnfiled(d) && (DOC_TYPE_GROUP[(d.doc_type ?? "other") as DocType] ?? "other") === g
    ),
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
          <option value={UNFILED_FILTER}>Unfiled</option>
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

      {unfiledDocs.length > 0 ? (
        <section className="rounded-xl border border-amber-200 bg-white">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              Unfiled
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">
                {unfiledDocs.length}
              </span>
            </span>
            <span className="text-xs text-gray-500">Not yet assigned to a property. Use Edit properties on a row.</span>
          </div>
          <ul className="divide-y divide-gray-100 border-t border-gray-100">
            {unfiledDocs.map((d) => (
              <DocumentRowView
                key={d.id}
                doc={d}
                target={null}
                propertyIds={[]}
                properties={properties}
                filterPropertyId={null}
                onChanged={() => router.refresh()}
              />
            ))}
          </ul>
        </section>
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
                    filterPropertyId={propertyFilter && propertyFilter !== UNFILED_FILTER ? propertyFilter : null}
                    onChanged={() => router.refresh()}
                  />
                ))}
              </ul>
            )
          ) : null}
        </section>
      ))}

      {uploadOpen ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-0 md:items-center md:p-6">
          <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl md:max-w-5xl md:rounded-2xl md:p-6">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Add a document</h2>
                <p className="text-xs text-gray-500">Drop the file, confirm what was read, save. Nothing is stored until you confirm.</p>
              </div>
              <button
                onClick={() => setUploadOpen(false)}
                aria-label="Close"
                className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <IntakeFlow
              orgId={orgId}
              onSaved={() => router.refresh()}
              onClose={() => setUploadOpen(false)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DocumentRowView({
  doc,
  target,
  propertyIds,
  properties,
  filterPropertyId,
  onChanged,
}: {
  doc: DocumentRow;
  target: AttachTarget | null;
  propertyIds: string[];
  properties: Array<{ id: string; name: string; county: string | null; state: string | null }>;
  // When the list is filtered to one property, deleting a document
  // linked to others offers "remove from this property only".
  filterPropertyId: string | null;
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

  // Delete semantics mirror the property page: linked to several
  // properties and viewed through one of them -> remove from this
  // property only, or delete the file everywhere; otherwise confirm
  // and delete everywhere (file and row).
  async function remove() {
    const others = filterPropertyId ? propertyIds.filter((p) => p !== filterPropertyId) : [];
    if (filterPropertyId && propertyIds.includes(filterPropertyId) && others.length > 0) {
      const choice = window.prompt(
        `${doc.file_name} is also attached to ${others.length} other propert${others.length === 1 ? "y" : "ies"}.\n` +
          `Type REMOVE to take it off ${nameOf(filterPropertyId)} only, or DELETE to delete the file for all ${propertyIds.length} properties.`,
        "REMOVE"
      );
      if (!choice) return;
      const c = choice.trim().toUpperCase();
      if (c === "DELETE") {
        const err = await deleteDocumentEverywhere(supabase, doc);
        if (err) setPropError("Could not delete. " + err);
      } else if (c === "REMOVE") {
        const err = await removeDocumentFromProperty(supabase, doc, filterPropertyId, propertyIds);
        if (err) setPropError("Could not remove. " + err);
      } else {
        return;
      }
      onChanged();
      return;
    }
    const where =
      propertyIds.length > 1 ? ` It is attached to ${propertyIds.length} properties; this deletes it everywhere.` : "";
    if (!window.confirm(`Delete ${doc.file_name}?${where} This cannot be undone.`)) return;
    const err = await deleteDocumentEverywhere(supabase, doc);
    if (err) {
      setPropError("Could not delete. " + err);
      return;
    }
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
            {doc.entity_type === "organization" && propertyIds.length === 0 ? (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-900">Unfiled</span>
            ) : !target && propertyIds.length === 0 ? (
              <span>Attached record not found</span>
            ) : null}
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
          <button onClick={remove} className="font-medium text-red-600 hover:underline">
            Delete
          </button>
        </div>
      </div>
      {propError && !editingProps ? <p className="text-xs text-red-600">{propError}</p> : null}
      <ScanDocumentButton doc={doc} onChanged={onChanged} compact />
    </li>
  );
}
