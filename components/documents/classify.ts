"use client";

// Shared client helpers for the document vault UI: AI type
// classification (always shown as a suggestion the user confirms), the
// property hints that come back with it, and the storage upload + row
// insert + property links pattern every upload path uses.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DocType } from "@/lib/documents";
import type { AiEntityMatch, AiPropertyMatch, PropertyHints, SpatialEvidence } from "@/lib/documentMatch";
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
  // Historical names deeds use for the tract (property_aliases).
  aliases?: string[];
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

// Classification of a document already in storage (the bulk re-type),
// by path: nothing travels through the request body.
export async function classifyStored(
  doc: Pick<DocumentRow, "storage_path" | "file_name" | "content_type">
): Promise<ClassifySuggestion | null> {
  const res = await extractStored({
    storagePath: doc.storage_path,
    fileName: doc.file_name,
    contentType: doc.content_type ?? "application/pdf",
    kind: "classify",
  });
  if ("error" in res) return null;
  const x = res.extraction as Partial<ClassifySuggestion>;
  if (!x.doc_type) return null;
  return {
    doc_type: x.doc_type,
    confidence: typeof x.confidence === "string" ? x.confidence : null,
    title: x.title ?? null,
    reason: x.reason ?? null,
    property_hints: x.property_hints ?? null,
    matched_properties: Array.isArray(x.matched_properties) ? x.matched_properties : [],
  };
}

// The one-pass intake result (kind=intake): type, key fields, and
// association claims the client verifies before showing as found.
export interface IntakeResult {
  doc_type: DocType;
  confidence: string | null;
  title: string | null;
  reason: string | null;
  specialized_kind: string | null;
  property_hints: PropertyHints | null;
  matched_properties: AiPropertyMatch[];
  matched_entity: AiEntityMatch | null;
  fields: Record<string, unknown>;
  unsure_fields: string[];
  spatial?: SpatialEvidence | null;
  // The raw references the reader returned, kept so the spatial tier
  // can be re-run (Retry) without another model call.
  plss_reference?: Record<string, unknown> | null;
  plss_references?: Array<Record<string, unknown>> | null;
  mb_anchor?: Record<string, unknown> | null;
  pages_scanned?: number;
  total_pages?: number;
  chunks?: number;
}

export interface IntakeContext {
  properties: ClassifyContextProperty[];
  entities: Array<{ name: string; aliases: string[] }>;
}

