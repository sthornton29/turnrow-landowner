"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PDFDocument } from "pdf-lib";
import { createClient } from "@/lib/supabase/client";
import { friendlyDbError } from "@/lib/dbErrors";
import { formatDollars } from "@/lib/format";
import { LINE_VALUE_KEYS, LINE_VALUE_LABELS, valuesFound } from "@/lib/taxLineValues";
import { matchReread, pageChunks, type ExistingLine, type Proposal, type ReadLine } from "@/lib/taxReread";

// RE-READ BILLS: read each stored bill file again for the values a bill
// prints beyond the tax (market and current use value, land, buildings,
// ratio, district, mills, timber acres), match the lines to the ones on
// file, and save only those values after review. Tax amounts and parcel
// matches never change here.

export interface RereadFile {
  storagePath: string;
  fileName: string;
  contentType: string | null;
  label: string; // "Lawrence 2024, 13 statements"
  lines: Array<ExistingLine & { valuesRead: boolean; parcelLabel: string }>;
}

interface Result {
  proposals: Proposal[];
  unmatched: number;
  empty: number;
}

const fmt = (k: string, v: unknown) => {
  if (v === null || v === undefined) return "";
  if (k === "market_value" || k === "current_use_value" || k === "land_value" || k === "improvement_value") return formatDollars(Number(v));
  return String(v);
};

