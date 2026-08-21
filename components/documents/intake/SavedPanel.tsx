"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { canPlotBoundary, type DocType, type ScanKind } from "@/lib/documents";
import { createOrUpdateFarmsFromExtraction, normalizeFsaExtraction } from "@/lib/gov/fsaImport";
import { openDocument } from "../classify";
import { nameMentioned } from "@/lib/documentMatch";

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
  placeNames = [],
  savedProperties = [],
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
  // Learn names: place names the reader saw that match none of the
  // saved properties' names or aliases become one-tap aliases.
  placeNames?: string[];
  savedProperties?: Array<{ id: string; name: string; aliases: string[] }>;
  onUploadAnother: () => void;
  onDone: () => void;
}) {
  const supabase = createClient();
  const [farmResult, setFarmResult] = useState<string | null>(null);
  const [farmBusy, setFarmBusy] = useState(false);
  const [learned, setLearned] = useState<Record<string, string>>({});
  const [learnTarget, setLearnTarget] = useState<Record<string, string>>({});
  const [learnError, setLearnError] = useState<string | null>(null);

  const learnable = savedProperties.length === 0 ? [] : learnableNames(placeNames, savedProperties);

  async function remember(alias: string) {
    const pid = savedProperties.length === 1 ? savedProperties[0].id : learnTarget[alias];
    if (!pid) return;
    setLearnError(null);
    const { error } = await supabase.from("property_aliases").insert({
      organization_id: orgId,
      property_id: pid,
      alias,
      source_document_id: documentId,
    });
    if (error && !error.message.includes("duplicate")) {
      setLearnError(error.message);
      return;
    }
    setLearned((m) => ({ ...m, [alias]: savedProperties.find((p) => p.id === pid)?.name ?? "" }));
  }

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
          linkSummary(results) +
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
      {learnable.length > 0 ? (
        <div className="space-y-1.5 rounded-xl border border-gray-200 bg-white p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Remember these names</p>
          <p className="text-xs text-gray-600">
            The document uses names your records do not. Remembering one helps the reader file the next document.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {learnable.map((alias) =>
              learned[alias] ? (
                <span key={alias} className="rounded-full bg-kelly-50 px-2.5 py-1 text-xs font-medium text-pine-900">
                  &quot;{alias}&quot; means {learned[alias]}
                </span>
              ) : (
                <span key={alias} className="inline-flex items-center gap-1">
                  {savedProperties.length > 1 ? (
                    <select
                      value={learnTarget[alias] ?? ""}
                      onChange={(e) => setLearnTarget((m) => ({ ...m, [alias]: e.target.value }))}
                      className="rounded border border-gray-300 px-1.5 py-1 text-xs"
                    >
                      <option value="">Which property?</option>
                      {savedProperties.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => remember(alias)}
                    disabled={savedProperties.length > 1 && !learnTarget[alias]}
                    className="rounded-full border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Remember &quot;{alias}&quot;{savedProperties.length === 1 ? ` means ${savedProperties[0].name}` : ""}
                  </button>
                </span>
              )
            )}
          </div>
          {learnError ? <p className="text-xs text-red-600">{learnError}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

// Generic words that are never a tract name.
const GENERIC = /\b(creek|branch|river|road|rd|highway|hwy|street|county|alabama|mississippi|tennessee|georgia|church|cemetery|lake|pond)\b/i;

function learnableNames(
  placeNames: string[],
  saved: Array<{ name: string; aliases: string[] }>
): string[] {
  const known = saved.flatMap((p) => [p.name, ...p.aliases]);
  const out: string[] = [];
  for (const raw of placeNames) {
    const n = raw.trim();
    if (n.length < 3 || n.length > 60 || GENERIC.test(n)) continue;
    if (known.some((k) => nameMentioned(k, n) || nameMentioned(n, k))) continue;
    if (out.some((o) => o.toLowerCase() === n.toLowerCase())) continue;
    out.push(n);
    if (out.length >= 5) break;
  }
  return out;
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