// Runs the intake pass. Returns { result } or { error } (never throws):
// the flow drops into the manual form on any error, including 429.
// The file is ALREADY in storage when this runs (uploaded first, by
// path), so the server pulls it itself and the request body stays tiny
// regardless of document size (Vercel caps request bodies at 4.5 MB).
export async function intakeFile(
  stored: { storagePath: string; fileName: string; contentType: string },
  context: IntakeContext
): Promise<{ result: IntakeResult } | { error: string }> {
  try {
    const fd = new FormData();
    fd.append("storage_path", stored.storagePath);
    fd.append("file_name", stored.fileName);
    fd.append("content_type", stored.contentType);
    fd.append("kind", "intake");
    fd.append(
      "context",
      JSON.stringify({
        properties: context.properties.slice(0, 200),
        entities: context.entities.slice(0, 200),
      })
    );
    const res = await fetch("/api/extract", { method: "POST", body: fd });
    const body = (await res.json().catch(() => ({}))) as {
      extraction?: Partial<IntakeResult>;
      error?: string;
    };
    if (res.status === 429) {
      return { error: body.error ?? "The reader is busy for a few minutes. Fill in the details by hand, or try again later." };
    }
    if (!res.ok || !body.extraction || !body.extraction.doc_type) {
      return { error: body.error ?? "We could not read this file. Fill in the details by hand." };
    }
    const x = body.extraction;
    return {
      result: {
        doc_type: x.doc_type as DocType,
        confidence: typeof x.confidence === "string" ? x.confidence : null,
        title: x.title ?? null,
        reason: x.reason ?? null,
        specialized_kind: typeof x.specialized_kind === "string" ? x.specialized_kind : null,
        property_hints: x.property_hints ?? null,
        matched_properties: Array.isArray(x.matched_properties) ? x.matched_properties : [],
        matched_entity: x.matched_entity ?? null,
        fields: (x.fields && typeof x.fields === "object" ? x.fields : {}) as Record<string, unknown>,
        spatial: ((x as { spatial?: SpatialEvidence | null }).spatial ?? null),
        plss_reference: (x.plss_reference as Record<string, unknown> | null | undefined) ?? null,
        plss_references: Array.isArray(x.plss_references) ? (x.plss_references as Array<Record<string, unknown>>) : null,
        mb_anchor: (x.mb_anchor as Record<string, unknown> | null | undefined) ?? null,
        unsure_fields: Array.isArray(x.unsure_fields) ? x.unsure_fields.map(String) : [],
        pages_scanned: typeof x.pages_scanned === "number" ? x.pages_scanned : undefined,
        total_pages: typeof x.total_pages === "number" ? x.total_pages : undefined,
        chunks: typeof x.chunks === "number" ? x.chunks : undefined,
      },
    };
  } catch {
    return { error: "We could not read this file. Fill in the details by hand." };
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
    // Why the AI attached a property (shown on the document page).
    evidence?: Record<string, string>;
    // Reviewed extracted fields from the intake confirm screen (saved as
    // already reviewed, with scan_kind for the row's Extracted block).
    extracted?: Record<string, unknown> | null;
    // When the intake flow already uploaded the file (to read it by
    // path), reuse that object instead of uploading again.
    storagePath?: string | null;
  }
): Promise<{ id: string } | { error: string }> {
  const path =
    args.storagePath ??
    `${args.orgId}/${args.entityType}/${crypto.randomUUID()}-${args.file.name}`;
  if (!args.storagePath) {
    const upErr = await uploadToStorage(supabase, path, args.file);
    if (upErr) return { error: uploadErrorCopy(args.file.name, upErr) };
  }
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
      title_reviewed: true,
      ai_suggested_type: args.aiSuggestedType,
      ...(args.extracted
        ? {
            extracted: args.extracted,
            extracted_at: new Date().toISOString(),
            extraction_reviewed: true,
            extraction_history: [{ at: new Date().toISOString(), kind: "intake" }],
          }
        : {}),
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
        evidence: args.evidence?.[property_id] ?? null,
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

// Delete the row, its current file, and every superseded version's file
// (document_versions, migration 0028; the rows cascade with the document).
export async function deleteDocumentEverywhere(
  supabase: SupabaseClient,
  doc: Pick<DocumentRow, "id" | "storage_path">
): Promise<string | null> {
  const { data: versions } = await supabase
    .from("document_versions")
    .select("storage_path")
    .eq("document_id", doc.id);
  const paths = [doc.storage_path, ...((versions ?? []).map((v) => v.storage_path as string))];
  await supabase.storage.from("documents").remove(paths);
  const { error } = await supabase.from("documents").delete().eq("id", doc.id);
  return error ? error.message : null;
}

// Inline rename (list cards, the document page, the backfill review).
// A saved title counts as reviewed.
export async function renameDocument(
  supabase: SupabaseClient,
  documentId: string,
  title: string
): Promise<string | null> {
  const t = title.trim();
  if (!t) return "A title is needed.";
  const { error } = await supabase
    .from("documents")
    .update({ title: t, title_reviewed: true })
    .eq("id", documentId);
  return error ? error.message : null;
}

// Replace file: upload the new object, park the old one as a version
// (kept and downloadable), and point the row at the new file. The
// record, links, extracted fields, and notes all stay.
export async function replaceDocumentFile(
  supabase: SupabaseClient,
  doc: Pick<
    DocumentRow,
    "id" | "organization_id" | "entity_type" | "storage_path" | "file_name" | "content_type" | "size_bytes" | "uploaded_by" | "created_at"
  >,
  file: File
): Promise<string | null> {
  const path = `${doc.organization_id}/${doc.entity_type}/${crypto.randomUUID()}-${file.name}`;
  const upErr = await uploadToStorage(supabase, path, file);
  if (upErr) return uploadErrorCopy(file.name, upErr);
  const { data: prior } = await supabase
    .from("document_versions")
    .select("id")
    .eq("document_id", doc.id);
  const { error: verErr } = await supabase.from("document_versions").insert({
    organization_id: doc.organization_id,
    document_id: doc.id,
    storage_path: doc.storage_path,
    file_name: doc.file_name,
    content_type: doc.content_type,
    size_bytes: doc.size_bytes,
    uploaded_by: doc.uploaded_by,
    // The first replacement parks the original upload date; later ones
    // carry the date the version being replaced was put in place.
    uploaded_at: (prior ?? []).length === 0 ? doc.created_at : new Date().toISOString(),
  });
  if (verErr) return verErr.message;
  const { error } = await supabase
    .from("documents")
    .update({
      storage_path: path,
      file_name: file.name,
      content_type: file.type || null,
      size_bytes: file.size,
    })
    .eq("id", doc.id);
  return error ? error.message : null;
}

// Append a dated entry to extraction_history (dates only, for the page
// footer). Best effort: a failure here never blocks the save.
export async function recordExtraction(
  supabase: SupabaseClient,
  documentId: string,
  kind: string
): Promise<void> {
  const { data } = await supabase
    .from("documents")
    .select("extraction_history")
    .eq("id", documentId)
    .single();
  const history = Array.isArray(data?.extraction_history) ? (data!.extraction_history as unknown[]) : [];
  await supabase
    .from("documents")
    .update({ extraction_history: [...history, { at: new Date().toISOString(), kind }] })
    .eq("id", documentId);
}

export async function openDocument(
  supabase: SupabaseClient,
  storagePath: string
): Promise<void> {
  const { data } = await supabase.storage.from("documents").createSignedUrl(storagePath, 300);
  if (data?.signedUrl) window.open(data.signedUrl, "_blank");
}

// Storage path for a file read by the intake before its row exists.
export function intakeStoragePath(orgId: string, file: File): string {
  return `${orgId}/intake/${crypto.randomUUID()}-${file.name}`;
}

// Every extraction goes BY STORAGE PATH: the browser uploads the file
// straight to storage (resumable over 6 MB) and the route pulls it
// under the caller's session, so the request body never carries the
// document and Vercel's 4.5 MB body limit ("Request Entity Too Large",
// which comes back as HTML, not JSON) cannot be hit. Returns the
// extraction and the path so the caller can keep the object as the
// attached document instead of uploading twice.
export async function extractFile(
  supabase: SupabaseClient,
  args: { orgId: string; file: File; kind: string }
): Promise<{ extraction: Record<string, unknown>; storagePath: string } | { error: string }> {
  const path = intakeStoragePath(args.orgId, args.file);
  const upErr = await uploadToStorage(supabase, path, args.file);
  if (upErr) return { error: uploadErrorCopy(args.file.name, upErr) };
  const res = await extractStored({
    storagePath: path,
    fileName: args.file.name,
    contentType: args.file.type || "application/pdf",
    kind: args.kind,
  });
  if ("error" in res) return res;
  return { extraction: res.extraction, storagePath: path };
}

// Extraction of a file already in the documents bucket (a saved
// document's rescan, the plot screen, the bulk re-type).
export async function extractStored(args: {
  storagePath: string;
  fileName: string;
  contentType: string;
  kind: string;
  extra?: Record<string, string>;
}): Promise<{ extraction: Record<string, unknown> } | { error: string }> {
  try {
    const fd = new FormData();
    fd.append("storage_path", args.storagePath);
    fd.append("file_name", args.fileName);
    fd.append("content_type", args.contentType);
    fd.append("kind", args.kind);
    for (const [k, v] of Object.entries(args.extra ?? {})) fd.append(k, v);
    const res = await fetch("/api/extract", { method: "POST", body: fd });
    const text = await res.text();
    let body: { extraction?: Record<string, unknown>; error?: string } = {};
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      // An HTML error page from the platform (413, 504, 502).
      if (res.status === 413) return { error: "This file is too large to read in one piece. Split the PDF and try again." };
      if (res.status === 504) return { error: "Reading this file took too long. Try a smaller file or enter the details by hand." };
      return { error: `Extraction failed (${res.status}).` };
    }
    if (res.status === 429) return { error: body.error ?? "The reader is busy for a few minutes. Try again later or enter the details by hand." };
    if (!res.ok || !body.extraction) return { error: body.error ?? "Extraction failed." };
    return { extraction: body.extraction };
  } catch {
    return { error: "Extraction failed. Check your connection and try again." };
  }
}
