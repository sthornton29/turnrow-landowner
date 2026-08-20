"use client";

// "Upload settlement": PDF, photo, or Excel/CSV logger/mill settlement
// in; reviewed timber_settlements rows out. From a sale's page the sale
// is fixed; from the timber module without a sale the AI-suggested
// match (buyer/products) preselects and the user confirms.

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { suggestSaleId } from "@/lib/timberMatch";
import SettlementReview, {
  type SaleOption,
  type SettlementExtraction,
} from "./SettlementReview";

interface Item {
  localId: string;
  file: File;
  status: "extracting" | "review" | "error";
  error: string | null;
  extraction: SettlementExtraction | null;
  suggestedSaleId: string;
  suggested: boolean;
}

export default function SettlementUpload({
  orgId,
  sales,
  fixedSaleId = null,
  buttonClass,
}: {
  orgId: string;
  sales: SaleOption[];
  fixedSaleId?: string | null;
  buttonClass?: string;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const paySales = useMemo(
    () => sales.filter((s) => s.sale_type === "pay_as_cut"),
    [sales]
  );

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      const localId = crypto.randomUUID();
      setItems((prev) => [
        ...prev,
        {
          localId,
          file,
          status: "extracting",
          error: null,
          extraction: null,
          suggestedSaleId: fixedSaleId ?? "",
          suggested: false,
        },
      ]);
      const form = new FormData();
      form.append("file", file);
      form.append("kind", "timber_settlement");
      try {
        const res = await fetch("/api/extract", { method: "POST", body: form });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Extraction failed.");
        const x = body.extraction as SettlementExtraction;
        setItems((prev) =>
          prev.map((it) => {
            if (it.localId !== localId) return it;
            let suggestedSaleId = fixedSaleId ?? "";
            let suggested = false;
            if (!fixedSaleId) {
              const products = (x.lines ?? [])
                .map((l) => l.product)
                .filter(Boolean) as string[];
              const hit = suggestSaleId(x.payer_name, products, paySales);
              if (hit) {
                suggestedSaleId = hit;
                suggested = true;
              }
            }
            return {
              ...it,
              status: "review" as const,
              extraction: x,
              suggestedSaleId,
              suggested,
            };
          })
        );
      } catch (err) {
        setItems((prev) =>
          prev.map((it) =>
            it.localId === localId
              ? {
                  ...it,
                  status: "error" as const,
                  error: err instanceof Error ? err.message : "Extraction failed.",
                }
              : it
          )
        );
      }
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        className={
          buttonClass ??
          "rounded-lg border border-kelly-500 px-3 py-1.5 text-sm font-medium text-kelly-700 hover:bg-kelly-50"
        }
      >
        Upload settlement
      </button>
      {open ? (
        <div className="mt-3 w-full space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-600">
            Logger or mill settlements as PDFs, photos, or Excel/CSV exports.
            Per-load detail collapses to per-product period lines; you review
            everything (rates checked against the contract) before it saves.
          </p>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="application/pdf,image/jpeg,image/png,image/webp,.xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            onChange={(e) => handleFiles(e.target.files)}
            className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-kelly-500 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white hover:file:bg-kelly-600"
          />

          {items.map((item) => (
            <div
              key={item.localId}
              className="space-y-2 rounded-lg border border-gray-200 p-3"
            >
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-gray-900">{item.file.name}</span>
                {item.status === "extracting" ? (
                  <span className="text-xs text-gray-500">Extracting...</span>
                ) : null}
              </p>
              {item.error ? (
                <p className="text-sm text-red-600">{item.error}</p>
              ) : null}
              {item.status === "review" && item.extraction ? (
                <SettlementReview
                  orgId={orgId}
                  file={item.file}
                  extraction={item.extraction}
                  sales={paySales}
                  initialSaleId={item.suggestedSaleId}
                  saleSuggested={item.suggested}
                  saleLocked={Boolean(fixedSaleId)}
                  onSaved={() => router.refresh()}
                  onDiscard={() =>
                    setItems((prev) =>
                      prev.filter((x) => x.localId !== item.localId)
                    )
                  }
                />
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
