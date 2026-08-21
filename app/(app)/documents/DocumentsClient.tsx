"use client";

import Link from "next/link";
import { Suspense, useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  DOC_GROUPS,
  DOC_GROUP_LABELS,
  DOC_TYPES_BY_GROUP,
  DOC_TYPE_GROUP,
  DOC_TYPE_LABELS,
  extractedHighlights,
  type DocGroup,
  type DocType,
} from "@/lib/documents";
import { displayTitle } from "@/lib/documentTitle";
import type { DocumentEntityType, DocumentRow } from "@/types/db";
import DocumentCard from "@/components/documents/DocumentCard";
import IntakeFlow from "@/components/documents/intake/IntakeFlow";

export interface AttachTarget {
  entityType: DocumentEntityType;
  id: string;
  label: string;
  href: string;
  propertyId: string | null;
}

export interface DocPropertyLink {
  document_id: string;
  property_id: string;
}

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-kelly-500 focus:outline-none";

type GroupBy = "none" | "type" | "property";

export default function DocumentsClient(props: Parameters<typeof DocumentsInner>[0]) {
  // useSearchParams needs a Suspense boundary.
  return (
    <Suspense fallback={<div className="p-6 text-sm text-gray-500">Loading documents...</div>}>
      <DocumentsInner {...props} />
    </Suspense>
  );
}

