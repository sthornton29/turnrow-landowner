"use client";

import { createClient } from "@/lib/supabase/client";
import type { DocumentRow } from "@/types/db";
import DocTypeChip from "./DocTypeChip";

// Read-only clickable list of document rows fetched elsewhere (e.g. a
// stand page showing its linked timber sale's contract). Opens each
// file with a short-lived signed URL; managing documents stays on the
// owning record's page.
export default function DocumentLinks({
  docs,
}: {
  docs: Array<Pick<DocumentRow, "id" | "file_name" | "storage_path"> & { doc_type?: string | null }>;
}) {
  const supabase = createClient();

  async function open(doc: Pick<DocumentRow, "storage_path">) {
    const { data } = await supabase.storage
      .from("documents")
      .createSignedUrl(doc.storage_path, 300);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  }

  if (docs.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1">
      {docs.map((d) => (
        <span key={d.id} className="inline-flex items-center gap-1.5">
          {d.doc_type && d.doc_type !== "other" ? <DocTypeChip docType={d.doc_type} /> : null}
          <button
            onClick={() => open(d)}
            className="text-xs font-medium text-kelly-700 hover:underline"
          >
            {d.file_name}
          </button>
        </span>
      ))}
    </span>
  );
}
