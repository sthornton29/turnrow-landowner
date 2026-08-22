"use client";

import { useState } from "react";

// Admin card: feed the parcel identifier store from county records.
// Re-harvest re-reads stored attributes; Fetch fills attributes for
// parcels imported before retention (where the registry service exists).
export default function ParcelIdentifierTools() {
  const [busy, setBusy] = useState<"harvest" | "fetch" | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [failures, setFailures] = useState<string[]>([]);

  async function run(kind: "harvest" | "fetch") {
    setBusy(kind);
    setResult(null);
    setFailures([]);
    try {
      const res = await fetch(kind === "harvest" ? "/api/parcels/reharvest" : "/api/gis/parcel-attributes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(String(body.error ?? `Failed (${res.status})`));
      setResult(
        kind === "harvest"
          ? `${body.parcels ?? 0} parcels scanned, ${body.identifiers ?? 0} identifiers recorded.`
          : `${body.updated ?? 0} parcels updated, ${body.skipped ?? 0} skipped (no service or no match).`
      );
      setFailures(Array.isArray(body.failures) ? (body.failures as string[]) : []);
    } catch (e) {
      setResult(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(null);
    }
  }

  const btn = "rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60";
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-gray-900">Parcel identifiers</h3>
      <p className="mt-0.5 text-xs text-gray-500">
        Every number a county prints for a parcel (PPIN, folio, key...) is kept on the parcel so tax statements match on the county&apos;s own numbers.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={() => run("harvest")} disabled={busy !== null} className={btn}>
          {busy === "harvest" ? "Working..." : "Re-harvest identifiers from stored attributes"}
        </button>
        <button onClick={() => run("fetch")} disabled={busy !== null} className={btn}>
          {busy === "fetch" ? "Fetching..." : "Fetch attributes for parcels imported before retention"}
        </button>
      </div>
      {result ? <p className="mt-2 text-xs text-gray-700">{result}</p> : null}
      {failures.length > 0 ? (
        <ul className="mt-1 list-disc pl-5 text-xs text-red-700">
          {failures.slice(0, 10).map((f) => (
            <li key={f}>{f}</li>
          ))}
          {failures.length > 10 ? <li>and {failures.length - 10} more</li> : null}
        </ul>
      ) : null}
    </section>
  );
}
