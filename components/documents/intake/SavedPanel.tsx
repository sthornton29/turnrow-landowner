"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { canPlotBoundary, type DocType, type ScanKind } from "@/lib/documents";
import { createOrUpdateFarmsFromExtraction, normalizeFsaExtraction } from "@/lib/gov/fsaImport";
import { openDocument } from "../classify";

// Step 3 confirmation: what was saved, and the type-specific next
// actions (plot a boundary, create FSA farms), always opt-in.
export default function SavedPanel({
  documentId,
  orgId,
  docType,
  scanKind,
  extracted,
  storagePath,
  propertyId,
  title,
  onUploadAnother,
  onDone,
}: {
  documentId: string;
  orgId: string;
  docType: DocType;
  scanKind: ScanKind | null;
  extracted: Record<string, unknown> | null;
  storagePath: string;
  propertyId: string | null;
  title: string;
  onUploadAnother: () => void;
  onDone: () => void;
}) {
  const supabase = createClient();
  const [farmResult, setFarmResult] = useState<string | null>(null);
  const [farmBusy, setFarmBusy] = useState(false);

  const farms = scanKind === "fsa_156ez" && extracted ? normalizeFsaExtraction(extracted) : [];
  const farmNumbers = farms.map((f) => String(f.farm_number ?? "").trim()).filter(Boolean);

  async function createFarms() {
    if (!extracted) return;
    const label =
      farmNumbers.length === 1
        ? `FSA farm ${farmNumbers[0]}`
        : `${farmNumbers.length} FSA farms (${farmNumbers.join(", ")})`;
    if (
      !window.confirm(
        `Create or update ${label} and the base acres from this scan? You can edit everything on Government Payments afterward.`
      )
    ) {
      return;
    }
    setFarmBusy(true);
    try {
      const { results, failures } = await createOrUpdateFarmsFromExtraction(supabase, orgId, extracted, {
        sourceDocumentId: documentId,
        propertyId: propertyId ?? undefined,
      });
      const created = results.filter((r) => r.created).length;
      const updated = results.length - created;
      const rows = results.reduce((a, r) => a + r.baseAcresWritten, 0);
      const skipped = [...new Set(results.flatMap((r) => r.skippedCommodities))];
      const parts = [
        created > 0 ? `created ${created}` : null,
        updated > 0 ? `updated ${updated}` : null,
      ].filter(Boolean);
      setFarmResult(
        `${parts.length ? parts.join(", ") : "No farms"}: ${rows} base acre row${rows === 1 ? "" : "s"} written` +
          (skipped.length > 0 ? `; could not match: ${skipped.join(", ")}` : "") +
          (failures.length > 0 ? `; failed: ${failures.join("; ")}` : "") +
          "."
      );
    } catch (e) {
      setFarmResult("Could not save the FSA farms: " + (e instanceof Error ? e.message : "unknown error"));
    } finally {
      setFarmBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-kelly-200 bg-kelly-50 p-3">
        <p className="text-sm font-semibold text-pine-900">Saved: {title}</p>
        <p className="text-xs text-gray-700">The document, its type, attachments, and reviewed fields are stored together.</p>
      </div>
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Suggested next</p>
        <div className="flex flex-wrap gap-2">
          {canPlotBoundary(docType) ? (
            <Link
              href={`/documents/${documentId}/plot`}
              className="rounded-lg bg-kelly-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-kelly-600"
            >
              Plot boundary from this document
            </Link>
          ) : null}
          {farmNumbers.length > 0 ? (
            <button
              type="button"
              onClick={createFarms}
              disabled={farmBusy}
              className="rounded-lg bg-kelly-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-60"
            >
              {farmBusy
                ? "Saving farms..."
                : `Create or update ${farmNumbers.length} FSA farm${farmNumbers.length === 1 ? "" : "s"}`}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => openDocument(supabase, storagePath)}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Open file
          </button>
          <button
            type="button"
            onClick={onUploadAnother}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Upload another
          </button>
          <button
            type="button"
            onClick={onDone}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Done
          </button>
        </div>
        {farmResult ? (
          <p className="text-xs text-gray-700">
            {farmResult}{" "}
            <Link href="/gov-payments" className="font-medium text-kelly-700 hover:underline">
              Open Government Payments
            </Link>
          </p>
        ) : null}
      </div>
    </div>
  );
}
