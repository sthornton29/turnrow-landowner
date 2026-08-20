"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { scanKindFor, type ScanKind } from "@/lib/documents";
import type { DocumentRow } from "@/types/db";
import Link from "next/link";
import DocumentReview, { ExtractedSummary } from "./DocumentReview";
import {
  createOrUpdateFarmsFromExtraction,
  normalizeFsaExtraction,
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
    const farms = normalizeFsaExtraction(extracted);
    const numbers = farms.map((f) => String(f.farm_number ?? "").trim()).filter(Boolean);
    if (numbers.length === 0) {
      setFarmResult("No farm number was read, so no FSA farm was created. Add it on Government Payments.");
      return;
    }
    const label =
      numbers.length === 1
        ? `FSA farm ${numbers[0]}`
        : `${numbers.length} FSA farms (${numbers.join(", ")})`;
    if (
      !window.confirm(
        `Create or update ${label} and the base acres from this scan? You can edit everything on Government Payments afterward.`
      )
    ) {
      return;
    }
    const { results, failures } = await createOrUpdateFarmsFromExtraction(
      supabase,
      doc.organization_id,
      extracted,
      {
        sourceDocumentId: doc.id,
        propertyId: doc.entity_type === "property" ? doc.entity_id : undefined,
      }
    );
    const created = results.filter((r) => r.created).length;
    const updated = results.length - created;
    const rows = results.reduce((a, r) => a + r.baseAcresWritten, 0);
    const skipped = [...new Set(results.flatMap((r) => r.skippedCommodities))];
    const parts = [
      created > 0 ? `created ${created}` : null,
      updated > 0 ? `updated ${updated}` : null,
    ].filter(Boolean);
    setFarmResult(
      `FSA farms ${parts.join(", ") || "unchanged"}; ${rows} base acre row${rows === 1 ? "" : "s"} written` +
        (skipped.length > 0 ? `; could not match: ${skipped.join(", ")}` : "") +
        (failures.length > 0
          ? `; failed: ${failures.map((f) => `${f.farmNumber} (${f.error})`).join(", ")}`
          : "") +
        linkSummary(results) +
        "."
    );
  }

  const existing = (doc.extracted ?? null) as Record<string, unknown> | null;
  const existingKind = (existing?.scan_kind as ScanKind | undefined) ?? kind;

  async function scan() {
    if (!kind) return;
    setBusy(true);
    setError(null);
    try {
      // Scan by storage path: the server fetches the file itself, so
      // large packets never pass through the request body limit.
      const fd = new FormData();
      fd.append("storage_path", doc.storage_path);
      fd.append("file_name", doc.file_name);
      fd.append("content_type", doc.content_type ?? "application/pdf");
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

// "linked to River Place, Home Place" or a nudge to add FSA numbers.
function linkSummary(results: Array<{ farmNumber: string; linkedProperties: string[] }>): string {
  const linked = [...new Set(results.flatMap((r) => r.linkedProperties))];
  const unlinked = results.filter((r) => r.linkedProperties.length === 0).map((r) => r.farmNumber);
  let out = "";
  if (linked.length > 0) out += `; linked to ${linked.join(", ")}`;
  if (unlinked.length > 0) {
    out += `; farm${unlinked.length === 1 ? "" : "s"} ${unlinked.join(", ")} not linked to a property yet (add the FSA number on the property page or link it on Government Payments)`;
  }
  return out;
}
