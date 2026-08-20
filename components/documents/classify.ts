"use client";

// Shared client helpers for the document vault UI: AI type
// classification (always shown as a suggestion the user confirms), the
// property hints that come back with it, and the storage upload + row
// insert + property links pattern every upload path uses.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DocType } from "@/lib/documents";
import type { AiPropertyMatch, PropertyHints } from "@/lib/documentMatch";
import type { DocumentEntityType, DocumentRow } from "@/types/db";

export interface ClassifySuggestion {
  doc_type: DocType;
  confidence: string | null;
  title: string | null;
  reason: string | null;
  property_hints: PropertyHints | null;
  matched_properties: AiPropertyMatch[];
}

// What the classifier is told about the owner's properties so it can
// name which one a document concerns (capped to 200 server-side).
export interface ClassifyContextProperty {
  name: string;
  county: string | null;
  state: string | null;
  parcel_numbers: string[];
  fsa_numbers: string[];
  acres: number | null;
}

// Asks /api/extract kind=classify for a type suggestion plus property
// hints. Never throws: a failed classification simply yields null and
// the user picks everything by hand.
export async function classifyFile(
  file: File,
  context: ClassifyContextProperty[] = []
): Promise<ClassifySuggestion | null> {
  try {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", "classify");
    if (context.length > 0) fd.append("context", JSON.stringify(context.slice(0, 200)));
    const res = await fetch("/api/extract", { method: "POST", body: fd });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      extraction?: Partial<ClassifySuggestion> & {
        property_hints?: PropertyHints | null;
        matched_properties?: AiPropertyMatch[] | null;
      };
    };
    const x = body.extraction;
    if (!x || !x.doc_type) return null;
    return {
      doc_type: x.doc_type,
      confidence: typeof x.confidence === "string" ? x.confidence : null,
      title: x.title ?? null,
      reason: x.reason ?? null,
      property_hints: x.property_hints ?? null,
      matched_properties: Array.isArray(x.matched_properties) ? x.matched_properties : [],
    };
  } catch {
    return null;
  }
}

// Storage-limit failures get a fix-it message instead of the raw error.
export function uploadErrorCopy(fileName: string, message: string): string {
  if (/exceeded the maximum allowed size/i.test(message) || /payload too large/i.test(message)) {
    return `${fileName} is larger than the storage limit. Raise the limit in Supabase (Storage > Settings) or split the PDF; scans work best under 100 pages per file.`;
  }
  return `Could not upload ${fileName}: ${message}`;
}

const LARGE_FILE_BYTES = 30 * 1024 * 1024;

// Non-blocking heads-up for big files (they upload; scans read them in
// page chunks, and the first pages decide the classification).
export function largeFileWarning(file: File | null | undefined): string | null {
  if (!file || file.size <= LARGE_FILE_BYTES) return null;
  const mb = Math.round(file.size / (1024 * 1024));
  return `${file.name} is ${mb} MB. It will upload, but scans read long PDFs in parts and classification looks at the first 20 pages; splitting packets under about 100 pages gives the best results.`;
}

// Files over 6 MB go through Supabase's RESUMABLE upload protocol (tus,
// 6 MB chunks), which is what Storage expects for large objects; the
// plain upload call stays for small files. Returns an error message or
// null.
const RESUMABLE_THRESHOLD = 6 * 1024 * 1024;

