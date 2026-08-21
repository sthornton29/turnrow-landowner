"use client";

import { useEffect, useState } from "react";
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
  preselectedLabel = null,
}: {
  draft: Draft;
  onChange: (d: Draft) => void;
  options: AttachOption[] | null; // null = not loaded yet
  load: () => void;
  // Label for a record proposed before the options loaded (the parcel
  // the description fits), so the select never shows blank.
  preselectedLabel?: string | null;
}) {
  const [on, setOn] = useState(draft.extra !== null);
  const [type, setType] = useState<DocumentEntityType>(draft.extra?.entityType ?? "parcel");
  // A proposal arriving after mount (the AI pass) switches the picker on.
  useEffect(() => {
    if (draft.extra) {
      setOn(true);
      setType(draft.extra.entityType);
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.extra?.id, draft.extra?.entityType]);
  const list = (options ?? []).filter((o) => o.entityType === type);
  const missing = draft.extra && !list.some((o) => o.id === draft.extra!.id);
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
            {missing && draft.extra ? (
              <option value={draft.extra.id}>{preselectedLabel ?? "Proposed record"}</option>
            ) : null}
            {list.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </div>
      ) : null}
    </div>
  );
}