export default function RereadClient({ files }: { files: RereadFile[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [status, setStatus] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, Result>>({});
  const [busyAll, setBusyAll] = useState(false);
  const [saving, setSaving] = useState<string | null>(null); // the file being saved
  const [error, setError] = useState<string | null>(null);

  const setS = (path: string, s: string) => setStatus((x) => ({ ...x, [path]: s }));

  async function readFile(f: RereadFile): Promise<void> {
    setError(null);
    try {
      setS(f.storagePath, "Opening the file...");
      const isPdf = (f.contentType ?? "").includes("pdf") || f.fileName.toLowerCase().endsWith(".pdf");
      let chunks: Array<string | null> = [null];
      if (isPdf) {
        const { data, error: dlErr } = await supabase.storage.from("documents").download(f.storagePath);
        if (dlErr || !data) throw new Error("Could not open the stored file.");
        const doc = await PDFDocument.load(await data.arrayBuffer(), { ignoreEncryption: true });
        chunks = pageChunks(doc.getPageCount());
      }
      const read: ReadLine[] = [];
      for (let i = 0; i < chunks.length; i++) {
        setS(f.storagePath, chunks.length > 1 ? `Reading part ${i + 1} of ${chunks.length}...` : "Reading...");
        const fd = new FormData();
        fd.set("kind", "tax_statement");
        fd.set("storage_path", f.storagePath);
        fd.set("file_name", f.fileName);
        if (f.contentType) fd.set("content_type", f.contentType);
        if (chunks[i]) fd.set("pages", chunks[i]!);
        const res = await fetch("/api/extract", { method: "POST", body: fd });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `Reading failed (${res.status}).`);
        const lines = Array.isArray(json.extraction?.lines) ? (json.extraction.lines as Array<Record<string, unknown>>) : [];
        for (const l of lines) {
          read.push({
            identifiers: Array.isArray(l.identifiers) ? (l.identifiers as ReadLine["identifiers"]) : [],
            tax_due: typeof l.tax_due === "number" ? l.tax_due : null,
            raw: l,
          });
        }
      }
      const r = matchReread(f.lines, read);
      setResults((x) => ({ ...x, [f.storagePath]: r }));
      setS(f.storagePath, `${r.proposals.length} line${r.proposals.length === 1 ? "" : "s"} with values to review`);
    } catch (e) {
      setS(f.storagePath, "");
      setError(e instanceof Error ? e.message : "Reading failed.");
    }
  }

  async function readAll() {
    setBusyAll(true);
    for (const f of files) {
      if (f.lines.every((l) => l.valuesRead) || results[f.storagePath]) continue;
      await readFile(f);
    }
    setBusyAll(false);
  }

  async function apply(f: RereadFile) {
    const r = results[f.storagePath];
    if (!r || saving) return;
    setSaving(f.storagePath);
    setError(null);
    setS(f.storagePath, "Saving...");
    const now = new Date().toISOString();
    for (const p of r.proposals) {
      // Only the values this read found: a second read that misses a
      // value must not blank out the one an earlier read saved.
      const { error: err } = await supabase
        .from("tax_statement_lines")
        .update({ ...valuesFound(p.values), values_read_at: now })
        .eq("id", p.lineId);
      if (err) {
        setError(friendlyDbError(err, "Could not save the values. Please try again."));
        setS(f.storagePath, "");
        setSaving(null);
        return;
      }
    }
    setSaving(null);
    setResults((x) => {
      const n = { ...x };
      delete n[f.storagePath];
      return n;
    });
    setS(f.storagePath, `Saved ${r.proposals.length} lines.`);
    router.refresh();
  }

  const unread = files.filter((f) => !f.lines.every((l) => l.valuesRead)).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={readAll}
          disabled={busyAll || unread === 0}
          className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-50"
        >
          {busyAll ? "Reading..." : `Read every unread file (${unread})`}
        </button>
        <span className="text-sm text-gray-600">Each file is checked by you before anything is saved.</span>
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <ul className="space-y-3">
        {files.map((f) => {
          const done = f.lines.filter((l) => l.valuesRead).length;
          const r = results[f.storagePath];
          const byId = new Map(f.lines.map((l) => [l.id, l]));
          return (
            <li key={f.storagePath} className="rounded-xl border border-gray-200 bg-white p-3 text-sm">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium text-gray-900">{f.label}</span>
                <span className="text-xs text-gray-500">{f.fileName}</span>
                <span className="text-xs text-gray-600">
                  {done} of {f.lines.length} lines have values
                </span>
                <span className="ml-auto flex items-center gap-2">
                  {status[f.storagePath] ? <span className="text-xs text-gray-600">{status[f.storagePath]}</span> : null}
                  {!r ? (
                    <button onClick={() => readFile(f)} className="text-xs font-semibold text-kelly-700 hover:underline">
                      {done > 0 ? "Read again" : "Read values"}
                    </button>
                  ) : null}
                </span>
              </div>
              {r ? (
                <div className="mt-2 space-y-2">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[820px] text-xs">
                      <thead>
                        <tr className="text-left text-gray-500">
                          <th className="py-1 pr-2">Parcel</th>
                          <th className="py-1 pr-2 text-right">Tax</th>
                          {LINE_VALUE_KEYS.map((k) => (
                            <th key={k} className="py-1 pr-2 text-right">
                              {LINE_VALUE_LABELS[k]}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {r.proposals.map((p) => {
                          const line = byId.get(p.lineId);
                          return (
                            <tr key={p.lineId} className="border-t border-gray-100">
                              <td className="py-1 pr-2 font-mono">{line?.parcelLabel ?? p.matchedBy}</td>
                              <td className="py-1 pr-2 text-right">{line ? formatDollars(Number(line.tax_due)) : ""}</td>
                              {LINE_VALUE_KEYS.map((k) => (
                                <td key={k} className="py-1 pr-2 text-right">
                                  {fmt(k, p.values[k])}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-gray-600">
                    {r.unmatched > 0 ? `${r.unmatched} line${r.unmatched === 1 ? "" : "s"} read did not match a line on file. ` : ""}
                    {r.empty > 0 ? `${r.empty} printed no extra values. ` : ""}
                    Only these value columns are saved; tax amounts and parcel matches stay as they are.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => apply(f)}
                      disabled={r.proposals.length === 0 || saving !== null}
                      className="rounded-lg bg-kelly-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-kelly-600 disabled:opacity-50"
                    >
                      Save {r.proposals.length} line{r.proposals.length === 1 ? "" : "s"}
                    </button>
                    <button
                      onClick={() =>
                        setResults((x) => {
                          const n = { ...x };
                          delete n[f.storagePath];
                          return n;
                        })
                      }
                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700"
                    >
                      Discard
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
