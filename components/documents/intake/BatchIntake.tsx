"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  DOC_GROUP_LABELS,
  DOC_GROUPS,
  DOC_TYPE_LABELS,
  DOC_TYPES_BY_GROUP,
  type DocType,
} from "@/lib/documents";
import { cleanFileName, proposeTitle } from "@/lib/documentTitle";
import { verifyMatches, type PropertySuggestion } from "@/lib/documentMatch";
import {
  aiReadable,
  buildDuplicateIndex,
  folderProperty,
  proposeBatchRow,
  runPool,
  type BatchStatus,
} from "@/lib/batchIntake";
import type { DocumentEntityType } from "@/types/db";
import {
  intakeFile,
  intakeStoragePath,
  uploadDocument,
  uploadErrorCopy,
  uploadToStorage,
  type IntakeResult,
} from "../classify";
import PropertyMultiSelect from "../PropertyMultiSelect";
import type { PathedFile } from "./DropZone";
import type { IntakeContextTarget } from "./types";
import { intakeContextFrom, type MatchingContext } from "./useMatchingContext";

// Bulk upload: every dropped file is read by the same AI intake as the
// single upload (three at a time), then lands in one review table with
// its proposed type, title, and properties. Confident rows are checked;
// the rest say why they need a look. One button saves the checked rows.
// Saving stores the file, type, title, and property links; the AI's
// field values are NOT saved here (they are only saved after a field by
// field review), so each document's Scan button pulls them later.

type RowStatus = "queued" | "reading" | BatchStatus | "saving" | "saved" | "failed";

interface Row {
  key: string;
  file: File;
  relPath: string | null;
  status: RowStatus;
  storagePath: string | null;
  result: IntakeResult | null;
  suggestions: PropertySuggestion[];
  docType: DocType;
  title: string;
  propertyIds: string[];
  notes: string[];
  checked: boolean;
  editingProps: boolean;
  error: string | null;
  savedId: string | null;
  // The document already in Turnrow when this file is a duplicate.
  existingId: string | null;
}

const READ_CONCURRENCY = 3;
const SAVE_CONCURRENCY = 3;

const STATUS_CHIP: Record<RowStatus, { label: string; cls: string }> = {
  queued: { label: "Waiting", cls: "bg-gray-100 text-gray-600" },
  reading: { label: "Reading...", cls: "bg-gray-100 text-gray-700 animate-pulse" },
  ready: { label: "Ready", cls: "bg-kelly-100 text-pine-900" },
  review: { label: "Needs a look", cls: "bg-amber-100 text-amber-900" },
  duplicate: { label: "Already in Turnrow", cls: "bg-gray-200 text-gray-700" },
  elsewhere: { label: "Different upload", cls: "bg-sky-100 text-sky-900" },
  saving: { label: "Saving...", cls: "bg-kelly-50 text-pine-900 animate-pulse" },
  saved: { label: "Saved", cls: "bg-pine-800 text-white" },
  failed: { label: "Not saved", cls: "bg-red-100 text-red-800" },
};

type Filter = "all" | "ready" | "review" | "saved";

