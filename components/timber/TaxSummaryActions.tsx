"use client";

import { useRouter } from "next/navigation";

// Year and taxpayer pickers (they change the URL) plus Print and CSV for
// the annual timber tax summary.

export default function TaxSummaryActions({
  year,
  years,
  entityKey,
  entityOptions,
  csv,
  fileName,
}: {
  year: number;
  years: number[];
  entityKey: string;
  entityOptions: Array<{ key: string; name: string }>;
  csv: string;
  fileName: string;
}) {
  const router = useRouter();
  const go = (y: number, e: string) => router.push(`/timber/tax-summary?year=${y}&entity=${encodeURIComponent(e)}`);

  function downloadCsv() {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <select
        value={year}
        onChange={(e) => go(Number(e.target.value), entityKey)}
        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
      >
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
      <select
        value={entityKey}
        onChange={(e) => go(year, e.target.value)}
        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
      >
        {entityOptions.map((o) => (
          <option key={o.key} value={o.key}>
            {o.name}
          </option>
        ))}
      </select>
      <button
        onClick={() => window.print()}
        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
      >
        Print or save PDF
      </button>
      <button
        onClick={downloadCsv}
        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
      >
        Download CSV
      </button>
    </div>
  );
}
