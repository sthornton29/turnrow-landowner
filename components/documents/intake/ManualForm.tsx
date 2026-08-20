"use client";

import { DocTypeSelect } from "../DocTypeSelect";
import PropertyMultiSelect, { type SelectableProperty } from "../PropertyMultiSelect";
import ExtractedFieldsEditor from "../ExtractedFieldsEditor";
import { scanKindFor } from "@/lib/documents";
import AttachPicker from "./AttachPicker";
import type { AttachOption, Draft, IntakeContextTarget } from "./types";

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-kelly-500 focus:outline-none";

// The manual path: no AI on screen. Type, properties, an optional
// specific record, a title, and the type's fields typed by hand.
export default function ManualForm({
  draft,
  onChange,
  properties,
  context,
  attachOptions,
  loadAttachOptions,
  message,
}: {
  draft: Draft;
  onChange: (d: Draft) => void;
  properties: SelectableProperty[];
  context: IntakeContextTarget | null;
  attachOptions: AttachOption[] | null;
  loadAttachOptions: () => void;
  message: string | null;
}) {
  const scanKind = scanKindFor(draft.docType);
  return (
    <div className="space-y-3">
      {message ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{message}</p>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Document type</label>
          <DocTypeSelect value={draft.docType} onChange={(t) => onChange({ ...draft, docType: t })} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Title (optional)</label>
          <input
            value={draft.title}
            onChange={(e) => onChange({ ...draft, title: e.target.value })}
            placeholder="e.g. Warranty deed, Smith to Jones, 2014"
            className={inputClass}
          />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          Properties{context?.entityType === "property" ? " (this page's property is included)" : ""}
        </label>
        <PropertyMultiSelect
          properties={properties}
          selected={draft.propertyIds}
          onChange={(ids) => onChange({ ...draft, propertyIds: ids })}
          disabledIds={context?.entityType === "property" ? [context.entityId] : []}
        />
        {draft.propertyIds.length === 0 && !context ? (
          <p className="mt-1 text-xs text-gray-500">
            No property chosen: it will be saved as Unfiled; assign properties any time from the row.
          </p>
        ) : null}
      </div>
      {!context ? (
        <AttachPicker draft={draft} onChange={onChange} options={attachOptions} load={loadAttachOptions} />
      ) : (
        <p className="text-xs text-gray-500">Attached to {context.label}.</p>
      )}
      {scanKind ? (
        <details className="rounded-lg border border-gray-200 p-3">
          <summary className="cursor-pointer text-sm font-medium text-gray-700">Key fields (optional)</summary>
          <div className="mt-2">
            <ExtractedFieldsEditor
              scanKind={scanKind}
              values={draft.values}
              onChange={(v) => onChange({ ...draft, values: v })}
              unsure={new Set()}
            />
          </div>
        </details>
      ) : null}
    </div>
  );
}
