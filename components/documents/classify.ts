"use client";

// Shared client helpers for the document vault UI: AI type
// classification (always shown as a suggestion the user confirms) and
// the storage upload + row insert pattern every upload path uses.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DocType } from "@/lib/documents";
import type { DocumentEntityType } from "@/types/db";

export interface ClassifySuggestion {
  doc_type: DocType;
  confidence: number | null;
  title: string | null;
  reason: string | null;
}

// Asks /api/extract kind=classify for a type suggestion. Never throws:
// a failed classification simply yields null and the user picks a type.
export async function classifyFile(file: File): Promise<ClassifySuggestion | null> {
  try {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", "classify");
    const res = await fetch("/api/extract", { method: "POST", body: fd });
    if (!res.ok) return null;
    const body = (await res.json()) as { extraction?: Partial<ClassifySuggestion> };
    const x = body.extraction;
    if (!x || !x.doc_type) return null;
    return {
      doc_type: x.doc_type,
      confidence: typeof x.confidence === "number" ? x.confidence : null,
      title: x.title ?? null,
      reason: x.reason ?? null,
    };
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
  }
): Promise<{ id: string } | { error: string }> {
  const path = `${args.orgId}/${args.entityType}/${crypto.randomUUID()}-${args.file.name}`;
  const { error: upErr } = await supabase.storage
    .from("documents")
    .upload(path, args.file, { contentType: args.file.type || undefined });
  if (upErr) return { error: `Could not upload ${args.file.name}: ${upErr.message}` };
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
  return { id: data.id as string };
}

export async function openDocument(
  supabase: SupabaseClient,
  storagePath: string
): Promise<void> {
  const { data } = await supabase.storage.from("documents").createSignedUrl(storagePath, 300);
  if (data?.signedUrl) window.open(data.signedUrl, "_blank");
}
