"use client";

import { useEffect, useState } from "react";

// The file the user dropped, shown beside the confirm form (desktop)
// or above it (mobile): PDFs in an iframe, images inline, anything
// else as a name card. Object URLs are revoked on change/unmount.
export default function FilePreview({ file, compact = false }: { file: File; compact?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  const isImage = file.type.startsWith("image/");
  const mb = Math.round((file.size / (1024 * 1024)) * 10) / 10;
  const heightClass = compact ? "h-48 md:h-[60vh]" : "h-64 md:h-[70vh]";

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
      <div className="flex items-center justify-between gap-2 border-b border-gray-200 bg-white px-3 py-1.5">
        <p className="truncate text-xs font-medium text-gray-800" title={file.name}>{file.name}</p>
        <p className="shrink-0 text-[11px] text-gray-500">{mb} MB</p>
      </div>
      {url && isPdf ? (
        <iframe title="Document preview" src={`${url}#toolbar=0&view=FitH`} className={"w-full bg-white " + heightClass} />
      ) : url && isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={file.name} className={"w-full object-contain " + heightClass} />
      ) : (
        <div className={"flex items-center justify-center p-6 text-center text-sm text-gray-500 " + (compact ? "h-28" : "h-40")}>
          No preview for this file type. It will be stored as is.
        </div>
      )}
    </div>
  );
}
