"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { DocumentEntityType, DocumentRow } from "@/types/db";

function isImage(doc: DocumentRow): boolean {
  return (doc.content_type ?? "").startsWith("image/");
}

// Photos and documents for any entity, stored in the private "documents"
// bucket under <org>/<entity_type>/<uuid>-<filename>. Image files show as a
// gallery; everything else as a file list.
export default function EntityDocuments({
  orgId,
  entityType,
  entityId,
}: {
  orgId: string;
  entityType: DocumentEntityType;
  entityId: string;
}) {
  const supabase = createClient();
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("documents")
      .select("*")
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .order("created_at", { ascending: false });
    const rows = (data as DocumentRow[]) ?? [];
    setDocs(rows);

    // Signed thumbnails for images (bucket is private)
    const images = rows.filter(isImage);
    if (images.length > 0) {
      const { data: signed } = await supabase.storage
        .from("documents")
        .createSignedUrls(images.map((d) => d.storage_path), 3600);
      const map: Record<string, string> = {};
      signed?.forEach((s, i) => {
        if (s.signedUrl) map[images[i].id] = s.signedUrl;
      });
      setThumbs(map);
    } else {
      setThumbs({});
    }
  }, [supabase, entityType, entityId]);

  useEffect(() => {
    load();
  }, [load]);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    for (const file of Array.from(files)) {
      const path = `${orgId}/${entityType}/${crypto.randomUUID()}-${file.name}`;
      const { error: upErr } = await supabase.storage
        .from("documents")
        .upload(path, file, { contentType: file.type || undefined });
      if (upErr) {
        setError(`Could not upload ${file.name}: ${upErr.message}`);
        continue;
      }
      const { error: insErr } = await supabase.from("documents").insert({
        organization_id: orgId,
        entity_type: entityType,
        entity_id: entityId,
        file_name: file.name,
        storage_path: path,
        content_type: file.type || null,
        size_bytes: file.size,
      });
      if (insErr) setError(`Could not save ${file.name}: ${insErr.message}`);
    }
    setBusy(false);
    if (photoInputRef.current) photoInputRef.current.value = "";
    if (fileInputRef.current) fileInputRef.current.value = "";
    load();
  }

  async function open(doc: DocumentRow) {
    const { data } = await supabase.storage
      .from("documents")
      .createSignedUrl(doc.storage_path, 300);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  }

  async function remove(doc: DocumentRow) {
    if (!window.confirm(`Delete ${doc.file_name}?`)) return;
    await supabase.storage.from("documents").remove([doc.storage_path]);
    await supabase.from("documents").delete().eq("id", doc.id);
    load();
  }

  const photos = docs.filter(isImage);
  const files = docs.filter((d) => !isImage(d));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => photoInputRef.current?.click()}
          disabled={busy}
          className="rounded-lg bg-kelly-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-kelly-600 disabled:opacity-60"
        >
          {busy ? "Uploading..." : "Add photo"}
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
        >
          Add document
        </button>
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="hidden"
          onChange={(e) => upload(e.target.files)}
        />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => upload(e.target.files)}
        />
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {photos.length > 0 ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
          {photos.map((doc) => (
            <div key={doc.id} className="group relative">
              <button onClick={() => open(doc)} className="block w-full">
                {thumbs[doc.id] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={thumbs[doc.id]}
                    alt={doc.file_name}
                    className="aspect-square w-full rounded-lg object-cover"
                  />
                ) : (
                  <div className="aspect-square w-full rounded-lg bg-gray-100" />
                )}
              </button>
              <button
                onClick={() => remove(doc)}
                aria-label="Delete photo"
                className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition group-hover:opacity-100"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {files.length > 0 ? (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
          {files.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <button
                onClick={() => open(doc)}
                className="truncate text-left text-sm font-medium text-kelly-700 hover:underline"
              >
                {doc.file_name}
              </button>
              <button
                onClick={() => remove(doc)}
                className="shrink-0 text-xs font-medium text-red-600 hover:underline"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {photos.length === 0 && files.length === 0 ? (
        <p className="text-sm text-gray-500">No photos or documents yet.</p>
      ) : null}
    </div>
  );
}
