"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { takeHandoffFile } from "@/lib/fileHandoff";
import Link from "next/link";
import LeaseForm, { type LeasePrefill } from "@/components/leases/LeaseForm";
import type { MatchableParcel, MatchableProperty } from "@/lib/leaseLand";

// Create-lease flow: upload-and-extract is the primary path, manual entry
// always available. Nothing saves until the user reviews and confirms.
export default function NewLeaseClient({
  orgId,
  tenants,
  properties,
  parcels,
}: {
  orgId: string;
  tenants: Array<{ id: string; name: string }>;
  properties: MatchableProperty[];
  parcels: MatchableParcel[];
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"choose" | "extracting" | "form">("choose");
  const [prefill, setPrefill] = useState<LeasePrefill | null>(null);
  const [unsure, setUnsure] = useState<string[]>([]);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);
  // A file handed over from the document intake (?handoff=key) runs
  // through the same extraction as a file chosen here.
  const searchParams = useSearchParams();
  const handoffKey = searchParams.get("handoff");
  useEffect(() => {
    if (!handoffKey) return;
    takeHandoffFile(handoffKey).then((f) => {
      if (f) extract(f);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoffKey]);

  async function extract(file: File) {
    setMode("extracting");
    setExtractError(null);
    setSourceFile(file);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("kind", "lease");
      const res = await fetch("/api/extract", { method: "POST", body: formData });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Extraction failed.");
      setPrefill(body.extraction as LeasePrefill);
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
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <div>
        <Link href="/leases" className="text-sm text-gray-500 hover:underline">
          &larr; Leases
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-gray-900">New lease</h1>
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
              Upload lease document and extract terms
            </span>
            <span className="text-sm text-gray-600">
              PDF of the signed lease. The AI fills in the form; you review and
              correct everything before saving.
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
          <p className="font-medium text-gray-900">Reading the document...</p>
          <p className="mt-1 text-sm text-gray-500">
            Extracting parties, dates, rent structure, payment schedule, and
            which of your properties the lease covers. This usually takes
            under a minute.
          </p>
        </div>
      ) : null}

      {mode === "form" ? (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <LeaseForm
            orgId={orgId}
            tenants={tenants}
            prefill={prefill}
            unsure={unsure}
            sourceFile={sourceFile}
            properties={properties}
            parcels={parcels}
          />
        </div>
      ) : null}
    </div>
  );
}
