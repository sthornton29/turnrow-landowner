"use client";

import { DOC_TYPE_LABELS, scanKindFor } from "@/lib/documents";
import type { PropertySuggestion } from "@/lib/documentMatch";
import { DocTypeSelect } from "../DocTypeSelect";
import PropertyMultiSelect, { type SelectableProperty } from "../PropertyMultiSelect";
import ExtractedFieldsEditor from "../ExtractedFieldsEditor";
import type { IntakeResult } from "../classify";
import AttachPicker from "./AttachPicker";
import type { AttachOption, Draft, IntakeContextTarget } from "./types";

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-kelly-500 focus:outline-none";

// Step 2: everything the AI found, editable, nothing saved yet. The
// type with its confidence, the verified property matches with their
// why lines (unverified claims are not shown), the entity line, the
// type's fields (amber where unsure), title, and the optional record.
export default function ConfirmScreen({
  result,
  draft,
  onChange,
  properties,
  suggestions,
  entityWhy,
  entityName,
  context,
  mismatch,
  onSwitchToMatch,
  onKeepBoth,
  attachOptions,
  loadAttachOptions,
}: {
  result: IntakeResult;
  draft: Draft;
  onChange: (d: Draft) => void;
  properties: SelectableProperty[];
  suggestions: PropertySuggestion[];
  entityWhy: string | null;
  entityName: string | null;
  context: IntakeContextTarget | null;
  // Context-aware entry: the AI's verified evidence points elsewhere.
  mismatch: { propertyId: string; name: string; why: string } | null;
  onSwitchToMatch: () => void;
  onKeepBoth: () => void;
  attachOptions: AttachOption[] | null;
  loadAttachOptions: () => void;
}) {
  const scanKind = scanKindFor(draft.docType);
  const unsure = new Set(result.unsure_fields);
  const conf = result.confidence ?? "low";
  const confCopy =
    conf === "high" ? "confident" : conf === "medium" ? "fairly confident" : "not very confident";
  const typeChanged = draft.docType !== result.doc_type;

  return (
    <div className="space-y-4">
      {mismatch ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-medium text-amber-900">
            This {DOC_TYPE_LABELS[draft.docType].toLowerCase()} appears to describe {mismatch.name}.
          </p>
          <p className="mt-0.5 text-xs text-amber-900/80">{mismatch.why}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onSwitchToMatch}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-700"
            >
              Switch to {mismatch.name}
            </button>
            <button
              type="button"
              onClick={onKeepBoth}
              className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100"
            >
              Attach to both
            </button>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Document type</label>
          <DocTypeSelect value={draft.docType} onChange={(t) => onChange({ ...draft, docType: t })} className={inputClass} />
          <p className="mt-1 text-xs text-gray-500">
            {typeChanged
              ? `AI read it as ${DOC_TYPE_LABELS[result.doc_type]}; you changed it.`
              : `AI is ${confCopy}${result.reason ? `: ${result.reason}` : "."}`}
          </p>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Title</label>
          <input
            value={draft.title}
            onChange={(e) => onChange({ ...draft, title: e.target.value })}
            placeholder="A short title"
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          Properties
          {context?.entityType === "property" ? (
            <span className="ml-1 font-normal text-gray-500">(this page's property is the default)</span>
          ) : null}
        </label>
        {suggestions.length === 0 && !context ? (
          <p className="mb-1 text-xs text-gray-500">
            Nothing on the page tied to one of your properties with confidence; pick below, or leave empty to file it as Unfiled.
          </p>
        ) : null}
        <PropertyMultiSelect
          properties={properties}
          selected={draft.propertyIds}
          onChange={(ids) => onChange({ ...draft, propertyIds: ids })}
          suggestions={suggestions}
          disabledIds={context?.entityType === "property" && !mismatch ? [context.entityId] : []}
        />
      </div>

      {entityName ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={draft.entityId !== null}
              onChange={(e) => onChange({ ...draft, entityId: e.target.checked ? (draft.entityId ?? "__set") : null })}
              className="h-4 w-4 accent-kelly-500"
            />
            <span className="font-medium text-gray-900">Entity: {entityName}</span>
          </label>
          {entityWhy ? <span className="text-xs text-gray-600">{entityWhy}</span> : null}
        </div>
      ) : null}

      {context ? (
        <p className="text-xs text-gray-500">Attached to {context.label}{context.entityType !== "property" ? " (this page)" : ""}.</p>
      ) : (
        <AttachPicker draft={draft} onChange={onChange} options={attachOptions} load={loadAttachOptions} />
      )}

      {scanKind ? (
        <div>
          <p className="mb-1 text-sm font-medium text-gray-700">
            What was read
            <span className="ml-1 font-normal text-gray-500">(amber = unsure; edit anything)</span>
          </p>
          <ExtractedFieldsEditor
            scanKind={scanKind}
            values={draft.values}
            onChange={(v) => onChange({ ...draft, values: v })}
            unsure={unsure}
            meta={{ pages_scanned: result.pages_scanned, total_pages: result.total_pages, chunks: result.chunks }}
          />
          {result.total_pages && result.pages_scanned && result.total_pages > result.pages_scanned && scanKind !== "fsa_156ez" ? (
            <p className="mt-1 text-xs text-gray-500">
              The first {result.pages_scanned} of {result.total_pages} pages were read.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
