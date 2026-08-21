"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { type DocType } from "@/lib/documents";
import { displayTitle } from "@/lib/documentTitle";
import type { DocumentEntityType, DocumentRow } from "@/types/db";
import DocTypeChip from "./DocTypeChip";
import { deleteDocumentEverywhere, uploadDocument } from "./classify";
import type { SelectableProperty } from "./PropertyMultiSelect";
import IntakeFlow from "./intake/IntakeFlow";
import { DocTypeSelect } from "./DocTypeSelect";

export { DocTypeSelect };

function isImage(doc: DocumentRow): boolean {
  return (doc.content_type ?? "").startsWith("image/");
}

// Photos and documents for any entity, stored in the private "documents"
// bucket under <org>/<entity_type>/<uuid>-<filename>. Image files show as a
// gallery; everything else as a calm list of rows, each one a link to the
// document's page (type, properties, fields, rescans, replace, delete all
// live there). "Add document" opens the AI-first intake flow with THIS
// record as the default attachment. Asset pages keep a quick "Add
// photos" path for gallery photos (no reading).
export default function EntityDocuments({
  orgId,
  entityType,
  entityId,
  label,
}: {
  orgId: string;
  entityType: DocumentEntityType;
  entityId: string;
  label?: string; // what the intake shows as "Adding to ..."
}) {
  const supabase = createClient();
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  // document id -> every property it is linked to (migration 0023).
  const [linksByDoc, setLinksByDoc] = useState<Record<string, string[]>>({});
  const [allProperties, setAllProperties] = useState<SelectableProperty[]>([]);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const isProperty = entityType === "property";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  // The property this record sits on (for the intake's default links).
  const [contextPropertyId, setContextPropertyId] = useState<string | null>(
    entityType === "property" ? entityId : null
  );
  const [contextLabel, setContextLabel] = useState<string>(label ?? "");

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("documents")
      .select("*")
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .order("created_at", { ascending: false });
    let rows = (data as DocumentRow[]) ?? [];
    if (isProperty) {
      // Documents linked to this property through document_properties
      // (primary attachment elsewhere), merged and deduped.
      const { data: linkRows } = await supabase
        .from("document_properties")
        .select("document_id")
        .eq("property_id", entityId);
      const ids = (linkRows ?? []).map((l) => l.document_id as string).filter((id) => !rows.some((r) => r.id === id));
      if (ids.length > 0) {
        const { data: more } = await supabase.from("documents").select("*").in("id", ids);
        rows = [...rows, ...((more as DocumentRow[]) ?? [])].sort((a, b) =>
          b.created_at.localeCompare(a.created_at)
        );
      }
      const docIds = rows.map((r) => r.id);
      const [{ data: allLinks }, { data: props }] = await Promise.all([
        docIds.length > 0
          ? supabase.from("document_properties").select("document_id, property_id").in("document_id", docIds)
          : Promise.resolve({ data: [] as Array<{ document_id: string; property_id: string }> }),
        supabase.from("properties").select("id, name, county, state").order("name"),
      ]);
      const byDoc: Record<string, string[]> = {};
      for (const l of (allLinks ?? []) as Array<{ document_id: string; property_id: string }>) {
        byDoc[l.document_id] = [...(byDoc[l.document_id] ?? []), l.property_id];
      }
      for (const r of rows) {
        const set = new Set(byDoc[r.id] ?? []);
        if (r.entity_type === "property") set.add(r.entity_id);
        byDoc[r.id] = [...set];
      }
      setLinksByDoc(byDoc);
      setAllProperties((props as SelectableProperty[]) ?? []);
    }
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
  }, [supabase, entityType, entityId, isProperty]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (entityType === "property" || entityType === "organization") return;
    const table: Partial<Record<DocumentEntityType, string>> = {
      parcel: "parcels", field: "fields", pasture: "pastures", wetland: "wetlands",
      timber_stand: "timber_stands", road: "roads", easement: "easements", asset: "assets",
    };
    const t = table[entityType];
    if (!t) return;
    supabase
      .from(t)
      .select("property_id, name")
      .eq("id", entityId)
      .maybeSingle()
      .then(({ data }) => {
        const row = data as { property_id?: string | null; name?: string | null } | null;
        setContextPropertyId(row?.property_id ?? null);
        if (!label && row?.name) setContextLabel(row.name);
      });
  }, [supabase, entityType, entityId, label]);

  // Quick gallery photos (asset pages): stored as-is, typed other, no
  // reading. Documents go through the intake flow.
  async function uploadPhotos(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    for (const file of Array.from(files)) {
      const result = await uploadDocument(supabase, {
        orgId,
        entityType,
        entityId,
        file,
        docType: "other",
        title: null,
        aiSuggestedType: null,
        propertyIds: [],
      });
      if ("error" in result) setError(result.error);
    }
    setBusy(false);
    if (photoInputRef.current) photoInputRef.current.value = "";
    load();
  }

  // Photo delete (gallery only; documents are deleted from their page).
  async function removePhoto(doc: DocumentRow) {
    if (!window.confirm(`Delete ${displayTitle(doc)}?`)) return;
    const err = await deleteDocumentEverywhere(supabase, doc);
    if (err) setError("Could not delete. " + err);
    load();
  }

  const photos = docs.filter(isImage);
  const files = docs.filter((d) => !isImage(d));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setIntakeOpen(true)}
          className="rounded-lg bg-kelly-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-kelly-600"
        >
          Add document
        </button>
        {entityType === "asset" ? (
          <>
            <button
              onClick={() => photoInputRef.current?.click()}
              disabled={busy}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              {busy ? "Uploading..." : "Add photos"}
            </button>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="hidden"
              onChange={(e) => uploadPhotos(e.target.files)}
            />
          </>
        ) : null}
      </div>

      {intakeOpen ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-0 md:items-center md:p-6">
          <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl md:max-w-5xl md:rounded-2xl md:p-6">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Add a document</h2>
                <p className="text-xs text-gray-500">Drop the file, confirm what was read, save. Nothing is stored until you confirm.</p>
              </div>
              <button
                onClick={() => setIntakeOpen(false)}
                aria-label="Close"
                className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <IntakeFlow
              orgId={orgId}
              context={{
                entityType,
                entityId,
                label: contextLabel || "this record",
                propertyId: contextPropertyId,
              }}
              onSaved={() => load()}
              onClose={() => setIntakeOpen(false)}
            />
          </div>
        </div>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {photos.length > 0 ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
          {photos.map((doc) => (
            <div key={doc.id} className="group relative">
              <Link href={`/documents/${doc.id}`} className="block w-full">
                {thumbs[doc.id] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={thumbs[doc.id]}
                    alt={displayTitle(doc)}
                    className="aspect-square w-full rounded-lg object-cover"
                  />
                ) : (
                  <div className="aspect-square w-full rounded-lg bg-gray-100" />
                )}
              </Link>
              <button
                onClick={() => removePhoto(doc)}
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
          {files.map((doc) => {
            const docType = (doc.doc_type ?? "other") as DocType;
            return (
              <li key={doc.id}>
                <Link href={`/documents/${doc.id}`} className="block space-y-1 px-3 py-2.5 hover:bg-kelly-50/40">
                  <div className="flex flex-wrap items-center gap-2">
                    <DocTypeChip docType={docType} />
                    <span className="min-w-0 truncate text-sm font-medium text-gray-900">{displayTitle(doc)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                    {isProperty
                      ? (linksByDoc[doc.id] ?? []).map((pid) => (
                          <span
                            key={pid}
                            className={
                              "rounded-full px-2 py-0.5 font-medium " +
                              (pid === entityId ? "bg-kelly-100 text-pine-900" : "bg-gray-100 text-gray-700")
                            }
                          >
                            {allProperties.find((p) => p.id === pid)?.name ?? "Property"}
                          </span>
                        ))
                      : null}
                    <span>{new Date(doc.created_at).toLocaleDateString()}</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}

      {photos.length === 0 && files.length === 0 ? (
        <p className="text-sm text-gray-500">No photos or documents yet.</p>
      ) : null}
    </div>
  );
}
