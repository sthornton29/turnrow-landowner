"use client";

// Shared client helpers for the document vault UI: AI type
// classification (always shown as a suggestion the user confirms), the
// property hints that come back with it, and the storage upload + row
// insert + property links pattern every upload path uses.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { DocType } from "@/lib/documents";
import { safeStorageName } from "@/lib/batchIntake";
import { friendlyDbError } from "@/lib/dbErrors";
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
  doc: Pick<DocumentRow, "storage_path" | "file_name" | "content_type"> & { size_bytes?: number | null }
): Promise<ClassifySuggestion | null> {
  const res = await extractStored({
    storagePath: doc.storage_path,
    fileName: doc.file_name,
    contentType: doc.content_type ?? "application/pdf",
    kind: "classify",
    sizeBytes: doc.size_bytes ?? null,
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
  context: IntakeContext,
  // The file itself, when the caller still holds it: a large phone photo
  // is then read from a smaller copy (see readerCopy).
  file: File | null = null
): Promise<{ result: IntakeResult } | { error: string }> {
  try {
    const fd = new FormData();
    await appendFileForReading(fd, { ...stored, file });
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

// What the person sees when an upload fails: a sentence they can act
// on. The raw storage or network text (which can be a line of protocol
// detail) goes to the browser console, never to the screen.
export function uploadErrorCopy(fileName: string, message: string): string {
  if (/exceeded the maximum allowed size|payload too large|\b413\b/i.test(message)) {
    return `${fileName} is too large to upload. Split it into smaller files and upload each one; scans work best under 100 pages per file.`;
  }
  if (/not signed in/i.test(message)) {
    return `You have been signed out. Sign in again, then upload ${fileName} again.`;
  }
  return friendlyDbError(message, `Could not upload ${fileName}. Check your connection and try again.`);
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
    if (error) console.error("upload failed:", error.message);
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
      // Never resume an upload from an EARLIER attempt. A resumed upload
      // keeps writing to the path it was created with, while every
      // attempt here has a new path: the bytes landed at the old path,
      // the document row was saved with the new one, and the page said
      // "Could not load the file." A dropped connection inside this
      // attempt is still retried (retryDelays) on this same path.
      storeFingerprintForResuming: false,
      metadata: {
        bucketName: "documents",
        objectName: path,
        contentType: file.type || "application/octet-stream",
        cacheControl: "3600",
      },
      chunkSize: RESUMABLE_THRESHOLD, // Supabase requires exactly 6 MB chunks
      onError: (err) => {
        console.error("upload failed:", err.message);
        resolve(err.message || "Upload failed.");
      },
      onSuccess: () => resolve(null),
    });
    upload.start();
  });
}