// ONE organizing system at a time: a recent-first list of cards, search
// and a property/entity dropdown on top, the taxonomy as a rail (desktop)
// or chip rows (mobile) that filters, and an optional Group by. Filters
// live in the URL so Back from a document page restores the view.
function DocumentsInner({
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
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const filter = params.get("filter") ?? ""; // p:<id> | e:<id> | unfiled
  const group = (params.get("group") ?? "") as DocGroup | "";
  const type = (params.get("type") ?? "") as DocType | "";
  const groupBy = (params.get("groupBy") ?? "none") as GroupBy;
  const [uploadOpen, setUploadOpen] = useState(false);

  const setParams = useCallback(
    (patch: Record<string, string>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router]
  );

  const targetByKey = useMemo(() => {
    const m = new Map<string, AttachTarget>();
    for (const t of targets) m.set(`${t.entityType}:${t.id}`, t);
    return m;
  }, [targets]);
  const propertyEntity = useMemo(() => new Map(properties.map((p) => [p.id, p.entityId])), [properties]);
  const propertyName = useMemo(() => new Map(properties.map((p) => [p.id, p.name])), [properties]);
  const linkedProps = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const l of links) m.set(l.document_id, [...(m.get(l.document_id) ?? []), l.property_id]);
    return m;
  }, [links]);

  // Every property a document applies to: its links plus the property
  // its primary attachment sits on.
  const propsFor = useCallback(
    (d: DocumentRow): string[] => {
      const target = targetByKey.get(`${d.entity_type}:${d.entity_id}`);
      const ids = new Set(linkedProps.get(d.id) ?? []);
      if (target?.propertyId) ids.add(target.propertyId);
      return [...ids];
    },
    [targetByKey, linkedProps]
  );
  const isUnfiled = (d: DocumentRow) => d.entity_type === "organization" && propsFor(d).length === 0;

  // Search + property/entity filter (the type rail is applied after, so
  // rail counts reflect these but not themselves).
  const base = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return docs.filter((d) => {
      const target = targetByKey.get(`${d.entity_type}:${d.entity_id}`);
      const docProps = propsFor(d);
      if (filter === "unfiled") {
        if (!(d.entity_type === "organization" && docProps.length === 0)) return false;
      } else if (filter.startsWith("p:")) {
        if (!docProps.includes(filter.slice(2))) return false;
      } else if (filter.startsWith("e:")) {
        const eid = filter.slice(2);
        const ok = (d.entity_type === "entity" && d.entity_id === eid) || docProps.some((pid) => propertyEntity.get(pid) === eid);
        if (!ok) return false;
      }
      if (needle) {
        const hay = [
          displayTitle(d),
          d.file_name,
          d.search_text ?? "",
          target?.label ?? "",
          ...docProps.map((pid) => propertyName.get(pid) ?? ""),
          ...extractedHighlights((d.doc_type ?? "other") as DocType, (d.extracted ?? null) as Record<string, unknown> | null),
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [docs, q, filter, targetByKey, propsFor, propertyEntity, propertyName]);

  const groupCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const d of base) {
      const g = DOC_TYPE_GROUP[(d.doc_type ?? "other") as DocType] ?? "other";
      c[g] = (c[g] ?? 0) + 1;
    }
    return c;
  }, [base]);
  const typeCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const d of base) {
      const t = d.doc_type ?? "other";
      c[t] = (c[t] ?? 0) + 1;
    }
    return c;
  }, [base]);

  const filtered = useMemo(
    () =>
      base.filter((d) => {
        const t = (d.doc_type ?? "other") as DocType;
        if (type) return t === type;
        if (group) return (DOC_TYPE_GROUP[t] ?? "other") === group;
        return true;
      }),
    [base, group, type]
  );

  // Group by: section headers only when chosen.
  const sections = useMemo((): Array<{ key: string; label: string; docs: DocumentRow[] }> => {
    if (groupBy === "type") {
      const m = new Map<string, DocumentRow[]>();
      for (const d of filtered) {
        const t = d.doc_type ?? "other";
        m.set(t, [...(m.get(t) ?? []), d]);
      }
      return DOC_GROUPS.flatMap((g) => DOC_TYPES_BY_GROUP[g])
        .filter((t) => m.has(t))
        .map((t) => ({ key: t, label: DOC_TYPE_LABELS[t], docs: m.get(t)! }));
    }
    if (groupBy === "property") {
      const m = new Map<string, DocumentRow[]>();
      const unfiledDocs: DocumentRow[] = [];
      const other: DocumentRow[] = [];
      for (const d of filtered) {
        const ps = propsFor(d);
        if (ps.length === 0) {
          (isUnfiled(d) ? unfiledDocs : other).push(d);
          continue;
        }
        for (const p of ps) m.set(p, [...(m.get(p) ?? []), d]);
      }
      const out = properties.filter((p) => m.has(p.id)).map((p) => ({ key: p.id, label: p.name, docs: m.get(p.id)! }));
      if (other.length) out.push({ key: "__other", label: "Not on a property", docs: other });
      if (unfiledDocs.length) out.push({ key: "__unfiled", label: "Unfiled", docs: unfiledDocs });
      return out;
    }
    return [{ key: "all", label: "", docs: filtered }];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, groupBy, properties, propsFor]);

  const untypedCount = docs.filter((d) => (d.doc_type ?? "other") === "other").length;
  const unreviewedTitles = docs.filter((d) => d.title_reviewed === false).length;
  const filterName =
    filter === "unfiled"
      ? "Unfiled"
      : filter.startsWith("p:")
        ? (propertyName.get(filter.slice(2)) ?? "this property")
        : filter.startsWith("e:")
          ? (entities.find((e) => e.id === filter.slice(2))?.name ?? "this entity")
          : null;

  function emptyCopy(): string {
    if (type) return `No ${DOC_TYPE_LABELS[type]} documents yet. Upload one and Turnrow will read it.`;
    if (group) return `No ${DOC_GROUP_LABELS[group]} documents yet. Upload one and Turnrow will read it.`;
    if (q.trim()) return `Nothing matches "${q.trim()}".`;
    if (filterName) return filter === "unfiled" ? "Nothing is unfiled. Every document has a property." : `Nothing filed to ${filterName} yet.`;
    return "No documents match.";
  }

  const railItem = (active: boolean) =>
    "flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-sm " +
    (active ? "bg-kelly-50 font-semibold text-pine-900" : "text-gray-700 hover:bg-gray-50");
  const chip = (active: boolean) =>
    "inline-flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium " +
    (active ? "border-kelly-500 bg-kelly-50 text-pine-900" : "border-gray-300 bg-white text-gray-700");
  const count = (n: number | undefined) => (
    <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600">{n ?? 0}</span>
  );

  const typesInGroup = group ? DOC_TYPES_BY_GROUP[group] : [];

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Documents</h1>
          <p className="text-sm text-gray-500">
            {docs.length} document{docs.length === 1 ? "" : "s"} across the organization.
            Deeds, surveys, FSA records, and everything else, findable by what they say.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {unreviewedTitles > 0 ? (
            <Link
              href="/documents/titles"
              className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100"
            >
              Review {unreviewedTitles} title{unreviewedTitles === 1 ? "" : "s"}
            </Link>
          ) : null}
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

      {/* Search and the one property/entity control. */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="search"
          value={q}
          onChange={(e) => setParams({ q: e.target.value })}
          placeholder="Search titles, extracted fields, and file names"
          className={inputClass + " sm:flex-1"}
        />
        <select value={filter} onChange={(e) => setParams({ filter: e.target.value })} className={inputClass + " sm:w-56"}>
          <option value="">All properties</option>
          <option value="unfiled">Unfiled</option>
          <optgroup label="Properties">
            {properties.map((p) => (
              <option key={p.id} value={`p:${p.id}`}>{p.name}</option>
            ))}
          </optgroup>
          {entities.length > 0 ? (
            <optgroup label="Entities">
              {entities.map((e) => (
                <option key={e.id} value={`e:${e.id}`}>{e.name}</option>
              ))}
            </optgroup>
          ) : null}
        </select>
      </div>

      {/* Mobile: group chips, then the selected group's type chips. */}
      <div className="space-y-2 md:hidden">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button className={chip(!group)} onClick={() => setParams({ group: "", type: "" })}>
            All {count(base.length)}
          </button>
          {DOC_GROUPS.map((g) => (
            <button key={g} className={chip(group === g)} onClick={() => setParams({ group: g, type: "" })}>
              {DOC_GROUP_LABELS[g]} {count(groupCounts[g])}
            </button>
          ))}
        </div>
        {group ? (
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button className={chip(!type)} onClick={() => setParams({ type: "" })}>
              All {DOC_GROUP_LABELS[group].toLowerCase()}
            </button>
            {typesInGroup.map((t) => (
              <button key={t} className={chip(type === t)} onClick={() => setParams({ type: t })}>
                {DOC_TYPE_LABELS[t]} {count(typeCounts[t])}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex gap-5">
        {/* Desktop: slim rail. */}
        <nav className="hidden w-48 shrink-0 space-y-0.5 md:block" aria-label="Document types">
          <button className={railItem(!group)} onClick={() => setParams({ group: "", type: "" })}>
            <span>All</span>
            {count(base.length)}
          </button>
          {DOC_GROUPS.map((g) => (
            <div key={g}>
              <button className={railItem(group === g && !type)} onClick={() => setParams({ group: g, type: "" })}>
                <span className="truncate">{DOC_GROUP_LABELS[g]}</span>
                {count(groupCounts[g])}
              </button>
              {group === g ? (
                <div className="ml-3 mt-0.5 space-y-0.5 border-l border-gray-200 pl-2">
                  {DOC_TYPES_BY_GROUP[g].map((t) => (
                    <button key={t} className={railItem(type === t) + " text-xs"} onClick={() => setParams({ type: t })}>
                      <span className="truncate">{DOC_TYPE_LABELS[t]}</span>
                      {count(typeCounts[t])}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </nav>

        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
            <span>
              {filtered.length} shown
              {type ? ` in ${DOC_TYPE_LABELS[type]}` : group ? ` in ${DOC_GROUP_LABELS[group]}` : ""}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="mr-1">Group by</span>
              <span className="inline-flex overflow-hidden rounded-lg border border-gray-300">
                {(["none", "type", "property"] as GroupBy[]).map((g) => (
                  <button
                    key={g}
                    onClick={() => setParams({ groupBy: g === "none" ? "" : g })}
                    className={
                      "px-2.5 py-1 font-medium " +
                      (groupBy === g ? "bg-pine-800 text-white" : "bg-white text-gray-700 hover:bg-gray-50")
                    }
                  >
                    {g === "none" ? "None" : g === "type" ? "Type" : "Property"}
                  </button>
                ))}
              </span>
            </span>
          </div>

          {docs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center">
              <p className="text-sm font-medium text-gray-800">No documents yet</p>
              <p className="mt-1 text-xs text-gray-500">
                Upload a deed, survey, or FSA-156EZ here, or from any property, lease, or sale page.
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center">
              <p className="text-sm text-gray-700">{emptyCopy()}</p>
            </div>
          ) : (
            sections.map((s) => (
              <section key={s.key} className="space-y-2">
                {s.label ? (
                  <h2 className="flex items-center gap-2 pt-1 text-sm font-semibold text-gray-900">
                    {s.label}
                    {count(s.docs.length)}
                  </h2>
                ) : null}
                <ul className="space-y-2">
                  {s.docs.map((d) => {
                    const target = targetByKey.get(`${d.entity_type}:${d.entity_id}`);
                    return (
                      <DocumentCard
                        key={`${s.key}:${d.id}`}
                        doc={d}
                        propertyNames={propsFor(d).map((pid) => propertyName.get(pid) ?? "Property")}
                        attachedLabel={target && target.entityType !== "property" ? target.label : null}
                        onRenamed={() => router.refresh()}
                      />
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>

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
            <IntakeFlow orgId={orgId} onSaved={() => router.refresh()} onClose={() => setUploadOpen(false)} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
