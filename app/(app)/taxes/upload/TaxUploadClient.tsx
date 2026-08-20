"use client";

import { useSearchParams } from "next/navigation";
import { takeHandoffFile } from "@/lib/fileHandoff";

import { useMemo, useRef, useState, useEffect } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { formatDollars } from "@/lib/format";
import {
  defaultDates,
  matchParcel,
  type CountyDefault,
} from "@/lib/tax";

interface Parcel {
  id: string;
  parcel_number: string;
  county: string | null;
  property_id: string;
}

interface StatementFields {
  county: string;
  state: string;
  authority_name: string;
  parcel_number_printed: string;
  owner_name_printed: string;
  tax_year: number;
  assessed_value: string;
  amount_due: string;
  due_date: string;
  delinquent_date: string;
  notes: string;
}

interface UploadItem {
  localId: string;
  file: File;
  status: "extracting" | "review" | "saving" | "saved" | "error";
  error: string | null;
  unsure: string[];
  fields: StatementFields;
  matchMode: "existing" | "create" | "unmatched";
  parcelId: string;
  newParcelNumber: string;
  newParcelCounty: string;
  newParcelPropertyId: string;
  rememberDates: boolean;
}

const inputClass = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";

export default function TaxUploadClient({
  orgId,
  parcels,
  properties,
  countyDefaults,
}: {
  orgId: string;
  parcels: Parcel[];
  properties: Array<{ id: string; name: string }>;
  countyDefaults: CountyDefault[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<UploadItem[]>([]);
  const propertyName = new Map(properties.map((p) => [p.id, p.name]));

  function patchItem(localId: string, patch: Partial<UploadItem>) {
    setItems((list) =>
      list.map((it) => (it.localId === localId ? { ...it, ...patch } : it))
    );
  }
  function patchFields(localId: string, patch: Partial<StatementFields>) {
    setItems((list) =>
      list.map((it) =>
        it.localId === localId ? { ...it, fields: { ...it.fields, ...patch } } : it
      )
    );
  }

  const searchParams = useSearchParams();
  const handoffKey = searchParams.get("handoff");
  useEffect(() => {
    if (!handoffKey) return;
    takeHandoffFile(handoffKey).then((f) => {
      if (!f) return;
      const dt = new DataTransfer();
      dt.items.add(f);
      handleFiles(dt.files);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoffKey]);

  async function handleFiles(fileList: FileList | null) {
    if (!fileList) return;
    for (const file of Array.from(fileList)) {
      const localId = crypto.randomUUID();
      const currentYear = new Date().getFullYear();
      const blank: UploadItem = {
        localId,
        file,
        status: "extracting",
        error: null,
        unsure: [],
        fields: {
          county: "",
          state: "",
          authority_name: "",
          parcel_number_printed: "",
          owner_name_printed: "",
          tax_year: currentYear,
          assessed_value: "",
          amount_due: "",
          due_date: "",
          delinquent_date: "",
          notes: "",
        },
        matchMode: "unmatched",
        parcelId: "",
        newParcelNumber: "",
        newParcelCounty: "",
        newParcelPropertyId: properties[0]?.id ?? "",
        rememberDates: false,
      };
      setItems((list) => [...list, blank]);
      extractItem(blank);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function extractItem(item: UploadItem) {
    try {
      const formData = new FormData();
      formData.append("file", item.file);
      formData.append("kind", "tax");
      const res = await fetch("/api/extract", { method: "POST", body: formData });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Extraction failed.");
      const x = body.extraction as Record<string, unknown>;
      const taxYear = Number(x.tax_year) || new Date().getFullYear();
      const county = String(x.county ?? "");
      const state = String(x.state ?? "");
      const dates = defaultDates(taxYear, county, state, countyDefaults);
      const printed = String(x.parcel_number ?? "");
      const match = matchParcel(printed, parcels);
      patchItem(item.localId, {
        status: "review",
        unsure: (x.unsure_fields as string[]) ?? [],
        matchMode: match ? "existing" : "unmatched",
        parcelId: match?.id ?? "",
        newParcelNumber: printed,
        newParcelCounty: county,
        fields: {
          county,
          state,
          authority_name: String(x.authority_name ?? ""),
          parcel_number_printed: printed,
          owner_name_printed: String(x.owner_name ?? ""),
          tax_year: taxYear,
          assessed_value: x.assessed_value != null ? String(x.assessed_value) : "",
          amount_due: x.amount_due != null ? String(x.amount_due) : "",
          due_date: String(x.due_date ?? "") || dates.due_date,
          delinquent_date: dates.delinquent_date,
          notes: "",
        },
      });
    } catch (err) {
      patchItem(item.localId, {
        status: "review",
        error:
          (err instanceof Error ? err.message : "Extraction failed.") +
          " Fill in the fields manually.",
      });
    }
  }

  async function saveItem(item: UploadItem) {
    patchItem(item.localId, { status: "saving", error: null });
    const f = item.fields;

    // Resolve the parcel per the chosen option; never silently create.
    let parcelId: string | null = null;
    if (item.matchMode === "existing") {
      parcelId = item.parcelId || null;
      if (!parcelId) {
        patchItem(item.localId, { status: "review", error: "Pick the parcel to match." });
        return;
      }
    } else if (item.matchMode === "create") {
      if (!item.newParcelNumber.trim() || !item.newParcelPropertyId) {
        patchItem(item.localId, {
          status: "review",
          error: "The new parcel needs a parcel number and a property.",
        });
        return;
      }
      const { data, error } = await supabase
        .from("parcels")
        .insert({
          organization_id: orgId,
          property_id: item.newParcelPropertyId,
          parcel_number: item.newParcelNumber.trim(),
          county: item.newParcelCounty.trim() || null,
        })
        .select("id")
        .single();
      if (error || !data) {
        patchItem(item.localId, {
          status: "review",
          error: "Could not create the parcel: " + (error?.message ?? ""),
        });
        return;
      }
      parcelId = data.id;
    }

    const { data: statement, error: err } = await supabase
      .from("tax_statements")
      .insert({
        organization_id: orgId,
        parcel_id: parcelId,
        tax_year: f.tax_year,
        county: f.county.trim() || null,
        state: f.state.trim() || null,
        authority_name: f.authority_name.trim() || null,
        parcel_number_printed: f.parcel_number_printed.trim() || null,
        owner_name_printed: f.owner_name_printed.trim() || null,
        assessed_value: f.assessed_value.trim() === "" ? null : Number(f.assessed_value),
        amount_due: f.amount_due.trim() === "" ? 0 : Number(f.amount_due),
        due_date: f.due_date || null,
        delinquent_date: f.delinquent_date || null,
        notes: f.notes.trim() || null,
      })
      .select("id")
      .single();

    if (err || !statement) {
      const duplicate = err?.message.includes("duplicate") || err?.code === "23505";
      patchItem(item.localId, {
        status: "review",
        error: duplicate
          ? `There is already a ${f.tax_year} statement for this parcel. Open the Property Taxes page to see it; delete it first if this upload should replace it.`
          : "Could not save: " + (err?.message ?? ""),
      });
      return;
    }

    // Attach the source PDF/photo.
    const path = `${orgId}/tax_statement/${crypto.randomUUID()}-${item.file.name}`;
    const { error: upErr } = await supabase.storage
      .from("documents")
      .upload(path, item.file, { contentType: item.file.type });
    if (!upErr) {
      await supabase.from("documents").insert({
        organization_id: orgId,
        entity_type: "tax_statement",
        entity_id: statement.id,
        file_name: item.file.name,
        storage_path: path,
        content_type: item.file.type,
        size_bytes: item.file.size,
      });
    }

    // Remember these dates as the county default when asked.
    if (item.rememberDates && f.county.trim() && f.due_date && f.delinquent_date) {
      const due = f.due_date.split("-").map(Number);
      const del = f.delinquent_date.split("-").map(Number);
      await supabase.from("county_tax_defaults").upsert(
        {
          organization_id: orgId,
          county: f.county.trim(),
          state: f.state.trim(),
          due_month: due[1],
          due_day: due[2],
          delinquent_month: del[1],
          delinquent_day: del[2],
        },
        { onConflict: "organization_id,county,state" }
      );
    }

    patchItem(item.localId, { status: "saved" });
  }

  const isUnsure = (item: UploadItem, key: string) => item.unsure.includes(key);
  const ring = (item: UploadItem, key: string) =>
    isUnsure(item, key) ? " border-amber-400 ring-2 ring-amber-100" : "";

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <div>
        <Link href="/taxes" className="text-sm text-gray-500 hover:underline">
          &larr; Taxes
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-gray-900">
          Upload tax statements
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          PDFs or phone photos, several at once. Each statement is extracted,
          matched to a parcel, and reviewed by you before anything saves.
        </p>
      </div>

      <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-kelly-500 bg-kelly-50 px-4 py-8 text-center transition hover:bg-kelly-100">
        <span className="font-semibold text-pine-900">Choose statements</span>
        <span className="text-xs text-gray-600">
          PDF, JPEG, PNG, or WebP. iPhone photos: share as JPEG.
        </span>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="application/pdf,image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </label>

      {items.map((item) => (
        <div
          key={item.localId}
          className={
            "rounded-xl border bg-white p-4 " +
            (item.status === "saved" ? "border-kelly-100 bg-kelly-50" : "border-gray-200")
          }
        >
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-gray-900">{item.file.name}</p>
            <span className="ml-auto text-xs text-gray-500">
              {item.status === "extracting"
                ? "Reading..."
                : item.status === "saving"
                  ? "Saving..."
                  : item.status === "saved"
                    ? "Saved"
                    : ""}
            </span>
          </div>

          {item.status === "saved" ? (
            <p className="mt-1 text-sm text-pine-900">
              Statement saved for tax year {item.fields.tax_year}.
            </p>
          ) : null}

          {(item.status === "review" || item.status === "saving") && (
            <div className="mt-3 space-y-3">
              {item.error ? (
                <p className="rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-700">
                  {item.error}
                </p>
              ) : null}
              {item.unsure.length > 0 ? (
                <p className="text-xs text-amber-700">
                  Amber fields were uncertain in the extraction; check them
                  against the statement.
                </p>
              ) : null}

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <div>
                  <label className="mb-0.5 block text-xs font-medium text-gray-600">County</label>
                  <input
                    value={item.fields.county}
                    onChange={(e) => patchFields(item.localId, { county: e.target.value })}
                    className={inputClass + ring(item, "county")}
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-xs font-medium text-gray-600">State</label>
                  <input
                    value={item.fields.state}
                    onChange={(e) => patchFields(item.localId, { state: e.target.value })}
                    className={inputClass + ring(item, "state")}
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-xs font-medium text-gray-600">Tax year</label>
                  <input
                    type="number"
                    value={item.fields.tax_year}
                    onChange={(e) =>
                      patchFields(item.localId, { tax_year: Number(e.target.value) })
                    }
                    className={inputClass + ring(item, "tax_year")}
                  />
                </div>
                <div className="col-span-2 sm:col-span-3">
                  <label className="mb-0.5 block text-xs font-medium text-gray-600">
                    Taxing authority
                  </label>
                  <input
                    value={item.fields.authority_name}
                    onChange={(e) =>
                      patchFields(item.localId, { authority_name: e.target.value })
                    }
                    className={inputClass + ring(item, "authority_name")}
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-xs font-medium text-gray-600">
                    Parcel number (as printed)
                  </label>
                  <input
                    value={item.fields.parcel_number_printed}
                    onChange={(e) =>
                      patchFields(item.localId, { parcel_number_printed: e.target.value })
                    }
                    className={inputClass + ring(item, "parcel_number")}
                  />
                </div>
                <div className="col-span-2 sm:col-span-2">
                  <label className="mb-0.5 block text-xs font-medium text-gray-600">
                    Owner (as printed)
                  </label>
                  <input
                    value={item.fields.owner_name_printed}
                    onChange={(e) =>
                      patchFields(item.localId, { owner_name_printed: e.target.value })
                    }
                    className={inputClass + ring(item, "owner_name")}
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-xs font-medium text-gray-600">
                    Assessed value ($)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={item.fields.assessed_value}
                    onChange={(e) =>
                      patchFields(item.localId, { assessed_value: e.target.value })
                    }
                    className={inputClass + ring(item, "assessed_value")}
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-xs font-medium text-gray-600">
                    Amount due ($)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={item.fields.amount_due}
                    onChange={(e) => patchFields(item.localId, { amount_due: e.target.value })}
                    className={inputClass + ring(item, "amount_due")}
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-xs font-medium text-gray-600">Due date</label>
                  <input
                    type="date"
                    value={item.fields.due_date}
                    onChange={(e) => patchFields(item.localId, { due_date: e.target.value })}
                    className={inputClass + ring(item, "due_date")}
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-xs font-medium text-gray-600">
                    Delinquent date
                  </label>
                  <input
                    type="date"
                    value={item.fields.delinquent_date}
                    onChange={(e) =>
                      patchFields(item.localId, { delinquent_date: e.target.value })
                    }
                    className={inputClass}
                  />
                </div>
                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600">
                    <input
                      type="checkbox"
                      checked={item.rememberDates}
                      onChange={(e) =>
                        patchItem(item.localId, { rememberDates: e.target.checked })
                      }
                      className="h-4 w-4 accent-kelly-500"
                    />
                    Remember dates for this county
                  </label>
                </div>
              </div>

              {/* Parcel matching */}
              <div
                className={
                  "space-y-2 rounded-lg border p-3 " +
                  (item.matchMode === "existing"
                    ? "border-kelly-100 bg-kelly-50"
                    : "border-amber-200 bg-amber-50")
                }
              >
                {item.matchMode === "existing" && item.parcelId ? (
                  <p className="text-sm font-medium text-pine-900">
                    Matched to an existing parcel; confirm below.
                  </p>
                ) : (
                  <p className="text-sm font-medium text-amber-800">
                    No parcel matched this parcel number. Choose what to do:
                  </p>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      ["existing", "Match existing parcel"],
                      ["create", "Create the parcel"],
                      ["unmatched", "Save as unmatched"],
                    ] as Array<[UploadItem["matchMode"], string]>
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => patchItem(item.localId, { matchMode: mode })}
                      className={
                        "rounded-lg border px-2 py-1 text-xs font-medium " +
                        (item.matchMode === mode
                          ? "border-kelly-500 bg-white text-pine-900"
                          : "border-gray-300 bg-white text-gray-600")
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {item.matchMode === "existing" ? (
                  <select
                    value={item.parcelId}
                    onChange={(e) => patchItem(item.localId, { parcelId: e.target.value })}
                    className={inputClass}
                  >
                    <option value="">Select a parcel...</option>
                    {parcels.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.parcel_number}
                        {p.county ? ` (${p.county})` : ""} ·{" "}
                        {propertyName.get(p.property_id) ?? ""}
                      </option>
                    ))}
                  </select>
                ) : null}
                {item.matchMode === "create" ? (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <input
                      value={item.newParcelNumber}
                      onChange={(e) =>
                        patchItem(item.localId, { newParcelNumber: e.target.value })
                      }
                      placeholder="Parcel number"
                      className={inputClass}
                    />
                    <input
                      value={item.newParcelCounty}
                      onChange={(e) =>
                        patchItem(item.localId, { newParcelCounty: e.target.value })
                      }
                      placeholder="County"
                      className={inputClass}
                    />
                    <select
                      value={item.newParcelPropertyId}
                      onChange={(e) =>
                        patchItem(item.localId, { newParcelPropertyId: e.target.value })
                      }
                      className={inputClass}
                    >
                      {properties.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-500 sm:col-span-3">
                      The boundary can be drawn or imported on the map later.
                    </p>
                  </div>
                ) : null}
                {item.matchMode === "unmatched" ? (
                  <p className="text-xs text-gray-600">
                    Saved without a parcel; it will appear under Unmatched on
                    the Property Taxes page for you to resolve.
                  </p>
                ) : null}
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => saveItem(item)}
                  disabled={item.status === "saving"}
                  className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-60"
                >
                  {item.status === "saving" ? "Saving..." : "Save statement"}
                </button>
                {item.fields.amount_due ? (
                  <span className="text-sm text-gray-500">
                    {formatDollars(Number(item.fields.amount_due))} due
                  </span>
                ) : null}
                <button
                  onClick={() =>
                    setItems((list) => list.filter((x) => x.localId !== item.localId))
                  }
                  className="ml-auto text-sm text-gray-500 hover:underline"
                >
                  Discard
                </button>
              </div>
            </div>
          )}
        </div>
      ))}

      {items.length > 0 && items.every((i) => i.status === "saved") ? (
        <Link
          href="/taxes"
          className="inline-block rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600"
        >
          All saved; open the Property Taxes page
        </Link>
      ) : null}
    </div>
  );
}
