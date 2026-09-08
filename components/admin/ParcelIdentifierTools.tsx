"use client";

import { useState } from "react";

interface ServiceRef {
  id: string;
  county: string;
  state: string;
  display_name: string;
  status: string;
}

// Admin card: feed the parcel identifier store from county records.
//   Re-harvest re-reads stored attributes (after the harvest patterns
//   or the registry mappings improve);
//   Fetch fills attributes for parcels imported before retention;
//   the per-county buttons re-fetch EVERY parcel in that county by
//   parcel number and store the mapped identifiers (migration 0042),
//   reporting how many parcels gained a PPIN.
export default function ParcelIdentifierTools({ services = [] }: { services?: ServiceRef[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [failures, setFailures] = useState<string[]>([]);

  async function run(kind: "harvest" | "fetch" | "county", svc?: ServiceRef) {
    setBusy(kind === "county" ? `county:${svc?.id}` : kind);
    setResult(null);
    setFailures([]);
    try {
      const res = await fetch(kind === "harvest" ? "/api/parcels/reharvest" : "/api/gis/parcel-attributes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(kind === "county" && svc ? { county: svc.county, state: svc.state } : {}),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(String(body.error ?? `Failed (${res.status})`));
      if (kind === "harvest") {
        setResult(`${body.parcels ?? 0} parcels scanned, ${body.identifiers ?? 0} identifiers recorded.`);
      } else {
        const where = kind === "county" && svc ? ` in ${svc.county} County` : "";
        setResult(
          `${body.updated ?? 0} parcels refreshed${where}, ${body.identifiers ?? 0} identifiers recorded, ${body.gained_ppin ?? 0} parcels gained a PPIN, ${body.skipped ?? 0} skipped (no service or no match).`
        );
      }
      setFailures(Array.isArray(body.failures) ? (body.failures as string[]) : []);
    } catch (e) {
      setResult(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(null);
    }
  }

  const active = services.filter((s) => s.status === "active");
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
      {active.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs font-medium text-gray-700">Refresh identifiers from county records, by county</p>
          <p className="text-xs text-gray-500">
            Re-reads every parcel in the county by parcel number and stores the identifiers the service maps (PPIN, PIN, ...), including parcels that already have attributes.
          </p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {active.map((s) => (
              <button key={s.id} onClick={() => run("county", s)} disabled={busy !== null} className={btn}>
                {busy === `county:${s.id}` ? "Refreshing..." : `${s.county} County, ${s.state}`}
              </button>
            ))}
          </div>
        </div>
      ) : null}
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
