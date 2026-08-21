"use client";

import { DOC_TYPE_LABELS, scanKindFor } from "@/lib/documents";
import type { PropertySuggestion, SpatialEvidence } from "@/lib/documentMatch";
import { staticMapUrl } from "@/lib/staticMap";
import { formatAcres } from "@/lib/format";
import type { Geometry } from "geojson";
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
  spatial = null,
  conflict = false,
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
  // The spatial tier's evidence (shown only when the overlap computed).
  spatial?: SpatialEvidence | null;
  conflict?: boolean;
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

      <SpatialEvidenceBlock spatial={spatial} properties={properties} conflict={conflict} />

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

// "Evidence from the description": the resolved reference, the county
// check, and each overlap with the caller's land, plus a small map chip
// of the described tract when the URL fits the Static Images API.
function SpatialEvidenceBlock({
  spatial,
  properties,
  conflict,
}: {
  spatial: SpatialEvidence | null;
  properties: SelectableProperty[];
  conflict: boolean;
}) {
  if (!spatial) return null;
  const computed = spatial.computed === true && Array.isArray(spatial.matches);
  const matches = computed
    ? (spatial.matches ?? []).filter((m) => m.pct_of_described >= 5)
    : [];
  const county = spatial.county_check ?? null;
  const countyFailed = county?.matches === false;
  if (!computed && !countyFailed) return null;
  const mapUrl = computed && spatial.polygon
    ? staticMapUrl(spatial.polygon as Geometry, { width: 320, height: 200 })
    : null;
  const propName = (m: { entity_type: string; id: string; name: string }) =>
    m.entity_type === "property"
      ? (properties.find((p) => p.id === m.id)?.name ?? m.name)
      : `parcel ${m.name}`;
  return (
    <div
      className={
        "rounded-xl border p-3 " +
        (conflict ? "border-amber-300 bg-amber-50" : countyFailed ? "border-red-200 bg-red-50" : "border-kelly-100 bg-kelly-50")
      }
    >
      <p className="text-sm font-medium text-gray-900">Evidence from the description</p>
      {spatial.reference_label ? (
        <p className="mt-0.5 text-xs text-gray-700">
          Describes land in {spatial.reference_label}
          {spatial.described_acres != null ? ` (${formatAcres(spatial.described_acres)} acres described)` : ""}
          {spatial.resolution?.source === "county" ? `; meridian from ${county?.deed ?? "the deed's"} County` : ""}
          {county?.matches === true && county.resolved ? `; county check passed (${county.resolved})` : ""}
        </p>
      ) : null}
      {countyFailed ? (
        <p className="mt-1 text-xs font-medium text-red-800">
          The section resolved to {county?.resolved} County but the deed says {county?.deed}; the description was not used for matching. Check the township and range directions on the plot screen.
        </p>
      ) : null}
      {computed && matches.length === 0 ? (
        <p className="mt-1 text-xs text-gray-700">The described tract does not overlap any of your boundaries.</p>
      ) : null}
      {matches.length > 0 ? (
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-start">
          <ul className="flex-1 space-y-0.5 text-xs text-gray-800">
            {matches.map((m) => (
              <li key={`${m.entity_type}:${m.id}`}>
                Overlaps <span className="font-medium">{propName(m)}</span>: {Math.round(m.pct_of_described)}% of the described area
                {m.overlap_acres ? ` (${formatAcres(m.overlap_acres)} acres)` : ""}
              </li>
            ))}
          </ul>
          {mapUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={mapUrl}
              alt="The described tract"
              className="h-24 w-40 shrink-0 rounded-lg border border-gray-200 object-cover"
            />
          ) : null}
        </div>
      ) : null}
      {conflict ? (
        <p className="mt-2 text-xs font-medium text-amber-900">
          The signals disagree: a parcel or farm number points to one property and the described land overlaps another. Both are listed below with their evidence; pick the right one.
        </p>
      ) : null}
    </div>
  );
}
