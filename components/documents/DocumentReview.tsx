"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { EXTRACTED_FIELDS, type ScanKind } from "@/lib/documents";
import { normalizeFsaExtraction } from "@/lib/gov/fsaImport";
import { recordExtraction } from "./classify";
import ExtractedFieldsEditor, {
  finalizeValues,
  initialValuesFor,
  type Row,
} from "./ExtractedFieldsEditor";

// The standard amber review screen for a RE-SCANNED document: every
// field the extraction returned, editable, uncertain ones ringed amber.
// Nothing is stored until the user presses Save; Save writes the
// reviewed values to documents.extracted. (First-time uploads review
// inside the intake flow, which shares ExtractedFieldsEditor.)
export default function DocumentReview({
  documentId,
  scanKind,
  extraction,
  onSaved,
  onCancel,
  onConfirmed,
}: {
  documentId: string;
  scanKind: ScanKind;
  extraction: Record<string, unknown>;
  onSaved: (extracted: Record<string, unknown>) => void;
  onCancel: () => void;
  // Item 2 hooks farm record creation here for FSA-156EZ scans.
  onConfirmed?: (scanKind: ScanKind, extracted: Record<string, unknown>) => void;
}) {
  const supabase = createClient();
  const unsure = new Set<string>(
    Array.isArray(extraction.unsure_fields)
      ? (extraction.unsure_fields as unknown[]).map(String)
      : []
  );
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    initialValuesFor(scanKind, extraction)
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const out = finalizeValues(scanKind, values);
    if (extraction.pages_scanned != null) out.pages_scanned = extraction.pages_scanned;
    if (extraction.total_pages != null) out.total_pages = extraction.total_pages;
    const { error: err } = await supabase
      .from("documents")
      .update({
        extracted: out,
        extracted_at: new Date().toISOString(),
        extraction_reviewed: true,
      })
      .eq("id", documentId);
    setBusy(false);
    if (err) {
      setError("Could not save. " + err.message);
      return;
    }
    await recordExtraction(supabase, documentId, scanKind);
    onConfirmed?.(scanKind, out);
    onSaved(out);
  }

  return (
    <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <div>
        <h3 className="text-base font-semibold text-gray-900">Review what was read</h3>
        <p className="text-xs text-gray-600">
          Check every field against the document. Amber fields were uncertain
          in the extraction. Nothing is saved until you press Save.
        </p>
      </div>

      <ExtractedFieldsEditor
        scanKind={scanKind}
        values={values}
        onChange={setValues}
        unsure={unsure}
        meta={{
          pages_scanned: extraction.pages_scanned,
          total_pages: extraction.total_pages,
          chunks: extraction.chunks,
        }}
      />

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded-lg bg-kelly-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-kelly-600 disabled:opacity-60"
        >
          {busy ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// Read-only rendering of reviewed extracted values (for rows/pages).
export function ExtractedSummary({
  scanKind,
  extracted,
}: {
  scanKind: ScanKind;
  extracted: Record<string, unknown>;
}) {
  const fields = EXTRACTED_FIELDS[scanKind] ?? [];
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
      {fields.map((f) => {
        const v = f.input === "farms" ? normalizeFsaExtraction(extracted) : extracted[f.key];
        if (v === null || v === undefined || v === "") return null;
        if (f.input === "farms") {
          const farms = v as Array<Record<string, unknown>>;
          if (farms.length === 0) return null;
          return (
            <div key={f.key} className="sm:col-span-2 space-y-1.5">
              {farms.map((farm, i) => {
                const rows = Array.isArray(farm.base_acres) ? (farm.base_acres as Row[]) : [];
                return (
                  <div key={i}>
                    <dt className="text-gray-500">
                      Farm {String(farm.farm_number ?? "?")}
                      {farm.county ? ` (${String(farm.county)}${farm.state ? `, ${String(farm.state)}` : ""})` : ""}
                      {farm.cropland_acres != null ? ` ${String(farm.cropland_acres)} cropland ac` : ""}
                    </dt>
                    <dd className="text-gray-900">
                      {rows.length === 0
                        ? "No base acres"
                        : rows
                            .map((r) => `${String(r.commodity ?? "")} ${String(r.base_acres ?? "")} ac${r.plc_yield != null && r.plc_yield !== "" ? ` @ ${String(r.plc_yield)}` : ""}`)
                            .join("; ")}
                    </dd>
                  </div>
                );
              })}
            </div>
          );
        }
        if (f.input === "table") {
          const rows = Array.isArray(v) ? (v as Row[]) : [];
          if (rows.length === 0) return null;
          return (
            <div key={f.key} className="sm:col-span-2">
              <dt className="text-gray-500">{f.label}</dt>
              <dd className="mt-0.5 overflow-x-auto">
                <table className="min-w-full text-[11px]">
                  <thead className="text-left text-gray-500">
                    <tr>
                      {(f.columns ?? []).map((c) => (
                        <th key={c.key} className="pr-3 font-medium">{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i}>
                        {(f.columns ?? []).map((c) => (
                          <td key={c.key} className="pr-3 text-gray-900">{String(r[c.key] ?? "")}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </dd>
            </div>
          );
        }
        return (
          <div key={f.key} className={"flex justify-between gap-3" + (f.input === "textarea" ? " sm:col-span-2 flex-col" : "")}>
            <dt className="text-gray-500">{f.label}</dt>
            <dd className={"font-medium text-gray-900 " + (f.input === "textarea" ? "whitespace-pre-wrap" : "text-right")}>
              {String(v)}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
