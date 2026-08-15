"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import TimberSaleForm, { type TimberPrefill } from "@/components/timber/TimberSaleForm";

export default function NewTimberClient({
  orgId,
  tenants,
}: {
  orgId: string;
  tenants: Array<{ id: string; name: string }>;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"choose" | "extracting" | "form">("choose");
  const [prefill, setPrefill] = useState<TimberPrefill | null>(null);
  const [unsure, setUnsure] = useState<string[]>([]);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);

  async function extract(file: File) {
    setMode("extracting");
    setExtractError(null);
    setSourceFile(file);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("kind", "timber");
      const res = await fetch("/api/extract", { method: "POST", body: formData });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Extraction failed.");
      setPrefill(body.extraction as TimberPrefill);
      setUnsure((body.extraction.unsure_fields as string[]) ?? []);
      setMode("form");
    } catch (err) {
      setExtractError(
        (err instanceof Error ? err.message : "Extraction failed.") +
          " You can enter the terms manually instead."
      );
      setMode("choose");
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      <div>
        <Link href="/timber-sales" className="text-sm text-gray-500 hover:underline">
          &larr; Timber sales
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-gray-900">New timber sale</h1>
      </div>

      {mode === "choose" ? (
        <div className="space-y-3">
          {extractError ? (
            <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {extractError}
            </p>
          ) : null}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex w-full flex-col items-center gap-1 rounded-xl border-2 border-dashed border-kelly-500 bg-kelly-50 px-4 py-8 text-center transition hover:bg-kelly-100"
          >
            <span className="font-semibold text-pine-900">
              Upload contract and extract terms
            </span>
            <span className="text-sm text-gray-600">
              PDF of the timber sale contract. You review everything before saving.
            </span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) extract(f);
            }}
          />
          <button
            onClick={() => setMode("form")}
            className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Enter terms manually
          </button>
        </div>
      ) : null}

      {mode === "extracting" ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
          <p className="font-medium text-gray-900">Reading the contract...</p>
          <p className="mt-1 text-sm text-gray-500">
            Extracting sale type, rates, deadline, and deposit. Usually under a minute.
          </p>
        </div>
      ) : null}

      {mode === "form" ? (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <TimberSaleForm
            orgId={orgId}
            tenants={tenants}
            prefill={prefill}
            unsure={unsure}
            sourceFile={sourceFile}
          />
        </div>
      ) : null}
    </div>
  );
}
