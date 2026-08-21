"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// The stored file, rendered in place: PDF pages drawn to a canvas with
// Prev / Next (pdf.js, loaded in the browser only, so phones page through
// a deed instead of seeing its first page), images inline, anything else
// a file card. The signed URL is short-lived and fetched here.
export default function DocumentPreview({
  storagePath,
  fileName,
  contentType,
}: {
  storagePath: string;
  fileName: string;
  contentType: string | null;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isPdf = (contentType ?? "") === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");
  const isImage = (contentType ?? "").startsWith("image/");

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase.storage
      .from("documents")
      .createSignedUrl(storagePath, 3600)
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err || !data?.signedUrl) setError("Could not load the file.");
        else setUrl(data.signedUrl);
      });
    return () => {
      cancelled = true;
    };
  }, [storagePath]);

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
      {error ? (
        <p className="p-6 text-center text-sm text-red-600">{error}</p>
      ) : !url ? (
        <div className="h-64 animate-pulse bg-gray-100 md:h-[60vh]" />
      ) : isPdf ? (
        <PdfPages url={url} />
      ) : isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={fileName} className="max-h-[70vh] w-full object-contain" />
      ) : (
        <div className="flex h-40 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-gray-500">
          <span>No preview for this file type.</span>
          <a href={url} target="_blank" rel="noreferrer" className="font-medium text-kelly-700 hover:underline">
            Open the file
          </a>
        </div>
      )}
    </div>
  );
}

type PdfDoc = {
  numPages: number;
  getPage: (n: number) => Promise<{
    getViewport: (o: { scale: number }) => { width: number; height: number };
    render: (o: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<void> };
  }>;
};

function PdfPages({ url }: { url: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [page, setPage] = useState(1);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url
        ).toString();
        const loaded = (await pdfjs.getDocument({ url }).promise) as unknown as PdfDoc;
        if (!cancelled) {
          setDoc(loaded);
          setPage(1);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => {
    if (!doc || !canvasRef.current) return;
    let cancelled = false;
    (async () => {
      const p = await doc.getPage(page);
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      const width = wrapRef.current?.clientWidth ?? 600;
      const base = p.getViewport({ scale: 1 });
      const scale = Math.min(2, width / base.width) * (window.devicePixelRatio || 1);
      const viewport = p.getViewport({ scale });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = "100%";
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      await p.render({ canvasContext: ctx, viewport }).promise;
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, page]);

  if (failed) {
    return (
      <div className="p-6 text-center text-sm text-gray-500">
        Could not render this PDF.{" "}
        <a href={url} target="_blank" rel="noreferrer" className="font-medium text-kelly-700 hover:underline">
          Open the file
        </a>
      </div>
    );
  }

  const btn =
    "rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40";
  return (
    <div>
      <div className="flex items-center justify-between gap-2 border-b border-gray-200 bg-white px-3 py-1.5">
        <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={!doc || page <= 1} className={btn}>
          Prev
        </button>
        <span className="text-xs text-gray-600">{doc ? `${page} of ${doc.numPages}` : "Loading..."}</span>
        <button
          type="button"
          onClick={() => setPage((p) => (doc ? Math.min(doc.numPages, p + 1) : p))}
          disabled={!doc || page >= doc.numPages}
          className={btn}
        >
          Next
        </button>
      </div>
      <div ref={wrapRef} className="max-h-[75vh] overflow-auto bg-gray-100 p-2">
        <canvas ref={canvasRef} className="mx-auto block rounded bg-white shadow-sm" />
      </div>
    </div>
  );
}
