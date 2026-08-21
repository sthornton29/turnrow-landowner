"use client";

import Link from "next/link";
import type { DocumentRow } from "@/types/db";
import { displayTitle } from "@/lib/documentTitle";
import DocTypeChip from "./DocTypeChip";

// Read-only list of document rows fetched elsewhere (e.g. a stand page
// showing its linked timber sale's contract). Each one opens the
// document's page; the file itself is one tap further (Download).
export default function DocumentLinks({
  docs,
}: {
  docs: Array<Pick<DocumentRow, "id" | "file_name"> & { title?: string | null; doc_type?: string | null }>;
}) {
  if (docs.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1">
      {docs.map((d) => (
        <span key={d.id} className="inline-flex items-center gap-1.5">
          {d.doc_type && d.doc_type !== "other" ? <DocTypeChip docType={d.doc_type} /> : null}
          <Link href={`/documents/${d.id}`} className="text-xs font-medium text-kelly-700 hover:underline">
            {displayTitle({ title: d.title ?? null, file_name: d.file_name })}
          </Link>
        </span>
      ))}
    </span>
  );
}
