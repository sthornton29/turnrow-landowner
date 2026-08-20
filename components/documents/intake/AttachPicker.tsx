"use client";

import { useState } from "react";
import type { DocumentEntityType } from "@/types/db";
import { ATTACH_TYPES, type AttachOption, type Draft } from "./types";

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-kelly-500 focus:outline-none";

// Optional: the document also belongs to one specific record (a lease,
// a stand, a parcel...). That record becomes the primary attachment.
export default function AttachPicker({
  draft,
  onChange,
  options,
  load,
}: {
  draft: Draft;
  onChange: (d: Draft) => void;
  options: AttachOption[] | null; // null = not loaded yet
  load: () => void;
}) {
  const [on, setOn] = useState(draft.extra !== null);
  const [type, setType] = useState<DocumentEntityType>(draft.extra?.entityType ?? "parcel");
  const list = (options ?? []).filter((o) => o.entityType === type);
  return (
    <div className="space-y-1.5">
      <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            setOn(e.target.checked);
            if (e.target.checked) load();
            else onChange({ ...draft, extra: null });
          }}
          className="h-4 w-4 accent-kelly-500"
        />
        Also belongs to a specific record (lease, stand, parcel, sale...)
      </label>
      {on ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value as DocumentEntityType);
              onChange({ ...draft, extra: null });
            }}
            className={inputClass}
          >
            {ATTACH_TYPES.map((t) => (
              <option key={t.key} value={t.key}>{t.label}</option>
            ))}
          </select>
          <select
            value={draft.extra?.id ?? ""}
            onChange={(e) => onChange({ ...draft, extra: e.target.value ? { entityType: type, id: e.target.value } : null })}
            className={inputClass}
          >
            <option value="">{options === null ? "Loading..." : "Choose"}</option>
            {list.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </div>
      ) : null}
    </div>
  );
}
