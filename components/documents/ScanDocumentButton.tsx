"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { scanKindFor, type ScanKind } from "@/lib/documents";
import type { DocumentRow } from "@/types/db";
import Link from "next/link";
import DocumentReview, { ExtractedSummary } from "./DocumentReview";
import {
  createOrUpdateFarmFromExtraction,
  type Fsa156Extraction,
} from "@/lib/gov/fsaImport";

// "Scan this document": fetches the stored file, runs the per-type
// extraction, and opens the amber review. Already-reviewed values show
// in a collapsible block with Edit. Nothing auto-saves.
export default function ScanDocumentButton({
  doc,
  onChanged,
  onConfirmed,
  compact = false,
}: {
  doc: DocumentRow;
  onChanged: () => void;
  onConfirmed?: (scanKind: ScanKind, extracted: Record<string, unknown>) => void;
  compact?: boolean;
}) {
  const supabase = createClient();
  const kind = scanKindFor((doc.doc_type ?? "other") as Parameters<typeof scanKindFor>[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<Record<string, unknown> | null>(null);
  const [showExtracted, setShowExtracted] = useState(false);
  const [farmResult, setFarmResult] = useState<string | null>(null);

  // FSA-156EZ: after the reviewed scan saves, offer to create or update
  // the FSA farm and its base acres (item 2). Always asked, never silent.
  async function handleConfirmed(scanKind: ScanKind, extracted: Record<string, unknown>) {
    onConfirmed?.(scanKind, extracted);
    if (scanKind !== "fsa_156ez") return;
    const farmNumber = String(extracted.farm_number ?? "").trim();
    if (!farmNumber) {
      setFarmResult("No farm number was read, so no FSA farm was created. Add it on Government Payments.");
      return;
    }
    if (
      !window.confirm(
        `Create or update FSA farm ${farmNumber} and its base acres from this scan? You can edit everything on Government Payments afterward.`
      )
    ) {
      return;
    }
    try {
      const result = await createOrUpdateFarmFromExtraction(
        supabase,
        doc.organization_id,
        extracted as unknown as Fsa156Extraction,
        {
          sourceDocumentId: doc.id,
          propertyId: doc.entity_type === "property" ? doc.entity_id : undefined,
        }
      );
      setFarmResult(
        `${result.created ? "Created" : "Updated"} FSA farm ${farmNumber}: ${result.baseAcresWritten} base acre row${result.baseAcresWritten === 1 ? "" : "s"} written` +
          (result.skippedCommodities.length > 0
            ? `; could not match: ${result.skippedCommodities.join(", ")}`
            : "") +
          "."
      );
    } catch (e) {
      setFarmResult(
        "Could not save the FSA farm: " + (e instanceof Error ? e.message : "unknown error")
      );
    }
  }

  const existing = (doc.extracted ?? null) as Record<string, unknown> | null;
  const existingKind = (existing?.scan_kind as ScanKind | undefined) ?? kind;

  async function scan() {
    if (!kind) return;
    setBusy(true);
    setError(null);
    try {
      const { data: signed, error: sErr } = await supabase.storage
        .from("documents")
        .createSignedUrl(doc.storage_path, 300);
      if (sErr || !signed?.signedUrl) throw new Error("Could not open the file.");
      const blob = await (await fetch(signed.signedUrl)).blob();
      const file = new File([blob], doc.file_name, {
        type: doc.content_type ?? blob.type,
      });
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", kind);
      const res = await fetch("/api/extract", { method: "POST", body: fd });
      const body = (await res.json()) as { extraction?: Record<string, unknown>; error?: string };
      if (!res.ok || !body.extraction) throw new Error(body.error ?? "Extraction failed.");
      setReview(body.extraction);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extraction failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!kind && !existing) return null;

  const btn = compact
    ? "text-xs font-medium text-kelly-700 hover:underline disabled:opacity-60"
    : "rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {kind ? (
          <button type="button" onClick={scan} disabled={busy} className={btn}>
            {busy ? "Reading..." : existing ? "Rescan" : "Scan this document"}
          </button>
        ) : null}
        {existing && existingKind ? (
          <>
            <button
              type="button"
              onClick={() => setShowExtracted((s) => !s)}
              className="text-xs font-medium text-kelly-700 hover:underline"
            >
              {showExtracted ? "Hide extracted" : "Extracted"}
            </button>
            <button
              type="button"
              onClick={() => setReview(existing)}
              className="text-xs font-medium text-kelly-700 hover:underline"
            >
              Edit
            </button>
          </>
        ) : null}
        {error ? <span className="text-xs text-red-600">{error}</span> : null}
        {farmResult ? (
          <span className="text-xs text-gray-700">
            {farmResult}{" "}
            <Link href="/gov-payments" className="font-medium text-kelly-700 hover:underline">
              Open Government Payments
            </Link>
          </span>
        ) : null}
      </div>
      {showExtracted && existing && existingKind && !review ? (
        <div className="rounded-lg bg-gray-50 p-2.5">
          <ExtractedSummary scanKind={existingKind} extracted={existing} />
        </div>
      ) : null}
      {review && (kind ?? existingKind) ? (
        <DocumentReview
          documentId={doc.id}
          scanKind={(kind ?? existingKind) as ScanKind}
          extraction={review}
          onSaved={() => {
            setReview(null);
            setShowExtracted(true);
            onChanged();
          }}
          onCancel={() => setReview(null)}
          onConfirmed={handleConfirmed}
        />
      ) : null}
    </div>
  );
}
