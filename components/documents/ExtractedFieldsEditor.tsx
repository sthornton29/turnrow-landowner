"use client";

import { EXTRACTED_FIELDS, type ExtractedFieldDef, type ScanKind } from "@/lib/documents";
import { normalizeFsaExtraction } from "@/lib/gov/fsaImport";

// The amber field editor shared by the intake confirm screen and the
// re-scan review (DocumentReview): every field of a scan kind, editable,
// uncertain ones ringed amber; tables and 156EZ farm cards included.
// Pure UI over a values object the caller owns; the caller saves.

export const FARM_SCALARS: Array<{ key: string; label: string; input: "text" | "number" }> = [
  { key: "farm_number", label: "FSA farm number", input: "text" },
  { key: "county", label: "County", input: "text" },
  { key: "state", label: "State", input: "text" },
  { key: "tract_numbers", label: "Tract numbers", input: "text" },
  { key: "farmland_acres", label: "Farmland acres", input: "number" },
  { key: "cropland_acres", label: "Cropland acres", input: "number" },
  { key: "dcp_cropland_acres", label: "DCP cropland acres", input: "number" },
];

export type Row = Record<string, unknown>;

export const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-kelly-500 focus:outline-none";
export const amberClass =
  "w-full rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 text-sm ring-2 ring-amber-100 focus:border-kelly-500 focus:outline-none";

// Seed editable values for a scan kind from an extraction object.
export function initialValuesFor(
  scanKind: ScanKind,
  extraction: Record<string, unknown>
): Record<string, unknown> {
  const fields = EXTRACTED_FIELDS[scanKind] ?? [];
  const v: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = extraction[f.key];
    if (f.input === "table") {
      v[f.key] = Array.isArray(raw) ? (raw as Row[]).map((r) => ({ ...r })) : [];
    } else if (f.input === "farms") {
      v[f.key] = normalizeFsaExtraction(extraction).map((farm) => ({
        ...farm,
        base_acres: (farm.base_acres ?? []).map((r) => ({ ...r })),
      }));
    } else {
      v[f.key] = raw ?? "";
    }
  }
  return v;
}

const numOrNull = (x: unknown) => {
  const t = String(x ?? "").trim();
  return t === "" ? null : Number(t);
};
const strOrNull = (x: unknown) => {
  const t = String(x ?? "").trim();
  return t === "" ? null : t;
};

// Normalize edited values into the stored extracted shape.
export function finalizeValues(
  scanKind: ScanKind,
  values: Record<string, unknown>
): Record<string, unknown> {
  const fields = EXTRACTED_FIELDS[scanKind] ?? [];
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
      out[f.key] = numOrNull(v);
    } else {
      out[f.key] = strOrNull(v);
    }
  }
  out.scan_kind = scanKind;
  out.unsure_fields = [];
  return out;
}

export default function ExtractedFieldsEditor({
  scanKind,
  values,
  onChange,
  unsure,
  meta,
}: {
  scanKind: ScanKind;
  values: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  unsure: Set<string>;
  meta?: { pages_scanned?: unknown; total_pages?: unknown; chunks?: unknown };
}) {
  const fields: ExtractedFieldDef[] = EXTRACTED_FIELDS[scanKind] ?? [];

  const set = (key: string, value: unknown) => onChange({ ...values, [key]: value });
  const setCell = (key: string, idx: number, col: string, value: string) => {
    const rows = [...((values[key] as Row[]) ?? [])];
    rows[idx] = { ...rows[idx], [col]: value };
    set(key, rows);
  };
  const setFarm = (key: string, idx: number, col: string, value: unknown) => {
    const farms = [...((values[key] as Row[]) ?? [])];
    farms[idx] = { ...farms[idx], [col]: value };
    set(key, farms);
  };
  const setFarmCell = (key: string, farmIdx: number, rowIdx: number, col: string, value: string) => {
    const farms = [...((values[key] as Row[]) ?? [])];
    const rows = [...((farms[farmIdx]?.base_acres as Row[]) ?? [])];
    rows[rowIdx] = { ...rows[rowIdx], [col]: value };
    farms[farmIdx] = { ...farms[farmIdx], base_acres: rows };
    set(key, farms);
  };

  return (
    <div className="space-y-3">
      {fields.map((f) => (
        <div key={f.key}>
          <label className="mb-1 block text-sm font-medium text-gray-700">{f.label}</label>
          {f.input === "farms" ? (
            <div className="space-y-3">
              {meta?.total_pages != null && meta?.pages_scanned != null ? (
                <p className="text-xs text-gray-500">
                  {String(meta.pages_scanned)} of {String(meta.total_pages)} pages read
                  {Number(meta.chunks) > 1 ? ` in ${String(meta.chunks)} parts, merged by farm number` : ""}.
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
                      <th key={c.key} className="px-2 py-1 font-medium">{c.label}</th>
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
                          onClick={() => set(f.key, ((values[f.key] as Row[]) ?? []).filter((_, j) => j !== i))}
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
    </div>
  );
}
