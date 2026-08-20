"use client";

import {
  DOC_GROUP_LABELS,
  DOC_TYPES_BY_GROUP,
  DOC_TYPE_LABELS,
  type DocGroup,
  type DocType,
} from "@/lib/documents";

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
