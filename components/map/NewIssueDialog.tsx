"use client";

import { useState } from "react";
import { formatAcres } from "@/lib/format";
import {
  GEOMETRY_KIND_LABELS,
  ISSUE_TYPE_LABELS,
  SEVERITY_LABELS,
  issueValid,
  type IssueGeometryKind,
  type IssueSeverity,
  type IssueType,
} from "@/lib/maintenance";
import type { PropertyGeo } from "@/types/db";

export interface NewIssuePayload {
  issueType: IssueType;
  label: string | null;
  notes: string | null;
  severity: IssueSeverity | null;
  propertyId: string | null;
}

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none";
const labelClass = "mb-1 block text-sm font-medium text-gray-700";

// Save form for a maintenance issue after its pin, line, or area is on
// the map. The type was picked up front; "Other" needs a label.
export default function NewIssueDialog({
  issueType,
  shape,
  approxAcres = null,
  properties,
  suggestedPropertyId = null,
  saving,
  error,
  onSave,
  onCancel,
}: {
  issueType: IssueType;
  shape: IssueGeometryKind;
  approxAcres?: number | null;
  properties: PropertyGeo[];
  suggestedPropertyId?: string | null;
  saving: boolean;
  error: string | null;
  onSave: (payload: NewIssuePayload) => void;
  onCancel: () => void;
}) {
  const [propertyId, setPropertyId] = useState(suggestedPropertyId ?? "");
  const [severity, setSeverity] = useState<IssueSeverity | "">("");
  const [label, setLabel] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    const problem = issueValid({ issue_type: issueType, label });
    if (problem) {
      setLocalError(problem);
      return;
    }
    setLocalError(null);
    onSave({
      issueType,
      label: label.trim() || null,
      notes: String(formData.get("notes") ?? "").trim() || null,
      severity: severity || null,
      propertyId: propertyId || null,
    });
  }

  return (
    <div className="pointer-events-auto fixed inset-x-0 bottom-16 z-30 max-h-[70%] overflow-y-auto rounded-t-2xl border-t border-amber-200 bg-white p-4 shadow-2xl md:absolute md:inset-auto md:right-4 md:top-4 md:bottom-auto md:w-80 md:rounded-xl md:border">
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Needs attention</p>
      <h2 className="text-lg font-semibold text-gray-900">
        Save {ISSUE_TYPE_LABELS[issueType].toLowerCase()} ({GEOMETRY_KIND_LABELS[shape].toLowerCase()})
      </h2>
      {shape === "area" && approxAcres !== null ? (
        <p className="mt-0.5 text-sm text-gray-500">About {formatAcres(approxAcres)} acres</p>
      ) : null}

      <form action={handleSubmit} className="mt-3 space-y-3">
        <div>
          <label className={labelClass}>
            Label{issueType === "other" ? "" : " (optional)"}
          </label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            required={issueType === "other"}
            autoFocus
            placeholder={issueType === "other" ? "What is wrong" : "Where or what, in a few words"}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Severity</label>
          <div className="grid grid-cols-4 gap-1.5">
            {([["", "None"], ["low", SEVERITY_LABELS.low], ["medium", SEVERITY_LABELS.medium], ["high", SEVERITY_LABELS.high]] as Array<[IssueSeverity | "", string]>).map(([k, l]) => (
              <button
                key={k || "none"}
                type="button"
                onClick={() => setSeverity(k)}
                className={
                  "rounded-lg border px-2 py-1.5 text-xs font-medium " +
                  (severity === k
                    ? k === "high"
                      ? "border-red-400 bg-red-50 text-red-800"
                      : k === ""
                        ? "border-gray-400 bg-gray-100 text-gray-800"
                        : "border-amber-400 bg-amber-50 text-amber-900"
                    : "border-gray-300 text-gray-600 hover:bg-gray-50")
                }
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className={labelClass}>Notes</label>
          <textarea name="notes" rows={2} placeholder="Optional" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>
            Property (optional)
            {suggestedPropertyId && propertyId === suggestedPropertyId ? (
              <span className="ml-1.5 rounded-full bg-kelly-100 px-2 py-0.5 text-[10px] font-medium text-kelly-700">
                Suggested from location
              </span>
            ) : null}
          </label>
          <select
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
            className={inputClass}
          >
            <option value="">None</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {localError || error ? <p className="text-sm text-red-600">{localError ?? error}</p> : null}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save issue"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Discard
          </button>
        </div>
      </form>
    </div>
  );
}