function makeRow(file: File, i: number): Row {
  const rel = (file as PathedFile).relativePath || file.webkitRelativePath || null;
  return {
    key: `${i}-${file.name}-${file.size}-${file.lastModified}`,
    file,
    relPath: rel,
    status: "queued",
    storagePath: null,
    result: null,
    suggestions: [],
    docType: "other",
    title: "",
    propertyIds: [],
    notes: [],
    checked: false,
    editingProps: false,
    error: null,
    savedId: null,
    existingId: null,
  };
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function BatchIntake({
  orgId,
  files,
  context,
  isAdmin = false,
  matching,
  onSaved,
  onDirtyChange,
  onSavingChange,
  onDone,
  onStartOver,
}: {
  orgId: string;
  files: File[];
  context: IntakeContextTarget | null;
  // Only an admin may save a row with no property (Unfiled).
  isAdmin?: boolean;
  matching: MatchingContext;
  onSaved: (documentId: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  // True while Save is running, so the dialog refuses to close.
  onSavingChange?: (saving: boolean) => void;
  onDone: () => void;
  onStartOver: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Row[]>(() => files.map(makeRow));
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const started = useRef(new Set<string>());
  // The dialog went away (closed, Back, a new page). A save that is
  // still running stops before its next row, and the rows it did not
  // reach are cleaned up by the save itself.
  const gone = useRef(false);
  // Rows handed to the save that is running (saving now or waiting their
  // turn). Their files must not be touched from outside the save: a row
  // inserted after its file was removed is a document that will not open.
  const inSave = useRef(new Set<string>());
  const [existing, setExisting] = useState<((name: string, size: number) => string | null) | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [saving, setSaving] = useState(false);
  const [applyProp, setApplyProp] = useState("");
  const [applyType, setApplyType] = useState("");
  const addRef = useRef<HTMLInputElement>(null);

  const propName = useCallback(
    (id: string) => matching.properties.find((p) => p.id === id)?.name ?? "Unknown property",
    [matching.properties]
  );
  const selectable = useMemo(
    () => matching.properties.map((p) => ({ id: p.id, name: p.name, county: p.county, state: p.state })),
    [matching.properties]
  );

  const patch = useCallback((key: string, p: Partial<Row>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...p } : r)));
  }, []);

  // Documents already in Turnrow, by name and size, so a re-dropped
  // folder never saves twice.
  useEffect(() => {
    let cancelled = false;
    supabase
      .from("documents")
      .select("id, file_name, size_bytes")
      .then(({ data }) => {
        if (cancelled) return;
        const index = buildDuplicateIndex((data ?? []) as Array<{ id: string; file_name: string; size_bytes: number | null }>);
        // Functional update: store the function itself, not call it.
        setExisting(() => index);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  // ---- reading one file
  const process = useCallback(
    async (row: Row) => {
      const file = row.file;
      const folderPropertyId = context ? null : folderProperty(row.relPath, matching.properties);
      const existingId = existing ? existing(file.name, file.size) : null;
      const duplicate = existingId !== null;
      const readable = aiReadable(file.name, file.type);
      const decide = (result: IntakeResult | null, aiError: string | null, storagePath: string | null) => {
        const v = result
          ? verifyMatches(
              result.matched_properties,
              result.property_hints,
              matching.properties,
              matching.parcels,
              matching.entities,
              result.matched_entity,
              matching.propertyEntity,
              result.spatial ?? null
            )
          : null;
        const proposal = proposeBatchRow({
          readable,
          aiError,
          docType: result?.doc_type ?? null,
          confidence: result?.confidence ?? null,
          specializedKind: result?.specialized_kind ?? null,
          preselect: v?.preselect ?? [],
          conflict: v?.conflict ?? false,
          folderPropertyId,
          contextPropertyId: context?.propertyId ?? null,
          duplicate,
          propertyName: propName,
        });
        const docType: DocType = result?.doc_type ?? "other";
        const firstName = proposal.propertyIds[0] ? propName(proposal.propertyIds[0]) : null;
        const title = result
          ? result.title?.trim() || proposeTitle(docType, result.fields, file.name, { propertyName: firstName })
          : `${DOC_TYPE_LABELS[docType]} - ${cleanFileName(file.name)}`;
        patch(row.key, {
          status: proposal.status,
          storagePath,
          result,
          suggestions: v?.verified ?? [],
          docType,
          title,
          propertyIds: proposal.propertyIds,
          notes: proposal.notes,
          checked: proposal.status === "ready",
          existingId,
        });
      };

      // Duplicates and files the AI cannot read skip the model call.
      if (duplicate || !readable) {
        decide(null, null, null);
        return;
      }
      patch(row.key, { status: "reading" });
      const path = intakeStoragePath(orgId, file);
      const upErr = await uploadToStorage(supabase, path, file);
      if (upErr) {
        decide(null, uploadErrorCopy(file.name, upErr), null);
        return;
      }
      // The dialog closed while this file was uploading: nothing is kept.
      if (gone.current) {
        supabase.storage.from("documents").remove([path]).then(() => undefined, () => undefined);
        return;
      }
      const res = await intakeFile(
        { storagePath: path, fileName: file.name, contentType: file.type || "application/pdf" },
        intakeContextFrom(matching),
        file
      );
      if (gone.current) {
        supabase.storage.from("documents").remove([path]).then(() => undefined, () => undefined);
        return;
      }
      if ("error" in res) decide(null, res.error, path);
      else decide(res.result, null, path);
    },
    [context, existing, matching, orgId, patch, propName, supabase]
  );

  // ---- the read queue: start queued rows, at most three at a time
  useEffect(() => {
    if (!matching.loaded || existing === null) return;
    const active = rows.filter((r) => r.status === "reading").length;
    const inFlight = [...started.current].filter((k) => {
      const r = rows.find((x) => x.key === k);
      return r && (r.status === "queued" || r.status === "reading");
    }).length;
    let slots = READ_CONCURRENCY - Math.max(active, inFlight);
    for (const r of rows) {
      if (slots <= 0) break;
      if (r.status !== "queued" || started.current.has(r.key)) continue;
      started.current.add(r.key);
      slots--;
      void process(r);
    }
  }, [rows, matching.loaded, existing, process]);

  // Every row removed: back to the drop zone.
  useEffect(() => {
    if (rows.length === 0) onStartOver();
  }, [rows.length, onStartOver]);

  // ---- dirty: read documents that are not saved yet
  const dirty = rows.some((r) => !["saved", "duplicate", "failed"].includes(r.status));
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // Leaving without saving: drop the storage objects of files that are
  // not saved and not part of a running save.
  useEffect(() => {
    gone.current = false;
    return () => {
      gone.current = true;
      const stale = rowsRef.current
        .filter((r) => r.storagePath && r.status !== "saved" && r.status !== "saving" && !inSave.current.has(r.key))
        .map((r) => r.storagePath!);
      if (stale.length > 0) supabase.storage.from("documents").remove(stale).then(() => undefined, () => undefined);
    };
  }, [supabase]);

  useEffect(() => {
    onSavingChange?.(saving);
  }, [saving, onSavingChange]);

  // ---- saving the checked rows
  async function saveChecked() {
    if (inSave.current.size > 0) return;
    const todo = rowsRef.current.filter((r) => r.checked && r.status !== "saved" && r.status !== "saving");
    if (todo.length === 0) return;
    setSaving(true);
    inSave.current = new Set(todo.map((r) => r.key));
    const savedKeys = new Set<string>();
    let lastId: string | null = null;
    await runPool(todo, SAVE_CONCURRENCY, async (row) => {
      // The row as it is now. One that was removed, unchecked, or sent
      // back to be read again while it waited its turn is not saved.
      const current = rowsRef.current.find((r) => r.key === row.key);
      if (!current || !current.checked || current.status === "queued" || current.status === "reading") return;
      // Unfiled is admin-only: say so on the row before anything is saved.
      if (!isAdmin && !context && current.propertyIds.length === 0) {
        patch(row.key, { status: "failed", error: "Choose the property this belongs to. Only an admin can save a document without one." });
        return;
      }
      patch(row.key, { status: "saving", error: null });
      let entityType: DocumentEntityType = "organization";
      let entityId = orgId;
      let propertyIds = [...current.propertyIds];
      if (context) {
        entityType = context.entityType;
        entityId = context.entityId;
        if (context.propertyId) propertyIds = [...new Set([context.propertyId, ...propertyIds])];
      } else if (propertyIds.length > 0) {
        entityType = "property";
        entityId = propertyIds[0];
      }
      const evidence: Record<string, string> = {};
      for (const s of current.suggestions) {
        if (propertyIds.includes(s.propertyId) && s.reasons.length > 0) evidence[s.propertyId] = s.reasons.join("; ");
      }
      const fromFolder = folderProperty(current.relPath, matching.properties);
      if (fromFolder && propertyIds.includes(fromFolder) && !evidence[fromFolder]) {
        evidence[fromFolder] = "Uploaded from a folder named after this property";
      }
      const res = await uploadDocument(supabase, {
        orgId,
        entityType,
        entityId,
        file: current.file,
        docType: current.docType,
        title: current.title.trim() || `${DOC_TYPE_LABELS[current.docType]} - ${cleanFileName(current.file.name)}`,
        aiSuggestedType: current.result?.doc_type ?? null,
        propertyIds,
        evidence,
        extracted: null,
        storagePath: current.storagePath,
      }).catch(() => ({ error: `Could not save ${current.file.name}. Check your connection and try again.` }));
      if ("error" in res) {
        patch(row.key, { status: "failed", error: res.error });
        return;
      }
      savedKeys.add(row.key);
      patch(row.key, { status: "saved", savedId: res.id, checked: false, editingProps: false, error: res.warning ?? null });
      lastId = res.id;
    }, () => gone.current);
    inSave.current = new Set();
    if (gone.current) {
      // Closed mid-save. Every row that did not become a document (not
      // reached, or failed) still has its uploaded file: remove those.
      // Saved rows keep theirs.
      const stale = todo.filter((r) => !savedKeys.has(r.key) && r.storagePath).map((r) => r.storagePath!);
      if (stale.length > 0) supabase.storage.from("documents").remove(stale).then(() => undefined, () => undefined);
      return;
    }
    setSaving(false);
    // One refresh of the page behind the modal per batch, not per file.
    if (lastId) onSaved(lastId);
  }

  function retry(row: Row) {
    if (row.storagePath) supabase.storage.from("documents").remove([row.storagePath]).then(() => undefined, () => undefined);
    started.current.delete(row.key);
    patch(row.key, { status: "queued", storagePath: null, result: null, notes: [], error: null, checked: false });
  }

  function remove(row: Row) {
    if (row.storagePath && row.status !== "saved") {
      supabase.storage.from("documents").remove([row.storagePath]).then(() => undefined, () => undefined);
    }
    setRows((prev) => prev.filter((r) => r.key !== row.key));
  }

  function addFiles(more: File[]) {
    setRows((prev) => [...prev, ...more.map((f, i) => makeRow(f, prev.length + i))]);
  }

  function applyToChecked() {
    setRows((prev) =>
      prev.map((r) => {
        if (!r.checked || r.status === "saved") return r;
        const next = { ...r };
        if (applyProp && !next.propertyIds.includes(applyProp)) next.propertyIds = [...next.propertyIds, applyProp];
        if (applyType) next.docType = applyType as DocType;
        return next;
      })
    );
    setApplyProp("");
    setApplyType("");
  }

  // ---- counts and the visible list
  const counts = useMemo(() => {
    const c = { total: rows.length, reading: 0, ready: 0, review: 0, saved: 0, checked: 0, done: 0 };
    for (const r of rows) {
      if (r.status === "queued" || r.status === "reading") c.reading++;
      else c.done++;
      if (r.status === "ready") c.ready++;
      if (r.status === "review" || r.status === "elsewhere" || r.status === "failed") c.review++;
      if (r.status === "saved") c.saved++;
      if (r.checked && r.status !== "saved") c.checked++;
    }
    return c;
  }, [rows]);

  const visible = rows.filter((r) => {
    if (filter === "ready") return r.status === "ready";
    if (filter === "review") return r.status === "review" || r.status === "elsewhere" || r.status === "failed";
    if (filter === "saved") return r.status === "saved";
    return true;
  });
  const checkable = (r: Row) => !["queued", "reading", "saving", "saved"].includes(r.status);
  const allVisibleChecked = visible.filter(checkable).length > 0 && visible.filter(checkable).every((r) => r.checked);
  const pct = counts.total ? Math.round((counts.done / counts.total) * 100) : 0;
  const finished = counts.total > 0 && counts.saved + rows.filter((r) => r.status === "duplicate").length === counts.total;

  return (
    <div className="space-y-3">
      {/* progress + summary */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-semibold text-gray-900">
            {counts.reading > 0
              ? `${counts.done.toLocaleString("en-US")} of ${counts.total.toLocaleString("en-US")} read...`
              : `All ${counts.total.toLocaleString("en-US")} ${counts.total === 1 ? "file" : "files"} read`}
          </p>
          <p className="text-xs text-gray-600">
            <span className="font-medium text-pine-900">{counts.ready} ready</span>
            {" · "}
            <span className="font-medium text-amber-800">{counts.review} need a look</span>
            {" · "}
            {counts.saved} saved
          </p>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-gray-200">
          <div className="h-full rounded bg-kelly-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 text-xs text-gray-600">
          Ready rows are checked for you. Fix anything marked Needs a look, then save. Saving stores the file, type,
          title, and properties; open a document later and use Scan this document to pull its details (owners, dates, acres) with a
          field-by-field review.
        </p>
      </div>

      {finished ? (
        <div className="rounded-xl border border-kelly-200 bg-kelly-50 p-4">
          <p className="text-sm font-semibold text-pine-900">
            All done: {counts.saved.toLocaleString("en-US")} saved
            {rows.length - counts.saved > 0 ? `, ${rows.length - counts.saved} already in Turnrow` : ""}.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onDone}
              className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600"
            >
              Done
            </button>
            <button
              type="button"
              onClick={onStartOver}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Upload more
            </button>
          </div>
        </div>
      ) : null}

      {/* filters + bulk apply */}
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["all", `All ${counts.total}`],
            ["ready", `Ready ${counts.ready}`],
            ["review", `Needs a look ${counts.review}`],
            ["saved", `Saved ${counts.saved}`],
          ] as Array<[Filter, string]>
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            className={
              "rounded-full px-3 py-1 text-xs font-medium " +
              (filter === k ? "bg-pine-800 text-white" : "bg-white text-gray-700 ring-1 ring-gray-300 hover:bg-gray-50")
            }
          >
            {label}
          </button>
        ))}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-gray-500">For checked rows:</span>
          <select
            value={applyProp}
            onChange={(e) => setApplyProp(e.target.value)}
            className="rounded-md border border-gray-300 px-2 py-1 text-xs"
            aria-label="Add a property to checked rows"
          >
            <option value="">Add property...</option>
            {selectable.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            value={applyType}
            onChange={(e) => setApplyType(e.target.value)}
            className="rounded-md border border-gray-300 px-2 py-1 text-xs"
            aria-label="Set the type of checked rows"
          >
            <option value="">Set type...</option>
            {DOC_GROUPS.map((g) => (
              <optgroup key={g} label={DOC_GROUP_LABELS[g]}>
                {DOC_TYPES_BY_GROUP[g].map((t) => (
                  <option key={t} value={t}>
                    {DOC_TYPE_LABELS[t]}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button
            type="button"
            disabled={!applyProp && !applyType}
            onClick={applyToChecked}
            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Apply
          </button>
        </div>
      </div>

      {/* the table */}
      <div className="overflow-hidden rounded-xl border border-gray-200">
        <div className="hidden grid-cols-[2rem_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1.2fr)] gap-3 border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-600 md:grid">
          <input
            type="checkbox"
            aria-label="Check all rows shown"
            checked={allVisibleChecked}
            onChange={(e) =>
              setRows((prev) =>
                prev.map((r) => (visible.includes(r) && checkable(r) ? { ...r, checked: e.target.checked } : r))
              )
            }
            className="mt-0.5 h-4 w-4 accent-kelly-600"
          />
          <span>File</span>
          <span>Type</span>
          <span>Title</span>
          <span>Properties</span>
        </div>
        <ul className="divide-y divide-gray-100">
          {visible.map((r) => {
            const chip = STATUS_CHIP[r.status];
            const busy = r.status === "queued" || r.status === "reading" || r.status === "saving";
            const locked = busy || r.status === "saved";
            return (
              <li
                key={r.key}
                className={
                  "grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 gap-y-2 px-3 py-3 md:grid-cols-[2rem_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1.2fr)] " +
                  (r.status === "saved" ? "bg-kelly-50/40" : "")
                }
              >
                <input
                  type="checkbox"
                  aria-label={`Include ${r.file.name}`}
                  disabled={!checkable(r)}
                  checked={r.checked}
                  onChange={(e) => patch(r.key, { checked: e.target.checked })}
                  className="mt-1 h-4 w-4 accent-kelly-600 disabled:opacity-40"
                />
                {/* file + status */}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={"rounded-full px-2 py-0.5 text-[11px] font-semibold " + chip.cls}>{chip.label}</span>
                    <button
                      type="button"
                      onClick={() => window.open(URL.createObjectURL(r.file), "_blank", "noopener")}
                      className="truncate text-left text-sm font-medium text-gray-900 hover:underline"
                      title={r.relPath ?? r.file.name}
                    >
                      {r.file.name}
                    </button>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-gray-500">
                    {formatSize(r.file.size)}
                    {r.relPath && r.relPath !== r.file.name ? ` · ${r.relPath.split(/[\\/]/).slice(0, -1).join(" / ")}` : ""}
                  </p>
                  {r.notes.length > 0 || r.error ? (
                    <ul className="mt-1 space-y-0.5 text-xs">
                      {r.error ? <li className="text-red-700">{r.error}</li> : null}
                      {r.notes.map((n) => (
                        <li key={n} className={r.status === "ready" ? "text-gray-600" : "text-amber-800"}>
                          {n}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="mt-1 flex gap-3 text-xs">
                    {r.status === "duplicate" && r.existingId ? (
                      <a href={`/documents/${r.existingId}`} target="_blank" className="font-medium text-pine-800 hover:underline">
                        Open the copy in Turnrow
                      </a>
                    ) : null}
                    {r.status === "saved" && r.savedId ? (
                      <a href={`/documents/${r.savedId}`} target="_blank" className="font-medium text-pine-800 hover:underline">
                        Open
                      </a>
                    ) : null}
                    {(r.status === "review" || r.status === "failed") && r.notes.some((n) => n.startsWith("Could not be read")) ? (
                      <button type="button" onClick={() => retry(r)} className="font-medium text-pine-800 hover:underline">
                        Read again
                      </button>
                    ) : null}
                    {!locked ? (
                      <button type="button" onClick={() => remove(r)} className="text-gray-500 hover:text-gray-800 hover:underline">
                        Remove
                      </button>
                    ) : null}
                  </div>
                </div>
                {/* type */}
                <div className="col-start-2 md:col-start-auto">
                  <select
                    value={r.docType}
                    disabled={locked}
                    onChange={(e) => patch(r.key, { docType: e.target.value as DocType })}
                    aria-label={`Type of ${r.file.name}`}
                    className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-50"
                  >
                    {DOC_GROUPS.map((g) => (
                      <optgroup key={g} label={DOC_GROUP_LABELS[g]}>
                        {DOC_TYPES_BY_GROUP[g].map((t) => (
                          <option key={t} value={t}>
                            {DOC_TYPE_LABELS[t]}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  {r.result && r.result.doc_type !== r.docType ? (
                    <p className="mt-0.5 text-[11px] text-gray-500">AI said {DOC_TYPE_LABELS[r.result.doc_type]}</p>
                  ) : null}
                </div>
                {/* title */}
                <div className="col-start-2 md:col-start-auto">
                  <input
                    value={r.title}
                    disabled={locked}
                    placeholder={busy ? "Reading..." : "Title"}
                    onChange={(e) => patch(r.key, { title: e.target.value })}
                    aria-label={`Title of ${r.file.name}`}
                    className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-50"
                  />
                </div>
                {/* properties */}
                <div className="col-start-2 min-w-0 md:col-start-auto">
                  <div className="flex flex-wrap items-center gap-1">
                    {r.propertyIds.length === 0 && !busy ? (
                      <span className="text-xs text-amber-800">
                        {isAdmin || context ? "No property (saves as Unfiled)" : "Choose the property this belongs to"}
                      </span>
                    ) : null}
                    {r.propertyIds.map((id) => (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1 rounded-full bg-kelly-50 px-2 py-0.5 text-xs font-medium text-pine-900 ring-1 ring-kelly-200"
                        title={r.suggestions.find((s) => s.propertyId === id)?.reasons.join("; ")}
                      >
                        {propName(id)}
                        {!locked ? (
                          <button
                            type="button"
                            aria-label={`Remove ${propName(id)}`}
                            onClick={() => patch(r.key, { propertyIds: r.propertyIds.filter((x) => x !== id) })}
                            className="text-pine-700 hover:text-pine-900"
                          >
                            ×
                          </button>
                        ) : null}
                      </span>
                    ))}
                    {!locked ? (
                      <button
                        type="button"
                        onClick={() => patch(r.key, { editingProps: !r.editingProps })}
                        className="text-xs font-medium text-pine-800 hover:underline"
                      >
                        {r.editingProps ? "Done" : r.propertyIds.length ? "Change" : "Choose"}
                      </button>
                    ) : null}
                  </div>
                  {r.editingProps && !locked ? (
                    <div className="mt-2">
                      <PropertyMultiSelect
                        compact
                        properties={selectable}
                        selected={r.propertyIds}
                        suggestions={r.suggestions}
                        onChange={(ids) => patch(r.key, { propertyIds: ids, checked: ids.length > 0 ? true : r.checked })}
                      />
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
          {visible.length === 0 ? <li className="px-3 py-6 text-center text-sm text-gray-500">Nothing here.</li> : null}
        </ul>
      </div>

      {/* footer actions */}
      <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center gap-2 border-t border-gray-200 bg-white px-1 py-3">
        <button
          type="button"
          onClick={saveChecked}
          disabled={saving || counts.checked === 0}
          className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-60"
        >
          {saving ? "Saving..." : `Save ${counts.checked.toLocaleString("en-US")} checked`}
        </button>
        <button
          type="button"
          onClick={() => addRef.current?.click()}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Add more files
        </button>
        <input
          ref={addRef}
          type="file"
          multiple
          accept="application/pdf,image/*,.csv,.xlsx,.xls,.doc,.docx"
          className="hidden"
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <span className="ml-auto text-xs text-gray-500">
          {counts.reading > 0 ? "You can review and save rows while the rest are still being read." : null}
        </span>
      </div>
    </div>
  );
}
