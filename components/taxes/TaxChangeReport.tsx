"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { NO_ENTITY } from "@/lib/entities";
import { formatDollars } from "@/lib/format";
import { buildTaxChangeReport, type ParcelFlagKind } from "@/lib/taxChange";
import type { TaxStatementLineRow } from "@/lib/tax";

// TAX CHANGE REPORT: multi-year statement lines per parcel turned into
// year-over-year analysis - value and tax changes with a plain-language
// decomposition, effective rates, and the flags that actually matter
// (assessment ratio shifts, exemption changes, spikes, presence gaps).
// All math lives in lib/taxChange.ts (unit-tested); this renders it and
// exports the PDF. Entity-scoped access flows in through the RLS-scoped
// props: a restricted user's report covers their entities only.

const FLAG_LABELS: Record<ParcelFlagKind, string> = {
  ratio_shift: "Assessment ratio shifts",
  exemption_change: "Exemption changes",
  spike: "Value spikes",
  disappeared: "Missing this year",
  appeared: "New this year",
};

const pctText = (fraction: number | null) =>
  fraction == null ? "" : `${fraction >= 0 ? "+" : ""}${(fraction * 100).toFixed(1)}%`;

function loadStoredEntities(): string[] {
  try {
    const raw = window.localStorage.getItem("turnrow.entityFilter.v1");
    return raw ? (JSON.parse(raw) as string[]).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export default function TaxChangeReport({
  lines,
  parcels,
  properties,
  entities,
}: {
  lines: TaxStatementLineRow[];
  parcels: Array<{ id: string; parcel_number: string; county: string | null; property_id: string | null }>;
  properties: Array<{ id: string; name: string; entity_id: string | null }>;
  entities: Array<{ id: string; name: string }>;
}) {
  // Years with actual line data, ascending.
  const dataYears = useMemo(
    () => Array.from(new Set(lines.map((l) => l.tax_year))).sort((a, b) => a - b),
    [lines]
  );
  const latest = dataYears[dataYears.length - 1];
  const prior = dataYears.length > 1 ? dataYears[dataYears.length - 2] : (latest ?? 0) - 1;
  const [y0, setY0] = useState(prior);
  const [y1, setY1] = useState(latest ?? new Date().getFullYear());
  // Entity multi-select, consistent with the income/gov/dashboard
  // filter: chips toggle, empty = all; seeded from the shared stored
  // selection so the "entity view" follows the user here too.
  const [entityKeys, setEntityKeys] = useState<string[]>(() =>
    typeof window === "undefined"
      ? []
      : loadStoredEntities().filter(
          (k) => k === NO_ENTITY || entities.some((e) => e.id === k)
        )
  );
  const [propertyFilter, setPropertyFilter] = useState("");
  const [countyFilter, setCountyFilter] = useState("");
  const [spikePct, setSpikePct] = useState(15);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const counties = useMemo(
    () => Array.from(new Set(parcels.map((p) => p.county).filter(Boolean))).sort() as string[],
    [parcels]
  );

  const entitySet = new Set(entityKeys);
  const scopedPropertyIds = useMemo(() => {
    if (entityKeys.length === 0 && !propertyFilter) return null;
    let ids = properties
      .filter(
        (p) => entityKeys.length === 0 || entitySet.has(p.entity_id ?? NO_ENTITY)
      )
      .map((p) => p.id);
    if (propertyFilter) ids = ids.filter((id) => id === propertyFilter);
    return new Set(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [properties, entityKeys.join(","), propertyFilter]);

  const report = useMemo(
    () =>
      buildTaxChangeReport(lines, parcels, {
        y0,
        y1,
        propertyIds: scopedPropertyIds,
        county: countyFilter || null,
        spikeThreshold: spikePct / 100,
      }),
    [lines, parcels, y0, y1, scopedPropertyIds, countyFilter, spikePct]
  );

  const scopeLine = [
    `${y0} to ${y1}`,
    entityKeys.length > 0
      ? `Entities: ${entityKeys
          .map((k) => (k === NO_ENTITY ? "No entity" : entities.find((e) => e.id === k)?.name ?? "?"))
          .join(", ")}`
      : "All entities",
    propertyFilter
      ? (properties.find((p) => p.id === propertyFilter)?.name ?? "")
      : null,
    countyFilter ? `${countyFilter} County` : null,
    `spike threshold ${spikePct}%`,
  ]
    .filter(Boolean)
    .join(" · ");

  async function exportPdf() {
    setPdfBusy(true);
    setPdfError(null);
    try {
      const { generateTaxReportPdf } = await import("./taxReportPdf");
      await generateTaxReportPdf({ report, scopeLine });
    } catch {
      setPdfError("Could not build the PDF.");
    } finally {
      setPdfBusy(false);
    }
  }

  const inputClass = "rounded-lg border border-gray-300 px-2 py-1.5 text-sm";
  const parcelHref = (parcelId: string) => `/parcels/${parcelId}`;

  const miniChart = (
    title: string,
    values: Array<{ year: number; value: number }>
  ) => {
    const max = Math.max(1, ...values.map((v) => v.value));
    return (
      <div className="flex-1">
        <p className="mb-1 text-xs font-semibold text-gray-700">{title}</p>
        <div className="flex items-end gap-3 overflow-x-auto" style={{ height: 110 }}>
          {values.map((v) => (
            <div key={v.year} className="flex h-full min-w-14 flex-col justify-end">
              <span className="mb-0.5 text-center text-[10px] tabular-nums text-gray-500">
                {v.value > 0 ? formatDollars(v.value) : ""}
              </span>
              <div
                className="w-full rounded-t-[4px] bg-pine-900"
                style={{ height: `${(v.value / max) * 70}%` }}
              />
              <p className="mt-1 text-center text-xs text-gray-500">{v.year}</p>
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (dataYears.length < 2) {
    return (
      <p className="p-4 text-sm text-gray-500">
        The change report needs statement lines from at least two years.
        {dataYears.length === 1
          ? ` Only ${dataYears[0]} is loaded so far; upload another year's statements and the comparison lights up.`
          : ""}
      </p>
    );
  }

  return (
    <div className="space-y-4 p-4">
      {/* Scope selectors */}
      <div className="flex flex-wrap items-center gap-2">
        <select value={y0} onChange={(e) => setY0(Number(e.target.value))} className={inputClass}>
          {dataYears.map((yr) => (
            <option key={yr} value={yr}>
              From {yr}
            </option>
          ))}
        </select>
        <select value={y1} onChange={(e) => setY1(Number(e.target.value))} className={inputClass}>
          {dataYears.map((yr) => (
            <option key={yr} value={yr}>
              To {yr}
            </option>
          ))}
        </select>
        <select
          value={propertyFilter}
          onChange={(e) => setPropertyFilter(e.target.value)}
          className={inputClass}
        >
          <option value="">All properties</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {counties.length > 1 ? (
          <select
            value={countyFilter}
            onChange={(e) => setCountyFilter(e.target.value)}
            className={inputClass}
          >
            <option value="">All counties</option>
            {counties.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        ) : null}
        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          Spike over
          <input
            type="number"
            min={1}
            max={100}
            value={spikePct}
            onChange={(e) => setSpikePct(Math.max(1, Number(e.target.value) || 15))}
            className="w-16 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
          />
          %
        </label>
        <button
          onClick={exportPdf}
          disabled={pdfBusy}
          className="ml-auto rounded-lg bg-kelly-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-60"
        >
          {pdfBusy ? "Building..." : "Export PDF"}
        </button>
      </div>
      {entities.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {[
            { key: "", label: "All entities" },
            ...entities.map((e) => ({ key: e.id, label: e.name })),
            { key: NO_ENTITY, label: "No entity" },
          ].map((chip) => {
            const active = chip.key === "" ? entityKeys.length === 0 : entitySet.has(chip.key);
            return (
              <button
                key={chip.key || "all"}
                onClick={() =>
                  setEntityKeys((prev) =>
                    chip.key === ""
                      ? []
                      : prev.includes(chip.key)
                        ? prev.filter((k) => k !== chip.key)
                        : [...prev, chip.key]
                  )
                }
                className={
                  "rounded-full border px-3 py-1 text-sm font-medium " +
                  (active
                    ? "border-kelly-500 bg-kelly-50 text-pine-900"
                    : "border-gray-200 bg-white text-gray-600 hover:border-gray-300")
                }
              >
                {chip.label}
              </button>
            );
          })}
        </div>
      ) : null}
      {pdfError ? <p className="text-sm text-red-700">{pdfError}</p> : null}

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <p className="text-xs text-gray-500">Total tax {y0} to {y1}</p>
          <p className="text-lg font-semibold tabular-nums text-gray-900">
            {formatDollars(report.summary.tax1)}
          </p>
          <p className="text-xs text-gray-500">
            from {formatDollars(report.summary.tax0)}
            {report.summary.taxPct != null ? ` (${pctText(report.summary.taxPct)})` : ""}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <p className="text-xs text-gray-500">Appraised value {y0} to {y1}</p>
          <p className="text-lg font-semibold tabular-nums text-gray-900">
            {formatDollars(report.summary.appraised1)}
          </p>
          <p className="text-xs text-gray-500">
            from {formatDollars(report.summary.appraised0)}
            {report.summary.appraisedPct != null
              ? ` (${pctText(report.summary.appraisedPct)})`
              : ""}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <p className="text-xs text-gray-500">Parcels compared</p>
          <p className="text-lg font-semibold tabular-nums text-gray-900">
            {report.summary.comparedParcels}
          </p>
        </div>
        <div
          className={
            "rounded-xl border p-3 " +
            (report.summary.flaggedParcels > 0
              ? "border-amber-300 bg-amber-50"
              : "border-gray-200 bg-white")
          }
        >
          <p className="text-xs text-gray-500">Parcels flagged</p>
          <p className="text-lg font-semibold tabular-nums text-gray-900">
            {report.summary.flaggedParcels}
          </p>
        </div>
      </div>

      {/* Trend */}
      <div className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-3 sm:flex-row">
        {miniChart("Total tax by year", report.perYear.map((p) => ({ year: p.year, value: p.totalTax })))}
        {miniChart("Total appraised value by year", report.perYear.map((p) => ({ year: p.year, value: p.totalAppraised })))}
      </div>

      {/* Biggest movers */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <h3 className="border-b border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-900">
          Biggest movers
        </h3>
        {report.movers.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">
            No parcels have lines in both {y0} and {y1} within this scope.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-2">Parcel</th>
                  <th className="px-4 py-2 text-right">Appraised</th>
                  <th className="px-4 py-2 text-right">Tax</th>
                  <th className="px-4 py-2 text-right">Eff. rate</th>
                  <th className="px-4 py-2">What moved it</th>
                </tr>
              </thead>
              <tbody>
                {report.movers.map((m) => (
                  <tr key={m.parcelId} className="border-b border-gray-100 align-top last:border-0">
                    <td className="px-4 py-2">
                      <Link
                        href={parcelHref(m.parcelId)}
                        className="font-medium text-kelly-700 hover:underline"
                      >
                        {m.parcelNumber}
                      </Link>
                      {m.county ? (
                        <span className="block text-xs text-gray-500">{m.county}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {m.y0?.appraised != null && m.y1?.appraised != null ? (
                        <>
                          {formatDollars(m.y0.appraised)}
                          <span className="text-gray-400"> to </span>
                          {formatDollars(m.y1.appraised)}
                          {m.pctAppraised != null ? (
                            <span className="block text-xs text-gray-500">
                              {pctText(m.pctAppraised)}
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-xs text-gray-400">no values</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatDollars(m.y0?.taxDue ?? 0)}
                      <span className="text-gray-400"> to </span>
                      {formatDollars(m.y1?.taxDue ?? 0)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {m.rate0 != null || m.rate1 != null ? (
                        <>
                          {m.rate0 != null ? `${(m.rate0 * 100).toFixed(3)}%` : "-"}
                          <span className="text-gray-400"> to </span>
                          {m.rate1 != null ? `${(m.rate1 * 100).toFixed(3)}%` : "-"}
                        </>
                      ) : (
                        ""
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {m.sentence ?? (
                        <span className="text-xs text-gray-500">
                          No appraised values to decompose.
                        </span>
                      )}
                      {m.flags.length > 0 ? (
                        <span className="mt-1 flex flex-wrap gap-1">
                          {m.flags.map((f, i) => (
                            <span
                              key={i}
                              className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900"
                              title={f.message}
                            >
                              {FLAG_LABELS[f.kind]}
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Flags, most valuable first */}
      {report.flagged.length > 0 ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50">
          <h3 className="border-b border-amber-200 px-4 py-2.5 text-sm font-semibold text-amber-900">
            Flags to check
          </h3>
          <div className="space-y-3 p-4">
            {(Object.keys(FLAG_LABELS) as ParcelFlagKind[]).map((kind) => {
              const rows = report.flagged.flatMap((c) =>
                c.flags
                  .filter((f) => f.kind === kind)
                  .map((f) => ({ id: c.parcelId, parcel: c.parcelNumber, message: f.message }))
              );
              if (rows.length === 0) return null;
              return (
                <div key={kind}>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-800">
                    {FLAG_LABELS[kind]}
                  </p>
                  <ul className="space-y-1">
                    {rows.map((row, i) => (
                      <li key={`${row.id}-${i}`} className="text-sm text-gray-800">
                        <Link
                          href={parcelHref(row.id)}
                          className="font-medium text-kelly-700 hover:underline"
                        >
                          {row.parcel}
                        </Link>
                        : {row.message}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
