"use client";

import { DOC_TYPE_GROUP, DOC_TYPE_LABELS, type DocType } from "@/lib/documents";

// Small colored chip naming a document's type; color by taxonomy group.
const GROUP_CLASS: Record<string, string> = {
  title: "bg-amber-50 text-amber-800 border-amber-200",
  survey: "bg-sky-50 text-sky-800 border-sky-200",
  encumbrance: "bg-rose-50 text-rose-800 border-rose-200",
  government: "bg-emerald-50 text-emerald-800 border-emerald-200",
  valuation: "bg-violet-50 text-violet-800 border-violet-200",
  agreements: "bg-indigo-50 text-indigo-800 border-indigo-200",
  other: "bg-gray-100 text-gray-600 border-gray-200",
};

export default function DocTypeChip({
  docType,
  suggested = false,
}: {
  docType: string | null | undefined;
  // An unconfirmed AI suggestion renders amber with a "?" so it never
  // reads as settled.
  suggested?: boolean;
}) {
  const t = (docType ?? "other") as DocType;
  const label = DOC_TYPE_LABELS[t] ?? String(docType ?? "Other");
  const group = (DOC_TYPE_GROUP[t] as string | undefined) ?? "other";
  const cls = suggested
    ? "bg-amber-100 text-amber-900 border-amber-400"
    : (GROUP_CLASS[group] ?? GROUP_CLASS.other);
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}
      title={suggested ? "AI suggestion, not yet confirmed" : undefined}
    >
      {suggested ? "AI: " : ""}
      {label}
      {suggested ? "?" : ""}
    </span>
  );
}
