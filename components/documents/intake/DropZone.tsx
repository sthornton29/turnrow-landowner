"use client";

import { useRef, useState } from "react";

// Step 1: drop a file (or many, or a whole folder), choose files, or take
// a photo. No type picker, no property picker; the AI pass runs next and
// everything is confirmed before anything saves. One file opens the
// single-document review; several open the bulk review table.

// Files dropped from a folder keep their folder path (the bulk upload
// reads a property name out of it). Browsers expose it on
// webkitRelativePath for picked folders; dropped folders are walked here
// and the path is attached the same way.
export type PathedFile = File & { relativePath?: string };

function withPath(file: File, path: string): PathedFile {
  const f = file as PathedFile;
  try {
    Object.defineProperty(f, "relativePath", { value: path, configurable: true });
  } catch {
    /* read-only in some browsers; the folder hint is optional */
  }
  return f;
}

const HIDDEN = /^(\.|~\$|thumbs\.db$|desktop\.ini$)/i;

async function walkEntry(entry: FileSystemEntry, prefix: string, out: PathedFile[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
    if (!HIDDEN.test(file.name)) out.push(withPath(file, prefix + file.name));
    return;
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries returns batches; keep reading until it returns none.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
      if (batch.length === 0) break;
      for (const child of batch) await walkEntry(child, `${prefix}${entry.name}/`, out);
    }
  }
}

async function filesFromDrop(dt: DataTransfer): Promise<PathedFile[]> {
  const entries = Array.from(dt.items ?? [])
    .map((i) => (typeof i.webkitGetAsEntry === "function" ? i.webkitGetAsEntry() : null))
    .filter((e): e is FileSystemEntry => e !== null);
  if (entries.length > 0 && entries.some((e) => e.isDirectory)) {
    const out: PathedFile[] = [];
    for (const e of entries) await walkEntry(e, "", out);
    return out;
  }
  return Array.from(dt.files ?? []).filter((f) => !HIDDEN.test(f.name));
}

export default function DropZone({
  onFile,
  onFiles,
  onManual,
  disabled = false,
  intro,
}: {
  onFile: (file: File) => void;
  // When set, several files (or a folder) can be chosen at once.
  onFiles?: (files: File[]) => void;
  // "Manual upload (no AI)": called with the file once one is chosen
  // (the manual form has nothing to show without a file).
  onManual: (file: File) => void;
  disabled?: boolean;
  intro?: string | null;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const manualRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [walking, setWalking] = useState(false);

  function deliver(files: File[]) {
    if (files.length === 0 || disabled) return;
    if (onFiles) onFiles(files);
    else onFile(files[0]);
  }

  return (
    <div className="space-y-3">
      {intro ? <p className="text-sm text-gray-600">{intro}</p> : null}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={async (e) => {
          e.preventDefault();
          setOver(false);
          if (disabled) return;
          if (!onFiles) {
            const f = e.dataTransfer.files?.[0];
            if (f) onFile(f);
            return;
          }
          setWalking(true);
          try {
            deliver(await filesFromDrop(e.dataTransfer));
          } finally {
            setWalking(false);
          }
        }}
        className={
          "flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition " +
          (over ? "border-kelly-600 bg-kelly-100" : "border-kelly-500 bg-kelly-50")
        }
      >
        <p className="text-base font-semibold text-pine-900">
          {walking ? "Gathering files..." : onFiles ? "Drop documents or a folder here" : "Drop a document here"}
        </p>
        <p className="text-xs text-gray-600">
          Deed, survey, title policy, FSA-156EZ, determination, appraisal, agreement. PDF, photo, or spreadsheet.
          {onFiles
            ? " Drop one file to review it in full, or many at once (even a whole folder) to review them together in a table."
            : null}{" "}
          The app reads each one and shows you what it found before anything is saved.
        </p>
        <div className="mt-1 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            disabled={disabled || walking}
            onClick={() => fileRef.current?.click()}
            className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-60"
          >
            {onFiles ? "Choose files" : "Choose file"}
          </button>
          {onFiles ? (
            <button
              type="button"
              disabled={disabled || walking}
              onClick={() => folderRef.current?.click()}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              Choose a folder
            </button>
          ) : null}
          <button
            type="button"
            disabled={disabled || walking}
            onClick={() => cameraRef.current?.click()}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            Take a photo
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          multiple={Boolean(onFiles)}
          accept="application/pdf,image/*,.csv,.xlsx,.xls,.doc,.docx"
          className="hidden"
          onChange={(e) => {
            deliver(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        {onFiles ? (
          <input
            ref={folderRef}
            type="file"
            multiple
            className="hidden"
            // Non-standard but supported by every current browser.
            {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? [])
                .filter((f) => !HIDDEN.test(f.name))
                .map((f) => withPath(f, f.webkitRelativePath || f.name));
              deliver(files);
              e.target.value = "";
            }}
          />
        ) : null}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = "";
          }}
        />
      </div>
      <div className="flex flex-col items-center gap-1">
        <p className="text-xs text-gray-500">Prefer to type it in yourself?</p>
        <button
          type="button"
          disabled={disabled || walking}
          onClick={() => manualRef.current?.click()}
          className="w-full rounded-lg border-2 border-pine-800 bg-white px-4 py-2.5 text-sm font-semibold text-pine-900 hover:bg-kelly-50 disabled:opacity-60 sm:w-auto"
        >
          Manual upload (no AI)
        </button>
        <input
          ref={manualRef}
          type="file"
          accept="application/pdf,image/*,.csv,.xlsx,.xls,.doc,.docx"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onManual(f);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