export async function uploadToStorage(
  supabase: SupabaseClient,
  path: string,
  file: File
): Promise<string | null> {
  if (file.size <= RESUMABLE_THRESHOLD) {
    const { error } = await supabase.storage
      .from("documents")
      .upload(path, file, { contentType: file.type || undefined });
    return error ? error.message : null;
  }
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return "Not signed in.";
  const { Upload } = await import("tus-js-client");
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return new Promise<string | null>((resolve) => {
    const upload = new Upload(file, {
      endpoint: `${base}/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        authorization: `Bearer ${token}`,
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
        "x-upsert": "false",
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: "documents",
        objectName: path,
        contentType: file.type || "application/octet-stream",
        cacheControl: "3600",
      },
      chunkSize: RESUMABLE_THRESHOLD, // Supabase requires exactly 6 MB chunks
      onError: (err) => resolve(err.message || "Upload failed."),
      onSuccess: () => resolve(null),
    });
    upload.findPreviousUploads().then((previous) => {
      if (previous.length > 0) upload.resumeFromPreviousUpload(previous[0]);
      upload.start();
    });
  });
}

export async function uploadDocument(
  supabase: SupabaseClient,
  args: {
    orgId: string;
    entityType: DocumentEntityType;
    entityId: string;
    file: File;
    docType: DocType;
    title: string | null;
    aiSuggestedType: DocType | null;
    // Every property the document applies to (migration 0023). When the
    // primary entity is a property it is included automatically.
    propertyIds?: string[];
  }
): Promise<{ id: string } | { error: string }> {
  const path = `${args.orgId}/${args.entityType}/${crypto.randomUUID()}-${args.file.name}`;
  const upErr = await uploadToStorage(supabase, path, args.file);
  if (upErr) return { error: uploadErrorCopy(args.file.name, upErr) };
  const { data, error: insErr } = await supabase
    .from("documents")
    .insert({
      organization_id: args.orgId,
      entity_type: args.entityType,
      entity_id: args.entityId,
      file_name: args.file.name,
      storage_path: path,
      content_type: args.file.type || null,
      size_bytes: args.file.size,
      doc_type: args.docType,
      title: args.title,
      ai_suggested_type: args.aiSuggestedType,
    })
    .select("id")
    .single();
  if (insErr || !data) return { error: `Could not save ${args.file.name}: ${insErr?.message ?? ""}` };
  const id = data.id as string;
  const ids = new Set(args.propertyIds ?? []);
  if (args.entityType === "property") ids.add(args.entityId);
  if (ids.size > 0) {
    const { error: linkErr } = await supabase.from("document_properties").insert(
      [...ids].map((property_id) => ({
        organization_id: args.orgId,
        document_id: id,
        property_id,
      }))
    );
    if (linkErr) return { error: `Saved ${args.file.name} but could not link properties: ${linkErr.message}` };
  }
  return { id };
}

// Replace a document's property links with exactly `propertyIds`. If the
// primary attachment is a property that is no longer in the list, the
// primary moves to the first remaining property.
export async function setDocumentProperties(
  supabase: SupabaseClient,
  doc: Pick<DocumentRow, "id" | "organization_id" | "entity_type" | "entity_id">,
  propertyIds: string[]
): Promise<string | null> {
  const want = [...new Set(propertyIds)];
  const { data: existing, error: readErr } = await supabase
    .from("document_properties")
    .select("id, property_id")
    .eq("document_id", doc.id);
  if (readErr) return readErr.message;
  const have = new Set((existing ?? []).map((r) => r.property_id as string));
  const toAdd = want.filter((p) => !have.has(p));
  const toRemove = (existing ?? []).filter((r) => !want.includes(r.property_id as string));
  if (toAdd.length > 0) {
    const { error } = await supabase.from("document_properties").insert(
      toAdd.map((property_id) => ({ organization_id: doc.organization_id, document_id: doc.id, property_id }))
    );
    if (error) return error.message;
  }
  if (toRemove.length > 0) {
    const { error } = await supabase
      .from("document_properties")
      .delete()
      .in("id", toRemove.map((r) => r.id as string));
    if (error) return error.message;
  }
  // Primary attachment follows the list: an unfiled document becomes
  // attached to the first chosen property; a property-attached document
  // whose property left the list moves to another, or back to Unfiled
  // (entity_type organization, migration 0024) when none remain.
  if (doc.entity_type === "organization" && want.length > 0) {
    const { error } = await supabase
      .from("documents")
      .update({ entity_type: "property", entity_id: want[0] })
      .eq("id", doc.id);
    if (error) return error.message;
  } else if (doc.entity_type === "property" && !want.includes(doc.entity_id)) {
    const patch =
      want.length > 0
        ? { entity_type: "property", entity_id: want[0] }
        : { entity_type: "organization", entity_id: doc.organization_id };
    const { error } = await supabase.from("documents").update(patch).eq("id", doc.id);
    if (error) return error.message;
  }
  return null;
}

// Remove a document from ONE property (keeps the file and its other
// links); re-points the primary attachment when needed.
export async function removeDocumentFromProperty(
  supabase: SupabaseClient,
  doc: Pick<DocumentRow, "id" | "organization_id" | "entity_type" | "entity_id">,
  propertyId: string,
  linkedPropertyIds: string[]
): Promise<string | null> {
  const remaining = linkedPropertyIds.filter((p) => p !== propertyId);
  return setDocumentProperties(supabase, doc, remaining);
}

export async function deleteDocumentEverywhere(
  supabase: SupabaseClient,
  doc: Pick<DocumentRow, "id" | "storage_path">
): Promise<string | null> {
  await supabase.storage.from("documents").remove([doc.storage_path]);
  const { error } = await supabase.from("documents").delete().eq("id", doc.id);
  return error ? error.message : null;
}

export async function openDocument(
  supabase: SupabaseClient,
  storagePath: string
): Promise<void> {
  const { data } = await supabase.storage.from("documents").createSignedUrl(storagePath, 300);
  if (data?.signedUrl) window.open(data.signedUrl, "_blank");
}
