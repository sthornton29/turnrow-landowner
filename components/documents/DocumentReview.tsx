"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { EXTRACTED_FIELDS, type ScanKind } from "@/lib/documents";
import { normalizeFsaExtraction } from "@/lib/gov/fsaImport";

const FARM_SCALARS: Array<{ key: string; label: string; input: "text" | "number" }> = [
  { key: "farm_number", label: "FSA farm number", input: "text" },
  { key: "county", label: "County", input: "text" },
  { key: "state", label: "State", input: "text" },
  { key: "tract_numbers", label: "Tract numbers", input: "text" },
  { key: "farmland_acres", label: "Farmland acres", input: "number" },
  { key: "cropland_acres", label: "Cropland acres", input: "number" },
  { key: "dcp_cropland_acres", label: "DCP cropland acres", input: "number" },
];

type Row = Record<string, unknown>;

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-kelly-500 focus:outline-none";
const amberClass =
  "w-full rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 text-sm ring-2 ring-amber-100 focus:border-kelly-500 focus:outline-none";

// The standard amber review screen for a scanned document: every field
// the extraction returned, editable, with uncertain fields ringed amber.
// Nothing is stored until the user presses Save; Save writes the
// reviewed values to documents.extracted.
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
  const fields = EXTRACTED_FIELDS[scanKind] ?? [];
  const unsure = new Set<string>(
    Array.isArray(extraction.unsure_fields)
      ? (extraction.unsure_fields as unknown[]).map(String)
      : []
  );
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const v: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = extraction[f.key];
      if (f.input === "table") {
        v[f.key] = Array.isArray(raw) ? (raw as Row[]).map((r) => ({ ...r })) : [];
      } else if (f.input === "farms") {
        // Packet shape or the legacy single-farm shape.
        v[f.key] = normalizeFsaExtraction(extraction).map((farm) => ({
          ...farm,
          base_acres: (farm.base_acres ?? []).map((r) => ({ ...r })),
        }));
      } else {
        v[f.key] = raw ?? "";
      }
    }
    return v;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(key: string, value: unknown) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function setCell(key: string, idx: number, col: string, value: string) {
    setValues((v) => {
      const rows = [...((v[key] as Row[]) ?? [])];
      rows[idx] = { ...rows[idx], [col]: value };
      return { ...v, [key]: rows };
    });
  }

  function setFarm(key: string, idx: number, col: string, value: unknown) {
    setValues((v) => {
      const farms = [...((v[key] as Row[]) ?? [])];
      farms[idx] = { ...farms[idx], [col]: value };
      return { ...v, [key]: farms };
    });
  }

  function setFarmCell(key: string, farmIdx: number, rowIdx: number, col: string, value: string) {
    setValues((v) => {
      const farms = [...((v[key] as Row[]) ?? [])];
      const rows = [...((farms[farmIdx]?.base_acres as Row[]) ?? [])];
      rows[rowIdx] = { ...rows[rowIdx], [col]: value };
      farms[farmIdx] = { ...farms[farmIdx], base_acres: rows };
      return { ...v, [key]: farms };
    });
  }

  const numOrNull = (x: unknown) => {
    const t = String(x ?? "").trim();
    return t === "" ? null : Number(t);
  };
  const strOrNull = (x: unknown) => {
    const t = String(x ?? "").trim();
    return t === "" ? null : t;
  };

  async function save() {
    setBusy(true);
    setError(null);
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      const v = values[f.key];
      if (f.input === "farms") {
        out[f.key] = ((v as Row[]) ?? [])
          .map((farm) => ({
            farm_number: strOrNull(farm.farm_number),
            county: strOrNull(farm.county),
            state: strOrNull(farm.state),
            tract_numbers: strOrNull(farm.tract_numbers),
            farmland_acres: numOrNull(farm.farmland_acres),
            cropland_acres: numOrNull(farm.cropland_acres),
            dcp_cropland_acres: numOrNull(farm.dcp_cropland_acres),
            page_hint: strOrNull(farm.page_hint),
            base_acres: ((farm.base_acres as Row[]) ?? [])
              .filter((r) => String(r.commodity ?? "").trim() !== "")
              .map((r) => ({
                commodity: String(r.commodity).trim(),
                base_acres: numOrNull(r.base_acres),
                plc_yield: numOrNull(r.plc_yield),
              })),
          }))
          .filter((farm) => farm.farm_number || farm.base_acres.length > 0);
      } else if (f.input === "table") {
        out[f.key] = ((v as Row[]) ?? []).filter((r) =>
          Object.values(r).some((c) => String(c ?? "").trim() !== "")
        );
      } else if (f.input === "number") {
        const s = String(v ?? "").trim();
        out[f.key] = s === "" ? null : Number(s);
      } else {
        const s = String(v ?? "").trim();
        out[f.key] = s === "" ? null : s;
      }
    }
    out.scan_kind = scanKind;
    out.unsure_fields = [];
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

      {fields.map((f) => (
        <div key={f.key}>
          <label className="mb-1 block text-sm font-medium text-gray-700">{f.label}</label>
          {f.input === "farms" ? (
            <div className="space-y-3">
              {extraction.total_pages != null && extraction.pages_scanned != null ? (
                <p className="text-xs text-gray-500">
                  {String(extraction.pages_scanned)} of {String(extraction.total_pages)} pages read
                  {Number(extraction.chunks) > 1 ? ` in ${String(extraction.chunks)} parts, merged by farm number` : ""}.
                </p>
              ) : null}
              {((values[f.key] as Row[]) ?? []).map((farm, fi) => {
                const farmUnsure = [...unsure].some((u) => u.startsWith(`farms[${fi}]`));
                const rows = (farm.base_acres as Row[]) ?? [];
                return (
                  <div
                    key={fi}
                    className={"rounded-xl border p-3 " + (farmUnsure ? "border-amber-400 bg-amber-50/40" : "border-gray-200")}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-sm font-semibold text-gray-900">
                        Farm {String(farm.farm_number ?? "").trim() || `${fi + 1}`}
                        {farm.page_hint ? (
                          <span className="ml-2 text-xs font-normal text-gray-500">{String(farm.page_hint)}</span>
                        ) : null}
                      </p>
                      <button
                        type="button"
                        onClick={() => set(f.key, ((values[f.key] as Row[]) ?? []).filter((_, j) => j !== fi))}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Remove farm
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {FARM_SCALARS.map((sc) => (
                        <label key={sc.key} className="block text-xs text-gray-600">
                          {sc.label}
                          <input
                            type={sc.input === "number" ? "number" : "text"}
                            step={sc.input === "number" ? "any" : undefined}
                            value={String(farm[sc.key] ?? "")}
                            onChange={(e) => setFarm(f.key, fi, sc.key, e.target.value)}
                            className={(unsure.has(`farms[${fi}].${sc.key}`) ? amberClass : inputClass) + " mt-0.5"}
                          />
                        </label>
                      ))}
                    </div>
                    <div className="mt-2 overflow-x-auto rounded-lg border border-gray-200">
                      <table className="min-w-full text-xs">
                        <thead className="bg-gray-50 text-left text-gray-600">
                          <tr>
                            {(f.columns ?? []).map((c) => (
                              <th key={c.key} className="px-2 py-1 font-medium">{c.label}</th>
                            ))}
                            <th className="px-2 py-1" />
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((row, ri) => (
                            <tr key={ri} className="border-t border-gray-100">
                              {(f.columns ?? []).map((c) => (
                                <td key={c.key} className="px-1 py-1">
                                  <input
                                    value={String(row[c.key] ?? "")}
                                    onChange={(e) => setFarmCell(f.key, fi, ri, c.key, e.target.value)}
                                    className="w-full min-w-[6rem] rounded border border-gray-300 px-1.5 py-1"
                                  />
                                </td>
                              ))}
                              <td className="px-1 py-1">
                                <button
                                  type="button"
                                  onClick={() => setFarm(f.key, fi, "base_acres", rows.filter((_, j) => j !== ri))}
                                  className="text-red-600 hover:underline"
                                >
                                  Remove
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <button
                        type="button"
                        onClick={() => setFarm(f.key, fi, "base_acres", [...rows, {}])}
                        className="m-2 rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        + Add commodity
                      </button>
                    </div>
                  </div>
                );
              })}
              <button
                type="button"
                onClick={() => set(f.key, [...((values[f.key] as Row[]) ?? []), { base_acres: [] }])}
                className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                + Add farm
              </button>
            </div>
          ) : f.input === "table" ? (
            <div className={"overflow-x-auto rounded-lg border " + (unsure.has(f.key) ? "border-amber-400" : "border-gray-200")}>
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50 text-left text-gray-600">
                  <tr>
                    {(f.columns ?? []).map((c) => (
                      <th key={c.key} className="px-2 py-1 font-medium">
                        {c.label}
                      </th>
                    ))}
                    <th className="px-2 py-1" />
                  </tr>
                </thead>
                <tbody>
                  {((values[f.key] as Row[]) ?? []).map((row, i) => (
                    <tr key={i} className="border-t border-gray-100">
                      {(f.columns ?? []).map((c) => (
                        <td key={c.key} className="px-1 py-1">
                          <input
                            value={String(row[c.key] ?? "")}
                            onChange={(e) => setCell(f.key, i, c.key, e.target.value)}
                            className="w-full min-w-[6rem] rounded border border-gray-300 px-1.5 py-1"
                          />
                        </td>
                      ))}
                      <td className="px-1 py-1">
                        <button
                          type="button"
                          onClick={() =>
                            set(
                              f.key,
                              ((values[f.key] as Row[]) ?? []).filter((_, j) => j !== i)
                            )
                          }
                          className="text-red-600 hover:underline"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button
                type="button"
                onClick={() => set(f.key, [...((values[f.key] as Row[]) ?? []), {}])}
                className="m-2 rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                + Add row
              </button>
            </div>
          ) : f.input === "textarea" ? (
            <textarea
              rows={4}
              value={String(values[f.key] ?? "")}
              onChange={(e) => set(f.key, e.target.value)}
              className={unsure.has(f.key) ? amberClass : inputClass}
            />
          ) : (
            <input
              type={f.input === "number" ? "number" : f.input === "date" ? "date" : "text"}
              step={f.input === "number" ? "any" : undefined}
              value={String(values[f.key] ?? "")}
              onChange={(e) => set(f.key, e.target.value)}
              className={unsure.has(f.key) ? amberClass : inputClass}
            />
          )}
        </div>
      ))}

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