// Is there really a file at this path? true or false; null when the
// check itself could not be made (offline, a server error).
export async function storageObjectExists(supabase: SupabaseClient, path: string): Promise<boolean | null> {
  try {
    const { data } = await supabase.storage.from("documents").exists(path);
    return data === true;
  } catch {
    return null;
  }
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
): Promise<{ id: string; warning?: string } | { error: string }> {
  // A document row must never point at a file that is not there. The
  // intake's earlier upload is reused only when it really is in storage
  // (it may not have finished, or may have been cleaned up); otherwise
  // the file is uploaded now, and that upload is confirmed too.
  let path = args.storagePath ?? "";
  let stored: boolean | null = path ? await storageObjectExists(supabase, path) : false;
  let uploadedHere = false;
  if (stored === false) {
    path = `${args.orgId}/${args.entityType}/${crypto.randomUUID()}-${safeStorageName(args.file.name)}`;
    const upErr = await uploadToStorage(supabase, path, args.file);
    if (upErr) return { error: uploadErrorCopy(args.file.name, upErr) };
    uploadedHere = true;
    stored = await storageObjectExists(supabase, path);
  }
  if (stored !== true) {
    return {
      error:
        stored === false
          ? `${args.file.name} did not finish uploading, so nothing was saved. Try again.`
          : `Could not confirm that ${args.file.name} finished uploading, so nothing was saved. Check your connection and try again.`,
    };
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
  if (insErr || !data) {
    if (insErr) console.error("document save failed:", insErr.message);
    // A file uploaded just for this save has no row now: take it back out.
    // (An upload the caller made earlier stays, for its retry or cleanup.)
    if (uploadedHere) await supabase.storage.from("documents").remove([path]).then(() => undefined, () => undefined);
    return { error: friendlyDbError(insErr, `Could not save ${args.file.name}. Please try again.`) };
  }
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
    // The document IS saved at this point. Reporting an error here made
    // Save again create a second copy and Start over delete the file
    // under the saved row, so it is a saved document with a warning.
    if (linkErr) {
      console.error("document property link failed:", linkErr.message);
      return { id, warning: "Saved, but it could not be linked to the property. Open the document to link it." };
    }
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
  const fail = (e: { code?: string; message: string }) =>
    friendlyDbError(e, "Could not save the properties. Please try again.");
  const { data: existing, error: readErr } = await supabase
    .from("document_properties")
    .select("id, property_id")
    .eq("document_id", doc.id);
  if (readErr) return fail(readErr);
  const have = new Set((existing ?? []).map((r) => r.property_id as string));
  const toAdd = want.filter((p) => !have.has(p));
  const toRemove = (existing ?? []).filter((r) => !want.includes(r.property_id as string));
  if (toAdd.length > 0) {
    const { error } = await supabase.from("document_properties").insert(
      toAdd.map((property_id) => ({ organization_id: doc.organization_id, document_id: doc.id, property_id }))
    );
    if (error) return fail(error);
  }
  if (toRemove.length > 0) {
    const { error } = await supabase
      .from("document_properties")
      .delete()
      .in("id", toRemove.map((r) => r.id as string));
    if (error) return fail(error);
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
    if (error) return fail(error);
  } else if (doc.entity_type === "property" && !want.includes(doc.entity_id)) {
    const patch =
      want.length > 0
        ? { entity_type: "property", entity_id: want[0] }
        : { entity_type: "organization", entity_id: doc.organization_id };
    const { error } = await supabase.from("documents").update(patch).eq("id", doc.id);
    if (error) return fail(error);
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

// Delete the row, then its current file and every superseded version's
// file (document_versions, migration 0028; the rows cascade with the
// document), but ONLY the files nothing else still points at. A tax
// upload saves one document per statement, all on the SAME PDF, so
// deleting one statement's document must leave the file for the others.
// The row goes first: when it cannot be deleted nothing else is touched.
// Returns an error sentence, or null when the document is gone.
export async function deleteDocumentEverywhere(
  supabase: SupabaseClient,
  doc: Pick<DocumentRow, "id" | "storage_path"> & { entity_type?: DocumentRow["entity_type"] },
  // Pass true only for an admin. Row level security hides other
  // entities' documents from everyone else, so for them "no other
  // document uses this file" cannot be proven for a file that several
  // documents may share (a tax statement's PDF): that file is kept.
  opts: { seesEveryDocument?: boolean } = {}
): Promise<string | null> {
  const { data: versions, error: verErr } = await supabase
    .from("document_versions")
    .select("storage_path")
    .eq("document_id", doc.id);
  const { data: gone, error } = await supabase.from("documents").delete().eq("id", doc.id).select("id");
  if (error) return friendlyDbError(error, "Could not delete the document. Please try again.");
  if (!gone || gone.length === 0) {
    return "This document was not deleted. It may already be gone, or you may not have access to it.";
  }
  // From here the document is deleted. Whatever goes wrong below only
  // leaves a file behind in storage, which is the safe side.
  if (verErr) return null; // the version files are not known: leave everything
  if (doc.entity_type === "tax_statement" && !opts.seesEveryDocument) return null;
  const paths = [...new Set([doc.storage_path, ...(versions ?? []).map((v) => v.storage_path as string)])];
  const [inDocuments, inVersions] = await Promise.all([
    supabase.from("documents").select("storage_path").in("storage_path", paths),
    supabase.from("document_versions").select("storage_path").in("storage_path", paths),
  ]);
  // If either check could not be made, keep the files.
  if (inDocuments.error || inVersions.error) return null;
  const stillUsed = new Set(
    [...(inDocuments.data ?? []), ...(inVersions.data ?? [])].map((r) => r.storage_path as string)
  );
  const unused = paths.filter((path) => !stillUsed.has(path));
  if (unused.length > 0) {
    const { error: rmErr } = await supabase.storage.from("documents").remove(unused);
    if (rmErr) console.error("could not remove deleted document files:", rmErr.message);
  }
  return null;
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
  return error ? friendlyDbError(error, "Could not save the title. Please try again.") : null;
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
  const path = `${doc.organization_id}/${doc.entity_type}/${crypto.randomUUID()}-${safeStorageName(file.name)}`;
  const upErr = await uploadToStorage(supabase, path, file);
  if (upErr) return uploadErrorCopy(file.name, upErr);
  // The row is only pointed at the new file once it is really there.
  if ((await storageObjectExists(supabase, path)) !== true) {
    return `${file.name} did not finish uploading, so the file was not replaced. Check your connection and try again.`;
  }
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
  if (verErr) return friendlyDbError(verErr, "Could not replace the file. Please try again.");
  const { error } = await supabase
    .from("documents")
    .update({
      storage_path: path,
      file_name: file.name,
      content_type: file.type || null,
      size_bytes: file.size,
    })
    .eq("id", doc.id);
  return error ? friendlyDbError(error, "Could not replace the file. Please try again.") : null;
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

// Open a stored file in a new tab, or save it when downloadName is given
// (the file then arrives under its own name, not the storage name with
// its id prefix). Call it straight from the tap: the tab is opened
// BEFORE the signed link is fetched, because Safari on iPhone blocks a
// tab opened after waiting on the network. Returns an error sentence
// (the empty tab is closed) or null.
export async function openDocument(
  supabase: SupabaseClient,
  storagePath: string,
  opts: { downloadName?: string | null } = {}
): Promise<string | null> {
  const tab = window.open("", "_blank");
  let url: string | null = null;
  try {
    const { data } = await supabase.storage
      .from("documents")
      .createSignedUrl(storagePath, 300, opts.downloadName ? { download: opts.downloadName } : undefined);
    url = data?.signedUrl ?? null;
  } catch {
    url = null;
  }
  if (!url) {
    tab?.close();
    return "Could not open the file. Check your connection and try again.";
  }
  if (tab) {
    tab.opener = null;
    tab.location.href = url;
  } else {
    // The browser refused the new tab: use this one.
    window.location.assign(url);
  }
  return null;
}

// Storage path for a file read by the intake before its row exists.
export function intakeStoragePath(orgId: string, file: File): string {
  return `${orgId}/intake/${crypto.randomUUID()}-${safeStorageName(file.name)}`;
}

// Every extraction goes BY STORAGE PATH: the browser uploads the file
// straight to storage (resumable over 6 MB) and the route pulls it
// under the caller's session, so the request body never carries the
// document and Vercel's 4.5 MB body limit ("Request Entity Too Large",
// which comes back as HTML, not JSON) cannot be hit. The one exception
// is a large phone photo, read from a smaller copy that fits (see
// readerCopy). Returns the extraction and the path so the caller can
// keep the object as the attached document instead of uploading twice.
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
    file: args.file,
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
  // For large phone photos (see readerCopy): the file itself when the
  // caller holds it, else its stored size when known.
  file?: Blob | null;
  sizeBytes?: number | null;
}): Promise<{ extraction: Record<string, unknown> } | { error: string }> {
  const failed = "Reading the document did not work this time. Try again, or enter the details by hand.";
  try {
    const fd = new FormData();
    await appendFileForReading(fd, args);
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
      return { error: failed };
    }
    if (res.status === 429) return { error: body.error ?? "The reader is busy for a few minutes. Try again later or enter the details by hand." };
    // The route's own failures arrive as a plain sentence: shown as is.
    if (!res.ok || !body.extraction) return { error: body.error ?? failed };
    return { extraction: body.extraction };
  } catch {
    return { error: "Could not reach the document reader. Check your connection and try again." };
  }
}

// ---- large phone photos
//
// The reader takes a photo of up to about 3.7 MB, and phone photos are
// commonly 3 to 8 MB. For the READ only, a larger JPEG, PNG, or WebP is
// sent as a smaller JPEG copy made here in the browser. The original is
// what is uploaded to storage and saved with the document; it is never
// changed. If the browser cannot open the picture, the read goes by
// storage path as before (and the route answers with its own message).
const READER_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const READER_IMAGE_MAX_BYTES = 3.5 * 1024 * 1024;
const READER_IMAGE_EDGES = [2400, 2000, 1600]; // longest edge in pixels, tried in order

async function loadImage(blob: Blob): Promise<{ image: CanvasImageSource; width: number; height: number; done: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob);
      return { image: bitmap, width: bitmap.width, height: bitmap.height, done: () => bitmap.close() };
    } catch {
      // Fall through to an <img> element (older Safari).
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { image: img, width: img.naturalWidth, height: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

// A JPEG copy no larger than the reader's limit, or null when one could
// not be made (the picture would not open, or no size was small enough).
export async function downscaledJpeg(blob: Blob, fileName: string): Promise<File | null> {
  let source: Awaited<ReturnType<typeof loadImage>>;
  try {
    source = await loadImage(blob);
  } catch {
    return null;
  }
  try {
    if (!(source.width > 0) || !(source.height > 0)) return null;
    for (const edge of READER_IMAGE_EDGES) {
      const scale = Math.min(1, edge / Math.max(source.width, source.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(source.width * scale));
      canvas.height = Math.max(1, Math.round(source.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      // White behind a see-through PNG (JPEG has no transparency).
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(source.image, 0, 0, canvas.width, canvas.height);
      const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
      if (out && out.size <= READER_IMAGE_MAX_BYTES) {
        return new File([out], fileName.replace(/\.[^.]*$/, "") + ".jpg", { type: "image/jpeg" });
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    source.done();
  }
}

// The smaller copy to read instead of a stored photo, or null to read
// the stored file as is (not a photo, small enough, or no copy possible).
async function readerCopy(args: {
  storagePath: string;
  fileName: string;
  contentType: string;
  file?: Blob | null;
  sizeBytes?: number | null;
}): Promise<File | null> {
  if (!READER_IMAGE_TYPES.includes(args.contentType.toLowerCase())) return null;
  try {
    let blob = args.file ?? null;
    if (!blob) {
      // Only the path is known (a saved document's rescan): look at the
      // size first so a small photo is not downloaded for nothing.
      const storage = createClient().storage.from("documents");
      let size = args.sizeBytes ?? null;
      if (size === null) size = (await storage.info(args.storagePath)).data?.size ?? null;
      if (size === null || size <= READER_IMAGE_MAX_BYTES) return null;
      blob = (await storage.download(args.storagePath)).data ?? null;
    }
    if (!blob || blob.size <= READER_IMAGE_MAX_BYTES) return null;
    return await downscaledJpeg(blob, args.fileName);
  } catch {
    return null;
  }
}

// What every /api/extract request carries to say which file to read:
// the smaller copy of a large photo as `file`, otherwise the storage
// path (the route pulls the file itself).
async function appendFileForReading(
  fd: FormData,
  args: { storagePath: string; fileName: string; contentType: string; file?: Blob | null; sizeBytes?: number | null }
): Promise<void> {
  const copy = await readerCopy(args);
  if (copy) {
    fd.append("file", copy);
    return;
  }
  fd.append("storage_path", args.storagePath);
  fd.append("file_name", args.fileName);
  fd.append("content_type", args.contentType);
}

// ---- documents.extracted
//
// Several screens keep their own keys in documents.extracted: the
// reviewed fields, the spatial evidence, the plot screen's extraction
// and its plot record. Each one writes through here: the LATEST stored
// value is re-read and the new keys are laid over it, so one screen's
// save never erases what another stored (a page-load copy can be
// minutes old). dropKeys names stored keys to leave out first (the
// previous review form's fields when a document is rescanned as a
// different type). Returns the merged value or the database error.
export async function mergeExtracted(
  supabase: SupabaseClient,
  documentId: string,
  patch: Record<string, unknown>,
  opts: {
    columns?: Record<string, unknown>;
    dropKeys?: (stored: Record<string, unknown>) => string[];
  } = {}
): Promise<{ extracted: Record<string, unknown> } | { error: { code?: string; message: string } }> {
  const { data, error: readErr } = await supabase
    .from("documents")
    .select("extracted")
    .eq("id", documentId)
    .single();
  if (readErr) return { error: readErr };
  const stored = { ...((data?.extracted ?? {}) as Record<string, unknown>) };
  for (const key of opts.dropKeys?.(stored) ?? []) delete stored[key];
  const extracted = { ...stored, ...patch };
  const { error } = await supabase
    .from("documents")
    .update({ ...(opts.columns ?? {}), extracted })
    .eq("id", documentId);
  return error ? { error } : { extracted };
}
