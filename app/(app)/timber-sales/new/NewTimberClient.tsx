"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { takeHandoffFile } from "@/lib/fileHandoff";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { extractFile } from "@/components/documents/classify";
import { suggestStandIds } from "@/lib/timberMatch";
import TimberSaleForm, {
  type StandOption,
  type TimberPrefill,
} from "@/components/timber/TimberSaleForm";

export default function NewTimberClient({
  orgId,
  tenants,
  stands,
}: {
  orgId: string;
  tenants: Array<{ id: string; name: string }>;
  stands: StandOption[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"choose" | "extracting" | "form">("choose");
  const [prefill, setPrefill] = useState<TimberPrefill | null>(null);
  const [unsure, setUnsure] = useState<string[]>([]);
  const [suggested, setSuggested] = useState<string[]>([]);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);
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
      // By storage path (never through the request body, which the
      // platform caps at 4.5 MB): a large scan uploads straight to
      // storage and the reader pulls it from there.
      const res = await extractFile(supabase, { orgId, file, kind: "timber" });
      if ("error" in res) throw new Error(res.error);
      // The form attaches the contract itself when the sale is saved, so
      // the copy uploaded for reading is not kept.
      supabase.storage.from("documents").remove([res.storagePath]).then(() => undefined, () => undefined);
      const x = res.extraction as TimberPrefill & { unsure_fields?: unknown };
      setPrefill(x);
      setUnsure(Array.isArray(x.unsure_fields) ? x.unsure_fields.map(String) : []);
      // Suggest stand links from the contract's tract description
      // (name/acres similarity); the user confirms every link.
      setSuggested(
        suggestStandIds(x.tract_description ?? null, x.sale_acres ?? null, stands)
      );
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
              PDF or photo of the timber sale contract (lump sum, pay-as-cut,
              or delivered price). You review everything before saving.
            </span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
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
            Extracting sale type, rates, deadline, deposit, and the land it
            covers. Usually under a minute.
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
            standOptions={stands}
            suggestedStandIds={suggested}
          />
        </div>
      ) : null}
    </div>
  );
}
