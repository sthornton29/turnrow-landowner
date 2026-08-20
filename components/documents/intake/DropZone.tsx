"use client";

import { useRef, useState } from "react";

// Step 1: drop a file, choose one, or take a photo. No type picker, no
// property picker; the AI pass runs next and everything is confirmed
// before anything saves.
export default function DropZone({
  onFile,
  onManual,
  disabled = false,
  intro,
}: {
  onFile: (file: File) => void;
  onManual: () => void;
  disabled?: boolean;
  intro?: string | null;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <div className="space-y-3">
      {intro ? <p className="text-sm text-gray-600">{intro}</p> : null}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f && !disabled) onFile(f);
        }}
        className={
          "flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition " +
          (over ? "border-kelly-600 bg-kelly-100" : "border-kelly-500 bg-kelly-50")
        }
      >
        <p className="text-base font-semibold text-pine-900">Drop a document here</p>
        <p className="text-xs text-gray-600">
          Deed, survey, title policy, FSA-156EZ, determination, appraisal, agreement. PDF, photo, or spreadsheet.
          The app reads it and shows you what it found before anything is saved.
        </p>
        <div className="mt-1 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => fileRef.current?.click()}
            className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-60"
          >
            Choose file
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => cameraRef.current?.click()}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            Take a photo
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,image/*,.csv,.xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = "";
          }}
        />
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
          onClick={onManual}
          className="w-full rounded-lg border-2 border-pine-800 bg-white px-4 py-2.5 text-sm font-semibold text-pine-900 hover:bg-kelly-50 sm:w-auto"
        >
          Manual upload (no AI)
        </button>
      </div>
    </div>
  );
}
