import { DOC_TYPE_GROUP, type DocGroup, type DocType } from "@/lib/documents";

// One small inline icon per taxonomy GROUP, colored like DocTypeChip.
// Cards lead with it so a list of deeds, plats, and FSA forms reads at
// a glance without any headers.
const GROUP_ICON_CLASS: Record<DocGroup, string> = {
  title: "bg-amber-50 text-amber-700",
  survey: "bg-sky-50 text-sky-700",
  encumbrance: "bg-rose-50 text-rose-700",
  government: "bg-emerald-50 text-emerald-700",
  valuation: "bg-violet-50 text-violet-700",
  agreements: "bg-indigo-50 text-indigo-700",
  other: "bg-gray-100 text-gray-500",
};

function Path({ group }: { group: DocGroup }) {
  switch (group) {
    case "title": // document with a seal
      return (
        <>
          <path d="M7 3h7l4 4v14H7z" />
          <path d="M14 3v4h4" />
          <circle cx="12" cy="14" r="2.5" />
          <path d="M10.5 16.5L10 20l2-1 2 1-.5-3.5" />
        </>
      );
    case "survey": // ruler
      return (
        <>
          <path d="M3 17L17 3l4 4L7 21z" />
          <path d="M7 13l2 2M10 10l2 2M13 7l2 2" />
        </>
      );
    case "encumbrance": // lock
      return (
        <>
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 018 0v4" />
        </>
      );
    case "government": // building
      return (
        <>
          <path d="M3 21h18M4 10h16L12 4z" />
          <path d="M6 10v11M10 10v11M14 10v11M18 10v11" />
        </>
      );
    case "valuation": // chart
      return (
        <>
          <path d="M4 20V4" />
          <path d="M4 20h16" />
          <path d="M8 16v-5M12 16V8M16 16v-3" />
        </>
      );
    case "agreements": // pen
      return (
        <>
          <path d="M4 20l4-1 11-11-3-3L5 16z" />
          <path d="M13 7l3 3" />
        </>
      );
    default: // generic file
      return (
        <>
          <path d="M7 3h7l4 4v14H7z" />
          <path d="M14 3v4h4" />
        </>
      );
  }
}

export default function DocTypeIcon({
  docType,
  className = "",
}: {
  docType: string | null | undefined;
  className?: string;
}) {
  const group = DOC_TYPE_GROUP[(docType ?? "other") as DocType] ?? "other";
  return (
    <span
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${GROUP_ICON_CLASS[group]} ${className}`}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <Path group={group} />
      </svg>
    </span>
  );
}
